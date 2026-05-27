import {
  getVisibleMap as getGnmiVisibleMap,
  mapSource as gnmiMapSource,
} from './gnmiMap';
import {
  getGnoiVisibleMap,
  getGnsiVisibleMap,
  getGribiVisibleMap,
  gnoiMapSource,
  gnsiMapSource,
  gribiMapSource,
} from './generatedServiceMaps';
import type { MapEdge, MapNode, VisibleMap, VisibleMapOptions } from './protoMapTypes';

export type ServiceId = 'gnmi' | 'gnoi' | 'gnsi' | 'gribi';

export type ServiceMapChoice = {
  id: string;
  label: string;
  symbol: string;
  focusNodeId?: string;
  sourceTag?: string;
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
  serviceChoices: ServiceMapChoice[];
  defaultServiceChoiceId: string;
  getVisibleMap: (options?: VisibleMapOptions) => VisibleMap;
};

function generatedChoices(
  services: Array<{
    nodeId: string;
    name: string;
    symbol: string;
    choiceId?: string;
    focusNodeId?: string;
    sourceTag?: string;
    version?: string;
  }>,
): ServiceMapChoice[] {
  return services.map((service) => ({
    id: service.choiceId ?? service.nodeId,
    label: service.name,
    symbol: service.symbol,
    focusNodeId: service.focusNodeId ?? service.nodeId,
    ...(service.sourceTag ? { sourceTag: service.sourceTag } : {}),
    ...(service.version ? { version: service.version } : {}),
  }));
}

const gnmiServiceChoices = generatedChoices(gnmiMapSource.services);
const gnoiServiceChoices = generatedChoices(gnoiMapSource.services);
const gnsiServiceChoices = generatedChoices(gnsiMapSource.services);
const gribiServiceChoices = generatedChoices(gribiMapSource.services);

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
    serviceChoices: gnmiServiceChoices,
    defaultServiceChoiceId: gnmiServiceChoices[0].id,
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
    getVisibleMap: getFocusedGnoiVisibleMap,
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
    getVisibleMap: getFocusedGnsiVisibleMap,
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
  rpcFilterId?: string | null;
};

export type ServiceRouteLocation = {
  pathname: string;
  search: string;
  hash: string;
};

function defaultServiceRoute(): ServiceRoute {
  const serviceMap = serviceMaps[defaultServiceId];
  return {
    serviceId: defaultServiceId,
    serviceChoiceId: serviceMap.defaultServiceChoiceId,
  };
}

export function serviceChoiceForRoute(
  serviceMap: ServiceMapDefinition,
  value: string | null | undefined,
): ServiceMapChoice {
  const normalizedValue = value?.toLowerCase();
  return (
    serviceMap.serviceChoices.find(
      (choice) =>
        choice.id.toLowerCase() === normalizedValue ||
        choice.focusNodeId?.toLowerCase() === normalizedValue ||
        choice.label.toLowerCase() === normalizedValue ||
        choice.symbol.toLowerCase() === normalizedValue,
    ) ??
    serviceMap.serviceChoices.find((choice) => choice.id === serviceMap.defaultServiceChoiceId) ??
    serviceMap.serviceChoices[0]
  );
}

function normalizeRouteBasePath(basePath: string | undefined): string {
  if (!basePath) {
    return '/';
  }

  let path = basePath.split(/[?#]/)[0];
  if (/^[a-z]+:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      path = '/';
    }
  }

  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  path = path.replace(/\/+$/, '');
  return path || '/';
}

function stripRouteBasePath(pathname: string, basePath: string): string {
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const normalizedBasePath = normalizeRouteBasePath(basePath);

  if (normalizedBasePath === '/') {
    return normalizedPathname;
  }

  if (normalizedPathname === normalizedBasePath) {
    return '/';
  }

  if (normalizedPathname.startsWith(`${normalizedBasePath}/`)) {
    return normalizedPathname.slice(normalizedBasePath.length) || '/';
  }

  return normalizedPathname;
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function routeSegments(pathname: string, basePath: string): string[] {
  return stripRouteBasePath(pathname, basePath)
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map(decodeRouteSegment);
}

function serviceChoiceRouteNodeId(choice: ServiceMapChoice): string {
  return choice.focusNodeId ?? choice.id.split('@')[0] ?? choice.id;
}

function serviceChoiceForPath(
  serviceMap: ServiceMapDefinition,
  routeNodeId: string | null | undefined,
  routeVersion: string | null | undefined,
): ServiceMapChoice {
  if (!routeNodeId) {
    return serviceChoiceForRoute(serviceMap, serviceMap.defaultServiceChoiceId);
  }

  const normalizedRouteNodeId = routeNodeId.toLowerCase();
  const normalizedRouteVersion = routeVersion?.toLowerCase();
  const pathChoice = serviceMap.serviceChoices.find((choice) => {
    if (serviceChoiceRouteNodeId(choice).toLowerCase() !== normalizedRouteNodeId) {
      return false;
    }

    return normalizedRouteVersion
      ? choice.version?.toLowerCase() === normalizedRouteVersion
      : true;
  });

  return (
    pathChoice ??
    serviceChoiceForRoute(
      serviceMap,
      routeVersion ? `${routeNodeId}@${routeVersion}` : routeNodeId,
    )
  );
}

function routeVersionForPath(
  serviceMap: ServiceMapDefinition,
  routeNodeId: string | null | undefined,
  routeSegment: string | null | undefined,
): string | null {
  if (!routeNodeId || !routeSegment) {
    return null;
  }

  const normalizedRouteNodeId = routeNodeId.toLowerCase();
  const normalizedRouteSegment = routeSegment.toLowerCase();
  const matchingChoice = serviceMap.serviceChoices.find(
    (choice) =>
      serviceChoiceRouteNodeId(choice).toLowerCase() === normalizedRouteNodeId &&
      choice.version?.toLowerCase() === normalizedRouteSegment,
  );

  return matchingChoice?.version ?? null;
}

export function serviceRouteFromPath(
  pathname: string,
  basePath = '/',
): ServiceRoute | null {
  const [rawServiceId, routeNodeId, routeVersionOrRpcFilterId, routeRpcFilterId] = routeSegments(
    pathname,
    basePath,
  );
  const serviceId = rawServiceId?.toLowerCase();
  if (!isServiceId(serviceId)) {
    return null;
  }

  const serviceMap = serviceMaps[serviceId];
  const routeVersion = routeVersionForPath(
    serviceMap,
    routeNodeId,
    routeVersionOrRpcFilterId,
  );
  const serviceChoice = serviceChoiceForPath(serviceMap, routeNodeId, routeVersion);
  const rpcFilterId = routeVersion ? routeRpcFilterId : routeVersionOrRpcFilterId;

  return {
    serviceId,
    serviceChoiceId: serviceChoice.id,
    ...(rpcFilterId ? { rpcFilterId } : {}),
  };
}

function serviceRouteFromHash(hash: string): ServiceRoute | null {
  const hashPath = hash.replace(/^#\/?/, '');
  if (!hashPath) {
    return null;
  }

  return serviceRouteFromPath(hashPath, '/');
}

function serviceRouteFromSearch(search: string): ServiceRoute | null {
  const query = new URLSearchParams(search);
  const queryServiceId = query.get('service')?.toLowerCase();
  const serviceId = isServiceId(queryServiceId) ? queryServiceId : defaultServiceId;
  const mapChoiceId = query.get('map');
  const rpcFilterId = query.get('rpc');

  if (!queryServiceId && !mapChoiceId && !rpcFilterId) {
    return null;
  }

  const serviceMap = serviceMaps[serviceId];
  const serviceChoice = serviceChoiceForRoute(serviceMap, mapChoiceId);

  return {
    serviceId,
    serviceChoiceId: serviceChoice.id,
    ...(rpcFilterId ? { rpcFilterId } : {}),
  };
}

export function serviceRouteFromLocation(
  location: ServiceRouteLocation,
  basePath = '/',
): ServiceRoute {
  return (
    serviceRouteFromPath(location.pathname, basePath) ??
    serviceRouteFromHash(location.hash) ??
    serviceRouteFromSearch(location.search) ??
    defaultServiceRoute()
  );
}

export function serviceRoutePath(route: ServiceRoute, basePath = '/'): string {
  const serviceMap = serviceMaps[route.serviceId];
  const serviceChoice = serviceChoiceForRoute(serviceMap, route.serviceChoiceId);
  const normalizedBasePath = normalizeRouteBasePath(basePath);
  const pathSegments = [
    route.serviceId,
    serviceChoiceRouteNodeId(serviceChoice),
    ...(serviceChoice.version ? [serviceChoice.version] : []),
    ...(route.rpcFilterId ? [route.rpcFilterId] : []),
  ].map(encodeURIComponent);
  const routePath = `/${pathSegments.join('/')}`;

  return normalizedBasePath === '/' ? routePath : `${normalizedBasePath}${routePath}`;
}

export function getInitialServiceRoute(basePath = '/'): ServiceRoute {
  if (typeof window === 'undefined') {
    return defaultServiceRoute();
  }

  return serviceRouteFromLocation(window.location, basePath);
}

export function getInitialServiceId(basePath = '/'): ServiceId {
  return getInitialServiceRoute(basePath).serviceId;
}

function getFocusedGnmiVisibleMap(options: VisibleMapOptions = {}): VisibleMap {
  return getFocusedServiceRpcVisibleMap(getGnmiVisibleMap, options);
}

function getFocusedGnoiVisibleMap(options: VisibleMapOptions = {}): VisibleMap {
  return getFocusedServiceRpcVisibleMap(getGnoiVisibleMap, options);
}

function getFocusedGnsiVisibleMap(options: VisibleMapOptions = {}): VisibleMap {
  return getFocusedServiceRpcVisibleMap(getGnsiVisibleMap, options);
}

function getFocusedGribiVisibleMap(options: VisibleMapOptions = {}): VisibleMap {
  return getFocusedServiceRpcVisibleMap(getGribiVisibleMap, options);
}

function getFocusedServiceRpcVisibleMap(
  getVisibleMap: (options?: VisibleMapOptions) => VisibleMap,
  options: VisibleMapOptions = {},
): VisibleMap {
  const { focusNodeId, rpcFocusNodeId, showDeprecated, showExtensions, sourceTag } = options;
  const visibleMap = getVisibleMap({ showDeprecated, showExtensions, focusNodeId, sourceTag });
  const serviceNode = visibleMap.nodes.find(
    (node) =>
      node.id === focusNodeId ||
      (node.data.kind === 'service' &&
        node.data.fields?.some((field) => field.ref === rpcFocusNodeId)),
  );
  const focusedRpcField = serviceNode?.data.fields?.find(
    (field) => field.ref === rpcFocusNodeId,
  );

  if (!serviceNode || !rpcFocusNodeId || rpcFocusNodeId === serviceNode.id || !focusedRpcField) {
    return visibleMap;
  }

  if (!visibleMap.nodes.some((node) => node.id === rpcFocusNodeId)) {
    return visibleMap;
  }

  const visibleNodeIds = reachableNodeIds(rpcFocusNodeId, visibleMap.edges);
  visibleNodeIds.add(serviceNode.id);

  const focusedNodes = visibleMap.nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((node) =>
      node.id === serviceNode.id ? serviceNodeForRpcFocus(node, rpcFocusNodeId) : node,
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
