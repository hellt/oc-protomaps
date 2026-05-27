import {
  getVisibleMap,
  mapEdges,
  mapNodes,
  mapSource,
  type MapEdge,
  type MapNode,
} from '../src/gnmiMap';
import {
  computeReadableNodeLayout,
  estimatedMapNodeHeight,
  mapNodeWidth,
  routeIntersectsNode,
  routeReadableLayout,
} from '../src/mapLayout';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function validateEdges(nodes: MapNode[], edges: MapEdge[], label: string): void {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const handles = new Set(
    nodes.flatMap((node) => (node.data.fields ?? []).map((field) => `${node.id}:${field.id}`)),
  );

  for (const edge of edges) {
    assert(nodeIds.has(edge.source), `${label}: edge ${edge.id} has missing source ${edge.source}`);
    assert(nodeIds.has(edge.target), `${label}: edge ${edge.id} has missing target ${edge.target}`);
    assert(
      handles.has(`${edge.source}:${edge.sourceHandle}`),
      `${label}: edge ${edge.id} has missing source handle ${edge.sourceHandle}`,
    );
  }
}

function validateLinks(): void {
  for (const node of mapNodes) {
    if (node.data.protoUrl?.startsWith('https://github.com/openconfig/gnmi/blob/')) {
      const validProtoBase =
        node.data.protoUrl.startsWith(mapSource.gnmiBase) ||
        node.data.protoUrl.startsWith(mapSource.extBase);
      assert(validProtoBase, `${node.id}: protoUrl does not use configured proto bases`);
    }

    if (node.data.specUrl) {
      assert(
        node.data.specUrl.startsWith(mapSource.specBase),
        `${node.id}: specUrl does not use configured spec base`,
      );
    }
  }
}

function validateDeprecatedVisibility(): void {
  const rawSubscribeResponse = mapNodes.find((node) => node.id === 'subscribe-response');
  assert(rawSubscribeResponse, 'raw map is missing SubscribeResponse');
  const rawErrorField = rawSubscribeResponse.data.fields?.find((field) => field.name === 'error');
  assert(rawErrorField?.deprecated, 'raw SubscribeResponse.error must be preserved as deprecated');

  const defaultMap = getVisibleMap();
  const defaultSubscribeResponse = defaultMap.nodes.find((node) => node.id === 'subscribe-response');
  assert(defaultSubscribeResponse, 'default map is missing SubscribeResponse');
  assert(
    !(defaultSubscribeResponse.data.fields?.some((field) => field.name === 'error') ?? false),
    'default SubscribeResponse must hide deprecated error field',
  );
  assert(
    defaultMap.nodes.every((node) => !node.data.deprecated),
    'default map must hide deprecated nodes',
  );
  assert(
    defaultMap.nodes.every((node) => (node.data.fields ?? []).every((field) => !field.deprecated)),
    'default map must hide deprecated fields',
  );

  const deprecatedMap = getVisibleMap({ showDeprecated: true });
  const deprecatedSubscribeResponse = deprecatedMap.nodes.find(
    (node) => node.id === 'subscribe-response',
  );
  assert(
    deprecatedSubscribeResponse?.data.fields?.some((field) => field.name === 'error'),
    'deprecated map must include SubscribeResponse.error',
  );
}

async function validateReadableLayout(nodes: MapNode[], edges: MapEdge[], label: string): Promise<void> {
  const layoutNodes = await computeReadableNodeLayout(nodes, edges);
  const layout = routeReadableLayout(layoutNodes, edges);

  for (let firstIndex = 0; firstIndex < layout.nodes.length; firstIndex += 1) {
    const first = layout.nodes[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < layout.nodes.length; secondIndex += 1) {
      const second = layout.nodes[secondIndex];
      assert(!nodesOverlap(first, second), `${label}: nodes ${first.id} and ${second.id} overlap`);
    }
  }

  for (const routedEdge of layout.edges) {
    for (const node of layout.nodes) {
      if (node.id === routedEdge.edge.source || node.id === routedEdge.edge.target) {
        continue;
      }

      assert(
        !routeIntersectsNode(routedEdge.routePoints, node),
        `${label}: edge ${routedEdge.edge.id} intersects node ${node.id}`,
      );
    }
  }
}

function nodesOverlap(first: MapNode, second: MapNode): boolean {
  return (
    first.position.x < second.position.x + mapNodeWidth(second) &&
    first.position.x + mapNodeWidth(first) > second.position.x &&
    first.position.y < second.position.y + estimatedMapNodeHeight(second) &&
    first.position.y + estimatedMapNodeHeight(first) > second.position.y
  );
}

async function main(): Promise<void> {
  const appDefaultMap = getVisibleMap({ showExtensions: false });
  const extensionMap = getVisibleMap({ showExtensions: true });
  const deprecatedMap = getVisibleMap({ showDeprecated: true, showExtensions: false });
  const fullMap = getVisibleMap({ showDeprecated: true, showExtensions: true });

  validateEdges(mapNodes, mapEdges, 'raw map');
  validateEdges(appDefaultMap.nodes, appDefaultMap.edges, 'default map');
  validateEdges(deprecatedMap.nodes, deprecatedMap.edges, 'deprecated map');
  validateLinks();
  validateDeprecatedVisibility();

  await validateReadableLayout(appDefaultMap.nodes, appDefaultMap.edges, 'default layout');
  await validateReadableLayout(extensionMap.nodes, extensionMap.edges, 'extension layout');
  await validateReadableLayout(deprecatedMap.nodes, deprecatedMap.edges, 'deprecated layout');
  await validateReadableLayout(fullMap.nodes, fullMap.edges, 'full layout');

  console.log('Map data is valid');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
