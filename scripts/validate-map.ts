import {
  getVisibleMap,
  mapEdges,
  mapNodes,
  mapSource,
} from '../src/gnmiMap';
import {
  computeReadableNodeLayout,
  estimatedMapNodeHeight,
  mapNodeWidth,
  routeIntersectsNode,
  routeReadableLayout,
  type ReadableNodeLayoutOptions,
} from '../src/mapLayout';
import type { MapEdge, MapNode } from '../src/protoMapTypes';
import { serviceMapOrder, serviceMaps } from '../src/serviceMaps';

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

function validateServiceRegistryMaps(): void {
  for (const serviceId of serviceMapOrder) {
    const serviceMap = serviceMaps[serviceId];
    const fullMap = serviceMap.getVisibleMap({ showDeprecated: true, showExtensions: true });
    const serviceNodeCount = fullMap.nodes.filter((node) => node.data.kind === 'service').length;
    const rpcNodeCount = fullMap.nodes.filter((node) => node.data.kind === 'rpc').length;

    assert(serviceNodeCount > 0, `${serviceId}: map must include service nodes`);
    assert(rpcNodeCount > 0, `${serviceId}: map must include RPC nodes`);
    assert(fullMap.edges.length > 0, `${serviceId}: map must include relationships`);
    validateEdges(fullMap.nodes, fullMap.edges, `${serviceId} full map`);

    for (const serviceChoice of serviceMap.serviceChoices) {
      const focusedMap = serviceMap.getVisibleMap({
        showDeprecated: true,
        showExtensions: true,
        focusNodeId: serviceChoice.id,
      });
      assert(
        focusedMap.nodes.some((node) => node.id === serviceChoice.id),
        `${serviceId}/${serviceChoice.label}: focused map must include selected service node`,
      );
      assert(
        focusedMap.nodes.some((node) => node.data.kind === 'rpc'),
        `${serviceId}/${serviceChoice.label}: focused map must include RPC nodes`,
      );
      assert(
        focusedMap.nodes.length < fullMap.nodes.length ||
          serviceChoice.id === serviceMap.defaultServiceChoiceId ||
          serviceMap.serviceChoices.length === 1,
        `${serviceId}/${serviceChoice.label}: focused map should be narrower than family map`,
      );
      validateEdges(focusedMap.nodes, focusedMap.edges, `${serviceId}/${serviceChoice.label}`);
    }
  }
}

async function validateReadableLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  label: string,
  options: ReadableNodeLayoutOptions = {},
): Promise<void> {
  const layoutNodes = await computeReadableNodeLayout(nodes, edges, options);
  const layout = routeReadableLayout(layoutNodes, edges, options);
  const routeMargin = options.compact ? 80 : 180;

  for (let firstIndex = 0; firstIndex < layout.nodes.length; firstIndex += 1) {
    const first = layout.nodes[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < layout.nodes.length; secondIndex += 1) {
      const second = layout.nodes[secondIndex];
      assert(!nodesOverlap(first, second), `${label}: nodes ${first.id} and ${second.id} overlap`);
    }
  }

  for (const routedEdge of layout.edges) {
    for (const point of routedEdge.routePoints) {
      assert(
        point.x >= layout.bounds.x - routeMargin &&
          point.x <= layout.bounds.x + layout.bounds.width + routeMargin &&
          point.y >= layout.bounds.y - routeMargin &&
          point.y <= layout.bounds.y + layout.bounds.height + routeMargin,
        `${label}: edge ${routedEdge.edge.id} routes too far outside the graph`,
      );
    }

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
  validateServiceRegistryMaps();

  await validateReadableLayout(appDefaultMap.nodes, appDefaultMap.edges, 'default layout');
  await validateReadableLayout(extensionMap.nodes, extensionMap.edges, 'extension layout');
  await validateReadableLayout(deprecatedMap.nodes, deprecatedMap.edges, 'deprecated layout');
  await validateReadableLayout(fullMap.nodes, fullMap.edges, 'full layout');

  for (const [serviceId, serviceChoiceIds] of [
    ['gnmi', ['rpc-capabilities', 'rpc-get', 'rpc-set', 'rpc-subscribe']],
    [
      'gribi',
      serviceMaps.gribi.serviceChoices
        .filter((choice) => choice.id !== serviceMaps.gribi.defaultServiceChoiceId)
        .map((choice) => choice.id),
    ],
  ] as const) {
    for (const serviceChoiceId of serviceChoiceIds) {
      for (const options of [
        { showDeprecated: false, showExtensions: false },
        { showDeprecated: true, showExtensions: true },
      ]) {
        const focusedMap = serviceMaps[serviceId].getVisibleMap({
          ...options,
          focusNodeId: serviceChoiceId,
        });
        await validateReadableLayout(
          focusedMap.nodes,
          focusedMap.edges,
          `${serviceId} ${serviceChoiceId} compact layout`,
          { compact: true },
        );
      }
    }
  }

  console.log('Map data is valid');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
