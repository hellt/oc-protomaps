import {
  getVisibleMap as getGnmiVisibleMap,
  type MapEdge,
  type MapNode,
  mapSource as gnmiMapSource,
} from './gnmiMap';
import {
  getGnoiVisibleMap,
  getGnsiVisibleMap,
  getGribiVisibleMap,
  gnoiMapSource,
  gnsiMapSource,
  gribiMapNodes,
  gribiMapSource,
} from './generatedServiceMaps';
import type { VisibleMap, VisibleMapOptions } from './protoMapTypes';

export type ServiceId = 'gnmi' | 'gnoi' | 'gnsi' | 'gribi';

export type ServiceMapChoice = {
  id: string;
  label: string;
  symbol: string;
  version?: string;
};

export type ServiceMapDefinition = {
  id: ServiceId;
  label: string;
  title: string;
  description: string;
  sourceRepository: string;
  sourceTag?: string;
  serviceVersion?: string;
  pdfUrl?: string;
  serviceChoices: ServiceMapChoice[];
  defaultServiceChoiceId: string;
  getVisibleMap: (options?: VisibleMapOptions) => VisibleMap;
};

const baseUrl = import.meta.env?.BASE_URL ?? '/';
const gnmiPdfUrl = `${baseUrl}gnmi_0.10.0_map.pdf`;
const gnmiServiceNodeId = 'service-gnmi';
const gribiServiceNodeId = 'service-gribi-g-ribi';

function generatedChoices(
  services: Array<{ nodeId: string; name: string; symbol: string; version?: string }>,
): ServiceMapChoice[] {
  return services.map((service) => ({
    id: service.nodeId,
    label: service.name,
    symbol: service.symbol,
    ...(service.version ? { version: service.version } : {}),
  }));
}

function rpcChoicesFromServiceNode(
  nodes: MapNode[],
  serviceNodeId: string,
  allLabel: string,
): ServiceMapChoice[] {
  const serviceNode = nodes.find((node) => node.id === serviceNodeId);
  if (!serviceNode) {
    return [];
  }

  const serviceSymbol = serviceNode.data.sourceSymbol ?? serviceNode.data.label;

  return [
    {
      id: serviceNodeId,
      label: allLabel,
      symbol: serviceSymbol,
    },
    ...(serviceNode.data.fields ?? [])
      .filter((field) => field.ref)
      .map((field) => ({
        id: field.ref ?? field.id,
        label: field.name,
        symbol: `${serviceSymbol}.${field.name}`,
      })),
  ];
}

const gnmiServiceChoices: ServiceMapChoice[] = [
  {
    id: gnmiServiceNodeId,
    label: 'All RPCs',
    symbol: 'gnmi.gNMI',
  },
  {
    id: 'rpc-capabilities',
    label: 'Capabilities',
    symbol: 'gnmi.gNMI.Capabilities',
  },
  {
    id: 'rpc-get',
    label: 'Get',
    symbol: 'gnmi.gNMI.Get',
  },
  {
    id: 'rpc-set',
    label: 'Set',
    symbol: 'gnmi.gNMI.Set',
  },
  {
    id: 'rpc-subscribe',
    label: 'Subscribe',
    symbol: 'gnmi.gNMI.Subscribe',
  },
];
const gnoiServiceChoices = generatedChoices(gnoiMapSource.services);
const gnsiServiceChoices = generatedChoices(gnsiMapSource.services);
const gribiServiceChoices = rpcChoicesFromServiceNode(
  gribiMapNodes,
  gribiServiceNodeId,
  'All RPCs',
);

export const serviceMaps: Record<ServiceId, ServiceMapDefinition> = {
  gnmi: {
    id: 'gnmi',
    label: 'gNMI',
    title: 'gNMI Service Map',
    description:
      'Configuration, state retrieval, and telemetry subscription RPCs for OpenConfig targets.',
    sourceRepository: 'openconfig/gnmi',
    sourceTag: gnmiMapSource.gnmiTag,
    serviceVersion: gnmiMapSource.gnmiServiceVersion,
    pdfUrl: gnmiPdfUrl,
    serviceChoices: gnmiServiceChoices,
    defaultServiceChoiceId: gnmiServiceNodeId,
    getVisibleMap: getFocusedGnmiVisibleMap,
  },
  gnoi: {
    id: 'gnoi',
    label: 'gNOI',
    title: 'gNOI Service Maps',
    description:
      'Operational RPC services for actions such as file transfer, health checks, certificates, and OS management.',
    sourceRepository: gnoiMapSource.repository,
    sourceTag: gnoiMapSource.tag,
    serviceChoices: gnoiServiceChoices,
    defaultServiceChoiceId:
      gnoiServiceChoices.find((service) => service.label === 'System')?.id ??
      gnoiServiceChoices[0].id,
    getVisibleMap: getGnoiVisibleMap,
  },
  gnsi: {
    id: 'gnsi',
    label: 'gNSI',
    title: 'gNSI Service Maps',
    description:
      'Security RPC services for authorization, certificates, credentials, accounting, and related controls.',
    sourceRepository: gnsiMapSource.repository,
    sourceTag: gnsiMapSource.tag,
    serviceChoices: gnsiServiceChoices,
    defaultServiceChoiceId:
      gnsiServiceChoices.find((service) => service.label === 'Authz')?.id ??
      gnsiServiceChoices[0].id,
    getVisibleMap: getGnsiVisibleMap,
  },
  gribi: {
    id: 'gribi',
    label: 'gRIBI',
    title: 'gRIBI Service Map',
    description:
      'Routing information base programming RPCs for installing, modifying, and removing forwarding entries.',
    sourceRepository: gribiMapSource.repository,
    sourceTag: gribiMapSource.tag,
    serviceChoices: gribiServiceChoices,
    defaultServiceChoiceId: gribiServiceChoices[0].id,
    getVisibleMap: getFocusedGribiVisibleMap,
  },
};

export const serviceMapOrder: ServiceId[] = ['gnmi', 'gnoi', 'gnsi', 'gribi'];
export const defaultServiceId: ServiceId = 'gnmi';

export function isServiceId(value: string | null | undefined): value is ServiceId {
  return Boolean(value && Object.prototype.hasOwnProperty.call(serviceMaps, value));
}

export type ServiceRoute = {
  serviceId: ServiceId;
  serviceChoiceId: string;
};

export function serviceChoiceForRoute(
  serviceMap: ServiceMapDefinition,
  value: string | null | undefined,
): ServiceMapChoice {
  const normalizedValue = value?.toLowerCase();
  return (
    serviceMap.serviceChoices.find(
      (choice) =>
        choice.id.toLowerCase() === normalizedValue ||
        choice.label.toLowerCase() === normalizedValue ||
        choice.symbol.toLowerCase() === normalizedValue,
    ) ??
    serviceMap.serviceChoices.find((choice) => choice.id === serviceMap.defaultServiceChoiceId) ??
    serviceMap.serviceChoices[0]
  );
}

export function getInitialServiceRoute(): ServiceRoute {
  if (typeof window === 'undefined') {
    const serviceMap = serviceMaps[defaultServiceId];
    return {
      serviceId: defaultServiceId,
      serviceChoiceId: serviceMap.defaultServiceChoiceId,
    };
  }

  const [hashServiceId, hashChoiceId] = window.location.hash
    .replace(/^#\/?/, '')
    .split('/')
    .map((part) => decodeURIComponent(part).toLowerCase());
  const query = new URLSearchParams(window.location.search);
  const queryServiceId = query.get('service')?.toLowerCase();
  const serviceId = isServiceId(hashServiceId)
    ? hashServiceId
    : isServiceId(queryServiceId)
      ? queryServiceId
      : defaultServiceId;
  const serviceMap = serviceMaps[serviceId];
  const serviceChoice = serviceChoiceForRoute(serviceMap, hashChoiceId ?? query.get('map'));

  return {
    serviceId,
    serviceChoiceId: serviceChoice.id,
  };
}

export function getInitialServiceId(): ServiceId {
  return getInitialServiceRoute().serviceId;
}

function getFocusedGnmiVisibleMap(options: VisibleMapOptions = {}): VisibleMap {
  return getFocusedServiceRpcVisibleMap(getGnmiVisibleMap, gnmiServiceNodeId, options);
}

function getFocusedGribiVisibleMap(options: VisibleMapOptions = {}): VisibleMap {
  return getFocusedServiceRpcVisibleMap(getGribiVisibleMap, gribiServiceNodeId, options);
}

function getFocusedServiceRpcVisibleMap(
  getVisibleMap: (options?: VisibleMapOptions) => VisibleMap,
  serviceNodeId: string,
  options: VisibleMapOptions = {},
): VisibleMap {
  const { focusNodeId, showDeprecated, showExtensions } = options;
  const visibleMap = getVisibleMap({ showDeprecated, showExtensions });
  const serviceNode = visibleMap.nodes.find((node) => node.id === serviceNodeId);
  const focusedRpcField = serviceNode?.data.fields?.find((field) => field.ref === focusNodeId);

  if (!focusNodeId || focusNodeId === serviceNodeId || !focusedRpcField) {
    return visibleMap;
  }

  if (!visibleMap.nodes.some((node) => node.id === focusNodeId)) {
    return visibleMap;
  }

  const visibleNodeIds = reachableNodeIds(focusNodeId, visibleMap.edges);
  visibleNodeIds.add(serviceNodeId);

  const focusedNodes = visibleMap.nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((node) =>
      node.id === serviceNodeId ? serviceNodeForRpcFocus(node, focusNodeId) : node,
    );
  const focusedNodeIds = new Set(focusedNodes.map((node) => node.id));
  const focusedHandles = new Set(
    focusedNodes.flatMap((node) =>
      (node.data.fields ?? []).map((field) => `${node.id}:${field.id}`),
    ),
  );
  const focusedEdges = visibleMap.edges.filter(
    (edge) =>
      focusedNodeIds.has(edge.source) &&
      focusedNodeIds.has(edge.target) &&
      focusedHandles.has(`${edge.source}:${edge.sourceHandle}`),
  );

  return {
    nodes: focusedNodes,
    edges: focusedEdges,
  };
}

function serviceNodeForRpcFocus(node: MapNode, rpcNodeId: string): MapNode {
  return {
    ...node,
    data: {
      ...node.data,
      fields: (node.data.fields ?? []).filter((field) => field.ref === rpcNodeId),
    },
  };
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
