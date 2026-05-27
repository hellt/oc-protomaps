import type { Edge, Node } from '@xyflow/react';

export type MapNodeKind = 'service' | 'rpc' | 'message' | 'enum' | 'external' | 'legend';
export type MapEdgeKind = 'rpc' | 'field' | 'extension' | 'extension-detail';
export type MapBadge = 'stream' | 'optional' | 'deprecated' | 'reserved';

export type MapBounds = {
  width: number;
  height: number;
};

export type MapField = {
  id: string;
  type: string;
  name: string;
  ref?: string | null;
  group?: string;
  badge?: MapBadge;
  deprecated?: boolean;
};

export type MapNodeData = Record<string, unknown> & {
  id: string;
  kind: MapNodeKind;
  label: string;
  sourceSymbol?: string;
  deprecated?: boolean;
  protoUrl?: string;
  specUrl?: string;
  fields?: MapField[];
  badges?: MapBadge[];
  active?: boolean;
  query?: string;
  showExtensions?: boolean;
};

export type MapNode = Node<MapNodeData, 'schema'>;

export type MapEdge = Edge<Record<string, never>, 'smoothstep'> & {
  sourceHandle: string;
  kind: MapEdgeKind;
  deprecated: boolean;
};

export type VisibleMapOptions = {
  showDeprecated?: boolean;
  showExtensions?: boolean;
  focusNodeId?: string | null;
};

export type VisibleMap = {
  nodes: MapNode[];
  edges: MapEdge[];
};

export function visibleProtoMap(
  mapNodes: MapNode[],
  mapEdges: MapEdge[],
  { showDeprecated = false, showExtensions = true, focusNodeId = null }: VisibleMapOptions = {},
): VisibleMap {
  const focusedNodeIds = focusNodeId ? reachableNodeIds(focusNodeId, mapEdges) : null;
  const visibleNodes = mapNodes
    .filter((node) => node.data.kind !== 'legend')
    .filter((node) => !focusedNodeIds || focusedNodeIds.has(node.id))
    .filter((node) => showDeprecated || !node.data.deprecated)
    .map((node) => ({
      ...node,
      data: {
        ...node.data,
        fields: (node.data.fields ?? []).filter((field) => showDeprecated || !field.deprecated),
      },
    }));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleHandles = new Set(
    visibleNodes.flatMap((node) =>
      (node.data.fields ?? []).map((field) => `${node.id}:${field.id}`),
    ),
  );
  const visibleEdges = mapEdges.filter((edge) => {
    if (!showExtensions && edge.kind === 'extension') {
      return false;
    }
    if (!showDeprecated && edge.deprecated) {
      return false;
    }
    return (
      visibleNodeIds.has(edge.source) &&
      visibleNodeIds.has(edge.target) &&
      visibleHandles.has(`${edge.source}:${edge.sourceHandle}`)
    );
  });

  return { nodes: visibleNodes, edges: visibleEdges };
}

function reachableNodeIds(rootNodeId: string, edges: MapEdge[]): Set<string> {
  const nodeIds = new Set([rootNodeId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!nodeIds.has(edge.source) || nodeIds.has(edge.target)) {
        continue;
      }
      nodeIds.add(edge.target);
      changed = true;
    }
  }

  return nodeIds;
}
