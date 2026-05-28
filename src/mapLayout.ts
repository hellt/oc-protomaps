import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { MapEdge, MapField, MapNode, VisibleMap } from './protoMapTypes';

export const nodeHeaderHeight = 36;
export const nodeBodyPadding = 8;
export const nodeBadgeHeight = 24;
export const baseFieldRowHeight = 32;
export const detailFieldRowHeight = 52;
export const layoutGapX = 8;
export const layoutGapY = 18;

const maxLayoutPasses = 50;
const elk = new ELK();
const nodeSpacing = 86;
const layerSpacing = 150;
const routePadding = 18;
const routeEndpointOffset = 34;
const routeOuterMargin = 160;
const routeBendPenalty = 42;
const compactRoutePadding = 16;

export type RoutePoint = {
  x: number;
  y: number;
};

export type LayoutBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TargetHandleLayout = {
  id: string;
  edgeId: string;
  y: number;
};

export type RoutedLayoutEdge = {
  edge: MapEdge;
  targetHandle: string;
  routePoints: RoutePoint[];
};

export type ReadableLayout = {
  nodes: MapNode[];
  edges: RoutedLayoutEdge[];
  bounds: LayoutBounds;
};

export type ManualNodePositions = Record<string, RoutePoint>;

export type LayoutBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ReadableNodeLayoutOptions = {
  compact?: boolean;
};

export type RouteReadableLayoutOptions = {
  compact?: boolean;
};

export function mapNodeWidth(node: MapNode): number {
  const width = node.style?.width;

  if (typeof width === 'number') {
    return width;
  }

  if (typeof width === 'string') {
    const parsedWidth = Number.parseFloat(width);
    return Number.isFinite(parsedWidth) ? parsedWidth : 320;
  }

  return 320;
}

export function mapFieldRowHeight(field?: MapField): number {
  if (!field) {
    return baseFieldRowHeight;
  }

  return field.group || (field.badge && field.badge !== 'stream')
    ? detailFieldRowHeight
    : baseFieldRowHeight;
}

export function sourceHandleY(node: MapNode, sourceHandle: string): number {
  const fields = node.data.fields ?? [];
  let y =
    nodeHeaderHeight +
    (node.data.badges?.length ? nodeBadgeHeight : 0) +
    nodeBodyPadding;

  for (const field of fields) {
    const fieldHeight = mapFieldRowHeight(field);
    if (field.id === sourceHandle) {
      return y + fieldHeight / 2;
    }
    y += fieldHeight;
  }

  return estimatedMapNodeHeight(node) / 2;
}

export function estimatedMapNodeHeight(node: MapNode): number {
  const fields = node.data.fields ?? [];
  const badgeHeight = node.data.badges?.length ? nodeBadgeHeight : 0;
  const fieldsHeight = fields.length
    ? fields.reduce((height, field) => height + mapFieldRowHeight(field), 0)
    : baseFieldRowHeight;

  return nodeHeaderHeight + badgeHeight + nodeBodyPadding * 2 + fieldsHeight;
}

function boxesOverlap(first: LayoutBox, second: LayoutBox): boolean {
  return (
    first.x < second.x + second.width + layoutGapX &&
    first.x + first.width + layoutGapX > second.x &&
    first.y < second.y + second.height + layoutGapY &&
    first.y + first.height + layoutGapY > second.y
  );
}

export function improveNodeLayout(nodes: MapNode[]): MapNode[] {
  const boxes = new Map<string, LayoutBox>(
    nodes.map((node) => [
      node.id,
      {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: mapNodeWidth(node),
        height: estimatedMapNodeHeight(node),
      },
    ]),
  );

  for (let pass = 0; pass < maxLayoutPasses; pass += 1) {
    let moved = false;
    const sortedBoxes = [...boxes.values()].sort((first, second) => {
      if (first.y !== second.y) {
        return first.y - second.y;
      }

      return first.x - second.x;
    });

    for (let index = 0; index < sortedBoxes.length; index += 1) {
      const anchor = sortedBoxes[index];

      for (let nextIndex = index + 1; nextIndex < sortedBoxes.length; nextIndex += 1) {
        const candidate = sortedBoxes[nextIndex];

        if (candidate.y >= anchor.y + anchor.height + layoutGapY) {
          break;
        }

        if (!boxesOverlap(anchor, candidate)) {
          continue;
        }

        const nextY = anchor.y + anchor.height + layoutGapY;
        if (candidate.y < nextY) {
          candidate.y = nextY;
          moved = true;
        }
      }
    }

    if (!moved) {
      break;
    }
  }

  return nodes.map((node) => {
    const box = boxes.get(node.id);
    if (!box || (box.x === node.position.x && box.y === node.position.y)) {
      return node;
    }

    return {
      ...node,
      position: {
        x: box.x,
        y: box.y,
      },
    };
  });
}

function semanticLayoutPartitions(nodes: MapNode[], edges: MapEdge[]): Map<string, number> | null {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const rpcEdges = edges.filter(
    (edge) => edge.kind === 'rpc' && nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );

  if (!rpcEdges.length) {
    return null;
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }

    const targets = adjacency.get(edge.source);
    if (targets) {
      targets.push(edge.target);
    } else {
      adjacency.set(edge.source, [edge.target]);
    }
  }

  const partitions = new Map<string, number>();
  const queue: string[] = [];
  const rpcSourceIds = new Set(rpcEdges.map((edge) => edge.source));

  for (const node of nodes) {
    if (node.data.kind !== 'service' || !rpcSourceIds.has(node.id)) {
      continue;
    }

    partitions.set(node.id, 0);
    queue.push(node.id);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    const currentPartition = partitions.get(nodeId);

    if (currentPartition === undefined) {
      continue;
    }

    for (const targetId of adjacency.get(nodeId) ?? []) {
      const nextPartition = currentPartition + 1;
      const previousPartition = partitions.get(targetId);

      if (previousPartition !== undefined && previousPartition <= nextPartition) {
        continue;
      }

      partitions.set(targetId, nextPartition);
      queue.push(targetId);
    }
  }

  const fallbackPartition = Math.max(...partitions.values()) + 1;
  for (const node of nodes) {
    if (!partitions.has(node.id)) {
      partitions.set(node.id, fallbackPartition);
    }
  }

  return partitions;
}

export async function computeReadableNodeLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  options: ReadableNodeLayoutOptions = {},
): Promise<MapNode[]> {
  const activeLayerSpacing = options.compact ? 40 : layerSpacing;
  const activeNodeSpacing = options.compact ? 24 : nodeSpacing;
  const activeEdgeNodeSpacing = options.compact ? 20 : 42;
  const partitions = semanticLayoutPartitions(nodes, edges);

  const graph: ElkNode = {
    id: 'gnmi-map',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      ...(partitions ? { 'elk.partitioning.activate': 'true' } : {}),
      'elk.layered.nodePlacement.strategy': options.compact ? 'SIMPLE' : 'BRANDES_KOEPF',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.spacing.nodeNodeBetweenLayers': `${activeLayerSpacing}`,
      'elk.spacing.nodeNode': `${activeNodeSpacing}`,
      'elk.spacing.edgeEdge': options.compact ? '12' : '26',
      'elk.spacing.edgeNode': `${activeEdgeNodeSpacing}`,
      'elk.padding': options.compact
        ? '[top=24,left=24,bottom=24,right=24]'
        : '[top=40,left=40,bottom=40,right=40]',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: mapNodeWidth(node),
      height: estimatedMapNodeHeight(node),
      ...(partitions
        ? {
          layoutOptions: {
            'elk.partitioning.partition': `${partitions.get(node.id) ?? 0}`,
          },
        }
        : {}),
    })),
    edges: edges.map<ElkExtendedEdge>((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const result = await elk.layout(graph);
  const layoutById = new Map((result.children ?? []).map((node) => [node.id, node]));

  return improveNodeLayout(
    nodes.map((node) => {
      const layoutNode = layoutById.get(node.id);
      if (layoutNode?.x === undefined || layoutNode.y === undefined) {
        return node;
      }

      return {
        ...node,
        position: {
          x: Math.round(layoutNode.x),
          y: Math.round(layoutNode.y),
        },
      };
    }),
  );
}

export async function computeReadableLayout(
  visibleMap: VisibleMap,
  manualPositions: ManualNodePositions = {},
): Promise<ReadableLayout> {
  const layoutNodes = await computeReadableNodeLayout(visibleMap.nodes, visibleMap.edges);
  return routeReadableLayout(applyManualPositions(layoutNodes, manualPositions), visibleMap.edges);
}

export function applyManualPositions(
  nodes: MapNode[],
  manualPositions: ManualNodePositions,
): MapNode[] {
  return nodes.map((node) => {
    const manualPosition = manualPositions[node.id];
    if (!manualPosition) {
      return node;
    }

    return {
      ...node,
      position: manualPosition,
    };
  });
}

export function routeReadableLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  options: RouteReadableLayoutOptions = {},
): ReadableLayout {
  const bounds = mapNodesBounds(nodes);
  const boxes = new Map<string, LayoutBox>(
    nodes.map((node) => [
      node.id,
      {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: mapNodeWidth(node),
        height: estimatedMapNodeHeight(node),
      },
    ]),
  );
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const targetHandlesByNode = targetHandles(nodes, edges, boxes);
  const targetHandleByEdge = new Map(
    [...targetHandlesByNode.values()]
      .flat()
      .map((handle) => [handle.edgeId, handle] as const),
  );
  const nodesWithTargetHandles = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      targetHandles: targetHandlesByNode.get(node.id) ?? [],
    },
  }));

  return {
    nodes: nodesWithTargetHandles,
    edges: edges.map((edge) => {
      const targetHandle = targetHandleByEdge.get(edge.id);
      return {
        edge,
        targetHandle: targetHandle?.id ?? targetHandleId(edge),
        routePoints: routeEdge(edge, nodesById, boxes, bounds, targetHandle, options),
      };
    }),
    bounds,
  };
}

export function routeIntersectsNode(
  routePoints: RoutePoint[],
  node: MapNode,
  padding = 0,
): boolean {
  const box = expandedBox(
    {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: mapNodeWidth(node),
      height: estimatedMapNodeHeight(node),
    },
    padding,
  );

  return routeSegments(routePoints).some(([start, end]) => segmentIntersectsBox(start, end, box));
}

export function mapNodesBounds(nodes: MapNode[]): LayoutBounds {
  if (!nodes.length) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const maxX = Math.max(...nodes.map((node) => node.position.x + mapNodeWidth(node)));
  const maxY = Math.max(...nodes.map((node) => node.position.y + estimatedMapNodeHeight(node)));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function targetHandles(
  nodes: MapNode[],
  edges: MapEdge[],
  boxes: Map<string, LayoutBox>,
): Map<string, TargetHandleLayout[]> {
  const incoming = new Map<string, MapEdge[]>();
  const targetHeaderY = Math.round(nodeHeaderHeight / 2);

  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }

  const handles = new Map<string, TargetHandleLayout[]>();

  for (const [nodeId, nodeEdges] of incoming) {
    const box = boxes.get(nodeId);
    if (!box) {
      continue;
    }

    const sortedEdges = [...nodeEdges].sort((first, second) => {
      const firstSource = boxes.get(first.source);
      const secondSource = boxes.get(second.source);
      if (!firstSource || !secondSource) {
        return first.id.localeCompare(second.id);
      }

      const yDiff = boxCenterY(firstSource) - boxCenterY(secondSource);
      return yDiff || firstSource.x - secondSource.x || first.id.localeCompare(second.id);
    });

    handles.set(
      nodeId,
      sortedEdges.map((edge) => ({
        id: targetHandleId(edge),
        edgeId: edge.id,
        y: targetHeaderY,
      })),
    );
  }

  return handles;
}

function routeEdge(
  edge: MapEdge,
  nodesById: Map<string, MapNode>,
  boxes: Map<string, LayoutBox>,
  bounds: LayoutBounds,
  targetHandle?: TargetHandleLayout,
  options: RouteReadableLayoutOptions = {},
): RoutePoint[] {
  const source = nodesById.get(edge.source);
  const target = nodesById.get(edge.target);
  const sourceBox = boxes.get(edge.source);
  const targetBox = boxes.get(edge.target);

  if (!source || !target || !sourceBox || !targetBox) {
    return [];
  }

  const start: RoutePoint = {
    x: sourceBox.x + sourceBox.width,
    y: sourceBox.y + sourceHandleY(source, edge.sourceHandle),
  };
  const end: RoutePoint = {
    x: targetBox.x,
    y: targetBox.y + (targetHandle?.y ?? targetBox.height / 2),
  };

  if (options.compact && isForwardEdge(sourceBox, targetBox)) {
    const route = compactForwardRoute(start, end, sourceBox, targetBox);
    const routeObstacles = [...boxes.values()];

    if (!routeIntersectsBoxes(route, routeObstacles)) {
      return route;
    }
  }

  if (options.compact) {
    const route = compactDetourRoute(start, end, sourceBox, targetBox, [...boxes.values()]);
    if (route) {
      return route;
    }
  }

  const routeStart = { x: start.x + routeEndpointOffset, y: start.y };
  const routeEnd = { x: end.x - routeEndpointOffset, y: end.y };
  const obstacles = [...boxes.values()].map((box) => expandedBox(box, routePadding));
  const routed = findOrthogonalRoute(routeStart, routeEnd, obstacles, bounds);

  return compactRoute([
    start,
    routeStart,
    ...(routed ?? fallbackRoute(routeStart, routeEnd, bounds)).slice(1, -1),
    routeEnd,
    end,
  ]);
}

function compactDetourRoute(
  start: RoutePoint,
  end: RoutePoint,
  sourceBox: LayoutBox,
  targetBox: LayoutBox,
  boxes: LayoutBox[],
): RoutePoint[] | null {
  return isForwardEdge(sourceBox, targetBox)
    ? compactForwardDetourRoute(start, end, sourceBox, targetBox, boxes)
    : compactBackDetourRoute(start, end, sourceBox, targetBox, boxes);
}

function compactForwardDetourRoute(
  start: RoutePoint,
  end: RoutePoint,
  sourceBox: LayoutBox,
  targetBox: LayoutBox,
  boxes: LayoutBox[],
): RoutePoint[] | null {
  const sourceRight = sourceBox.x + sourceBox.width;
  const targetLeft = targetBox.x;
  const betweenBoxes = boxes.filter(
    (box) =>
      box.id !== sourceBox.id &&
      box.id !== targetBox.id &&
      box.x < targetLeft - compactRoutePadding &&
      rangesOverlap(box.x, box.x + box.width, sourceRight, targetLeft),
  );

  if (!betweenBoxes.length) {
    return null;
  }

  const firstObstacleLeft = Math.min(...betweenBoxes.map((box) => box.x));
  const lastObstacleRight = Math.max(...betweenBoxes.map((box) => box.x + box.width));
  const firstBendX = horizontalLaneBetween(sourceRight, firstObstacleLeft);
  const lastBendX = horizontalLaneBetween(lastObstacleRight, targetLeft);

  return compactLaneRoute(start, end, firstBendX, lastBendX, boxes);
}

function compactBackDetourRoute(
  start: RoutePoint,
  end: RoutePoint,
  sourceBox: LayoutBox,
  targetBox: LayoutBox,
  boxes: LayoutBox[],
): RoutePoint[] | null {
  const firstBendX = sourceBox.x + sourceBox.width + routeEndpointOffset;
  const lastBendX = targetBox.x - routeEndpointOffset;

  return compactLaneRoute(start, end, firstBendX, lastBendX, boxes);
}

function compactLaneRoute(
  start: RoutePoint,
  end: RoutePoint,
  firstBendX: number,
  lastBendX: number,
  boxes: LayoutBox[],
): RoutePoint[] | null {
  const xMin = Math.min(firstBendX, lastBendX);
  const xMax = Math.max(firstBendX, lastBendX);
  const candidateBoxes = boxes.filter((box) => rangesOverlap(box.x, box.x + box.width, xMin, xMax));
  const yCandidates = uniqueSortedNumbers(
    [
      start.y,
      end.y,
      ...candidateBoxes.flatMap((box) => [
        box.y - compactRoutePadding,
        box.y + box.height + compactRoutePadding,
      ]),
    ],
  ).sort((first, second) => {
    const firstRoute = compactLaneRoutePoints(start, end, firstBendX, lastBendX, first);
    const secondRoute = compactLaneRoutePoints(start, end, firstBendX, lastBendX, second);
    return routeCost(firstRoute) - routeCost(secondRoute);
  });

  for (const y of yCandidates) {
    const route = compactLaneRoutePoints(start, end, firstBendX, lastBendX, y);
    if (!routeIntersectsBoxes(route, boxes)) {
      return route;
    }
  }

  return null;
}

function compactLaneRoutePoints(
  start: RoutePoint,
  end: RoutePoint,
  firstBendX: number,
  lastBendX: number,
  y: number,
): RoutePoint[] {
  return compactRoute([
    start,
    { x: firstBendX, y: start.y },
    { x: firstBendX, y },
    { x: lastBendX, y },
    { x: lastBendX, y: end.y },
    end,
  ]);
}

function routeCost(points: RoutePoint[]): number {
  const segments = routeSegments(points);
  const distance = segments.reduce(
    (totalDistance, [start, end]) => totalDistance + manhattanDistance(start, end),
    0,
  );
  const bends = Math.max(0, segments.length - 1);

  return distance + bends * routeBendPenalty;
}

function horizontalLaneBetween(left: number, right: number): number {
  const gap = right - left;
  if (gap >= compactRoutePadding * 2) {
    return Math.round(left + gap / 2);
  }

  return Math.round(left + Math.max(compactRoutePadding, gap / 2));
}

function compactForwardRoute(
  start: RoutePoint,
  end: RoutePoint,
  sourceBox: LayoutBox,
  targetBox: LayoutBox,
): RoutePoint[] {
  const gapMidpointX = Math.round((sourceBox.x + sourceBox.width + targetBox.x) / 2);

  return compactRoute([
    start,
    { x: gapMidpointX, y: start.y },
    { x: gapMidpointX, y: end.y },
    end,
  ]);
}

function isForwardEdge(sourceBox: LayoutBox, targetBox: LayoutBox): boolean {
  return sourceBox.x + sourceBox.width <= targetBox.x;
}

function routeIntersectsBoxes(routePoints: RoutePoint[], boxes: LayoutBox[]): boolean {
  return routeSegments(routePoints).some(([start, end]) =>
    boxes.some((box) => segmentIntersectsBox(start, end, box)),
  );
}

function findOrthogonalRoute(
  start: RoutePoint,
  end: RoutePoint,
  obstacles: LayoutBox[],
  bounds: LayoutBounds,
): RoutePoint[] | null {
  const xCoordinates = uniqueSortedNumbers([
    start.x,
    end.x,
    bounds.x - routeOuterMargin,
    bounds.x + bounds.width + routeOuterMargin,
    ...obstacles.flatMap((box) => [box.x - routePadding, box.x + box.width + routePadding]),
  ]);
  const yCoordinates = uniqueSortedNumbers([
    start.y,
    end.y,
    bounds.y - routeOuterMargin,
    bounds.y + bounds.height + routeOuterMargin,
    ...obstacles.flatMap((box) => [box.y - routePadding, box.y + box.height + routePadding]),
  ]);
  const points: RoutePoint[] = [];
  const pointIndex = new Map<string, number>();

  for (const y of yCoordinates) {
    for (const x of xCoordinates) {
      const point = { x, y };
      if (obstacles.some((box) => pointInsideBox(point, box))) {
        continue;
      }

      pointIndex.set(pointKey(point), points.length);
      points.push(point);
    }
  }

  const startIndex = pointIndex.get(pointKey(start));
  const endIndex = pointIndex.get(pointKey(end));
  if (startIndex === undefined || endIndex === undefined) {
    return null;
  }

  const adjacency = buildRouteAdjacency(points, obstacles);
  const path = shortestRoute(points, adjacency, startIndex, endIndex);
  return path ? compactRoute(path.map((index) => points[index])) : null;
}

function buildRouteAdjacency(points: RoutePoint[], obstacles: LayoutBox[]): number[][] {
  const adjacency = Array.from({ length: points.length }, () => [] as number[]);
  const rows = new Map<number, number[]>();
  const columns = new Map<number, number[]>();

  points.forEach((point, index) => {
    rows.set(point.y, [...(rows.get(point.y) ?? []), index]);
    columns.set(point.x, [...(columns.get(point.x) ?? []), index]);
  });

  for (const row of rows.values()) {
    row.sort((first, second) => points[first].x - points[second].x);
    connectVisibleNeighbors(row, adjacency, points, obstacles);
  }

  for (const column of columns.values()) {
    column.sort((first, second) => points[first].y - points[second].y);
    connectVisibleNeighbors(column, adjacency, points, obstacles);
  }

  return adjacency;
}

function connectVisibleNeighbors(
  sortedIndexes: number[],
  adjacency: number[][],
  points: RoutePoint[],
  obstacles: LayoutBox[],
): void {
  for (let index = 0; index < sortedIndexes.length - 1; index += 1) {
    const first = sortedIndexes[index];
    const second = sortedIndexes[index + 1];
    if (obstacles.some((box) => segmentIntersectsBox(points[first], points[second], box))) {
      continue;
    }

    adjacency[first].push(second);
    adjacency[second].push(first);
  }
}

function shortestRoute(
  points: RoutePoint[],
  adjacency: number[][],
  startIndex: number,
  endIndex: number,
): number[] | null {
  const directions = 3;
  const directionStart = 0;
  const directionHorizontal = 1;
  const directionVertical = 2;
  const totalStates = points.length * directions;
  const distances = Array.from({ length: totalStates }, () => Number.POSITIVE_INFINITY);
  const previous = Array<{ state: number; pointIndex: number } | null>(totalStates).fill(null);
  const heap = new RouteHeap();
  const startState = routeState(startIndex, directionStart);
  distances[startState] = 0;
  heap.push({ state: startState, distance: 0, priority: 0 });

  while (heap.size) {
    const current = heap.pop();
    if (!current || current.distance !== distances[current.state]) {
      continue;
    }

    const currentPointIndex = Math.floor(current.state / directions);
    const currentDirection = current.state % directions;
    if (currentPointIndex === endIndex) {
      return reconstructRoute(previous, current.state);
    }

    for (const nextPointIndex of adjacency[currentPointIndex]) {
      const nextDirection =
        points[currentPointIndex].x === points[nextPointIndex].x
          ? directionVertical
          : directionHorizontal;
      const bendCost =
        currentDirection !== directionStart && currentDirection !== nextDirection
          ? routeBendPenalty
          : 0;
      const nextState = routeState(nextPointIndex, nextDirection);
      const nextDistance =
        distances[current.state] +
        manhattanDistance(points[currentPointIndex], points[nextPointIndex]) +
        bendCost;

      if (nextDistance >= distances[nextState]) {
        continue;
      }

      distances[nextState] = nextDistance;
      previous[nextState] = { state: current.state, pointIndex: currentPointIndex };
      heap.push({
        state: nextState,
        distance: nextDistance,
        priority: nextDistance + manhattanDistance(points[nextPointIndex], points[endIndex]),
      });
    }
  }

  return null;
}

function reconstructRoute(
  previous: Array<{ state: number; pointIndex: number } | null>,
  endState: number,
): number[] {
  const directions = 3;
  const path = [Math.floor(endState / directions)];
  let currentState = endState;

  while (previous[currentState]) {
    const currentPrevious = previous[currentState];
    if (!currentPrevious) {
      break;
    }

    path.push(currentPrevious.pointIndex);
    currentState = currentPrevious.state;
  }

  return path.reverse();
}

function routeState(pointIndex: number, direction: number): number {
  return pointIndex * 3 + direction;
}

function fallbackRoute(start: RoutePoint, end: RoutePoint, bounds: LayoutBounds): RoutePoint[] {
  const y =
    Math.abs(start.y - (bounds.y - routeOuterMargin)) <
      Math.abs(start.y - (bounds.y + bounds.height + routeOuterMargin))
      ? bounds.y + bounds.height + routeOuterMargin
      : bounds.y - routeOuterMargin;

  return compactRoute([start, { x: start.x, y }, { x: end.x, y }, end]);
}

function compactRoute(points: RoutePoint[]): RoutePoint[] {
  const deduped = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
  const compacted: RoutePoint[] = [];

  for (const point of deduped) {
    const previous = compacted[compacted.length - 1];
    const beforePrevious = compacted[compacted.length - 2];
    if (
      previous &&
      beforePrevious &&
      ((beforePrevious.x === previous.x && previous.x === point.x) ||
        (beforePrevious.y === previous.y && previous.y === point.y))
    ) {
      compacted[compacted.length - 1] = point;
      continue;
    }

    compacted.push(point);
  }

  return compacted;
}

function routeSegments(points: RoutePoint[]): Array<[RoutePoint, RoutePoint]> {
  const segments: Array<[RoutePoint, RoutePoint]> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push([points[index], points[index + 1]]);
  }
  return segments;
}

function segmentIntersectsBox(start: RoutePoint, end: RoutePoint, box: LayoutBox): boolean {
  if (start.y === end.y) {
    const y = start.y;
    if (y <= box.y || y >= box.y + box.height) {
      return false;
    }

    return rangesOverlap(start.x, end.x, box.x, box.x + box.width);
  }

  if (start.x === end.x) {
    const x = start.x;
    if (x <= box.x || x >= box.x + box.width) {
      return false;
    }

    return rangesOverlap(start.y, end.y, box.y, box.y + box.height);
  }

  return false;
}

function rangesOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
  const firstMin = Math.min(firstStart, firstEnd);
  const firstMax = Math.max(firstStart, firstEnd);
  const secondMin = Math.min(secondStart, secondEnd);
  const secondMax = Math.max(secondStart, secondEnd);
  return firstMin < secondMax && firstMax > secondMin;
}

function expandedBox(box: LayoutBox, padding: number): LayoutBox {
  return {
    id: box.id,
    x: box.x - padding,
    y: box.y - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  };
}

function pointInsideBox(point: RoutePoint, box: LayoutBox): boolean {
  return (
    point.x > box.x &&
    point.x < box.x + box.width &&
    point.y > box.y &&
    point.y < box.y + box.height
  );
}

function pointKey(point: RoutePoint): string {
  return `${point.x}:${point.y}`;
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value)))].sort((first, second) => first - second);
}

function manhattanDistance(first: RoutePoint, second: RoutePoint): number {
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
}

function boxCenterY(box: LayoutBox): number {
  return box.y + box.height / 2;
}

function targetHandleId(edge: MapEdge): string {
  return `target-${edge.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

type HeapItem = {
  state: number;
  distance: number;
  priority: number;
};

class RouteHeap {
  private readonly items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: HeapItem): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): HeapItem | undefined {
    if (!this.items.length) {
      return undefined;
    }

    const top = this.items[0];
    const last = this.items.pop();
    if (last && this.items.length) {
      this.items[0] = last;
      this.bubbleDown(0);
    }

    return top;
  }

  private bubbleUp(index: number): void {
    let currentIndex = index;
    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (this.items[parentIndex].priority <= this.items[currentIndex].priority) {
        return;
      }

      [this.items[parentIndex], this.items[currentIndex]] = [
        this.items[currentIndex],
        this.items[parentIndex],
      ];
      currentIndex = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    let currentIndex = index;
    while (true) {
      const leftIndex = currentIndex * 2 + 1;
      const rightIndex = currentIndex * 2 + 2;
      let smallestIndex = currentIndex;

      if (
        leftIndex < this.items.length &&
        this.items[leftIndex].priority < this.items[smallestIndex].priority
      ) {
        smallestIndex = leftIndex;
      }
      if (
        rightIndex < this.items.length &&
        this.items[rightIndex].priority < this.items[smallestIndex].priority
      ) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === currentIndex) {
        return;
      }

      [this.items[currentIndex], this.items[smallestIndex]] = [
        this.items[smallestIndex],
        this.items[currentIndex],
      ];
      currentIndex = smallestIndex;
    }
  }
}
