import fs from 'node:fs/promises';
import path from 'node:path';
import protobuf from 'protobufjs';
import {
  type MapBadge,
  type MapBounds,
  type MapEdge,
  type MapEdgeKind,
  type MapField,
  type MapNode,
  type MapNodeKind,
} from '../src/protoMapTypes';

type ServiceFamilyId = 'gnoi' | 'gnsi' | 'gribi';
type Definition = protobuf.Type | protobuf.Enum;
type Definitions = Map<string, Definition>;
type ByShortName = Map<string, string[]>;
type DefinitionLineStackEntry = {
  name: string;
  depth: number;
};
type ProtoNamespace = protobuf.ReflectionObject & {
  nested?: Record<string, protobuf.ReflectionObject>;
};
type ProtoField = protobuf.Field & {
  keyType?: string;
};
type GitHubTag = {
  name: string;
};
type GitTree = {
  tree: Array<{
    path: string;
    type: string;
  }>;
};
type SourceLocation = {
  path: string;
  line: number;
};
type SourceFile = {
  path: string;
  text: string;
  serviceVersion?: string;
  definitionLines: Map<string, number>;
  methodLines: Map<string, number>;
};
type ServiceFamilyConfig = {
  id: ServiceFamilyId;
  label: string;
  repository: `openconfig/${string}`;
  versionSource: 'service-option' | 'repository-tag';
};
type GeneratedFamily = {
  id: ServiceFamilyId;
  label: string;
  repository: string;
  tag: string;
  githubBase: string;
  rawBase: string;
  protoFiles: string[];
  services: ServiceSummary[];
  nodes: MapNode[];
  edges: MapEdge[];
  bounds: MapBounds;
  variants: GeneratedFamilyVariant[];
};
type GeneratedFamilyVariant = {
  tag: string;
  githubBase: string;
  rawBase: string;
  protoFiles: string[];
  services: ServiceSummary[];
  nodes: MapNode[];
  edges: MapEdge[];
  bounds: MapBounds;
};
type ServiceSummary = {
  nodeId: string;
  name: string;
  symbol: string;
  choiceId?: string;
  focusNodeId?: string;
  sourceTag?: string;
  version?: string;
};
type ExternalNodeInput = {
  id: string;
  label: string;
  protoUrl?: string;
};

const OUTPUT_PATH = path.resolve('src/generatedServiceMaps.ts');
const GITHUB_API_BASE = 'https://api.github.com/repos';
const GITHUB_WEB_BASE = 'https://github.com';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';

const serviceFamilies: ServiceFamilyConfig[] = [
  {
    id: 'gnoi',
    label: 'gNOI',
    repository: 'openconfig/gnoi',
    versionSource: 'service-option',
  },
  {
    id: 'gnsi',
    label: 'gNSI',
    repository: 'openconfig/gnsi',
    versionSource: 'repository-tag',
  },
  {
    id: 'gribi',
    label: 'gRIBI',
    repository: 'openconfig/gribi',
    versionSource: 'repository-tag',
  },
];
const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

const SCALAR_TYPES = new Set<string>([
  'bool',
  'bytes',
  'double',
  'fixed32',
  'fixed64',
  'float',
  'int32',
  'int64',
  'sfixed32',
  'sfixed64',
  'sint32',
  'sint64',
  'string',
  'uint32',
  'uint64',
]);

const EXTERNAL_PROTO_URLS = new Map<string, string>([
  ['google.protobuf.Any', 'https://github.com/protocolbuffers/protobuf/blob/main/src/google/protobuf/any.proto'],
  [
    'google.protobuf.Duration',
    'https://github.com/protocolbuffers/protobuf/blob/main/src/google/protobuf/duration.proto',
  ],
  [
    'google.protobuf.Timestamp',
    'https://github.com/protocolbuffers/protobuf/blob/main/src/google/protobuf/timestamp.proto',
  ],
  [
    'google.protobuf.DescriptorProto',
    'https://github.com/protocolbuffers/protobuf/blob/main/src/google/protobuf/descriptor.proto',
  ],
  ['google.rpc.Status', 'https://github.com/googleapis/googleapis/blob/master/google/rpc/status.proto'],
]);

async function fetchJson<T>(url: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/, '');
}

function semverTuple(tag: string): [number, number, number] | null {
  const match = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(first: string, second: string): number {
  const firstTuple = semverTuple(first);
  const secondTuple = semverTuple(second);
  if (!firstTuple || !secondTuple) {
    return 0;
  }

  return (
    firstTuple[0] - secondTuple[0] ||
    firstTuple[1] - secondTuple[1] ||
    firstTuple[2] - secondTuple[2]
  );
}

async function latestTag(repository: string): Promise<string> {
  const latest = (await semverTags(repository)).at(0);
  if (!latest) {
    throw new Error(`Could not resolve a semantic version tag for ${repository}`);
  }
  return latest;
}

async function semverTags(repository: string): Promise<string[]> {
  const tags = await fetchJson<GitHubTag[]>(`${GITHUB_API_BASE}/${repository}/tags?per_page=100`);
  return tags
    .map((tag) => tag.name)
    .filter((tag) => semverTuple(tag))
    .sort(compareSemver)
    .reverse();
}

async function protoPaths(repository: string, tag: string): Promise<string[]> {
  const tree = await fetchJson<GitTree>(
    `${GITHUB_API_BASE}/${repository}/git/trees/${tag}?recursive=1`,
  );
  return tree.tree
    .filter((entry) => entry.type === 'blob' && entry.path.endsWith('.proto'))
    .map((entry) => entry.path)
    .sort();
}

function rawBase(repository: string, tag: string): string {
  return `${GITHUB_RAW_BASE}/${repository}/${tag}`;
}

function githubBase(repository: string, tag: string): string {
  return `${GITHUB_WEB_BASE}/${repository}/blob/${tag}`;
}

function definitionLines(protoText: string): Map<string, number> {
  const lines = new Map<string, number>();
  const stack: DefinitionLineStackEntry[] = [];
  let packageName = '';
  let depth = 0;

  protoText.split('\n').forEach((line, index) => {
    const code = stripLineComment(line);
    const packageMatch = code.match(/^\s*package\s+([A-Za-z0-9_.]+)\s*;/);
    if (packageMatch) {
      packageName = packageMatch[1];
    }

    const definitionMatch = code.match(/^\s*(message|enum|service)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (definitionMatch) {
      const [, , name] = definitionMatch;
      const parents = stack.map((entry) => entry.name);
      const fullName = [packageName, ...parents, name].filter(Boolean).join('.');
      lines.set(fullName, index + 1);
    }

    const openCount = (code.match(/{/g) ?? []).length;
    const closeCount = (code.match(/}/g) ?? []).length;

    if (definitionMatch && openCount > 0) {
      stack.push({ name: definitionMatch[2], depth: depth + openCount });
    }

    depth += openCount - closeCount;
    while (stack.length && depth < stack[stack.length - 1].depth) {
      stack.pop();
    }
  });

  return lines;
}

function methodLines(protoText: string): Map<string, number> {
  const lines = new Map<string, number>();
  const services: DefinitionLineStackEntry[] = [];
  let packageName = '';
  let depth = 0;

  protoText.split('\n').forEach((line, index) => {
    const code = stripLineComment(line);
    const packageMatch = code.match(/^\s*package\s+([A-Za-z0-9_.]+)\s*;/);
    if (packageMatch) {
      packageName = packageMatch[1];
    }

    const serviceMatch = code.match(/^\s*service\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    const methodMatch = code.match(/^\s*rpc\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (methodMatch && services.length) {
      const serviceName = services[services.length - 1].name;
      lines.set(`${packageName}.${serviceName}.${methodMatch[1]}`, index + 1);
    }

    const openCount = (code.match(/{/g) ?? []).length;
    const closeCount = (code.match(/}/g) ?? []).length;

    if (serviceMatch && openCount > 0) {
      services.push({ name: serviceMatch[1], depth: depth + openCount });
    }

    depth += openCount - closeCount;
    while (services.length && depth < services[services.length - 1].depth) {
      services.pop();
    }
  });

  return lines;
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .replace(/\./g, '-')
    .replace(/[^A-Za-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function collectDefinitions(root: protobuf.Root): Definitions {
  const definitions: Definitions = new Map();

  function visit(namespace: ProtoNamespace): void {
    if (!namespace.nested) {
      return;
    }

    Object.values(namespace.nested).forEach((item) => {
      if (item instanceof protobuf.Type || item instanceof protobuf.Enum) {
        definitions.set(item.fullName.replace(/^\./, ''), item);
      }
      visit(item as ProtoNamespace);
    });
  }

  visit(root);
  return definitions;
}

function collectServices(root: protobuf.Root): protobuf.Service[] {
  const services: protobuf.Service[] = [];

  function visit(namespace: ProtoNamespace): void {
    if (!namespace.nested) {
      return;
    }

    Object.values(namespace.nested).forEach((item) => {
      if (item instanceof protobuf.Service) {
        services.push(item);
      }
      visit(item as ProtoNamespace);
    });
  }

  visit(root);
  return services.sort((first, second) => first.fullName.localeCompare(second.fullName));
}

function groupByShortName(definitions: Definitions): ByShortName {
  const byShort: ByShortName = new Map();
  definitions.forEach((_definition, fullName) => {
    const shortName = fullName.split('.').at(-1) ?? fullName;
    byShort.set(shortName, [...(byShort.get(shortName) ?? []), fullName]);
  });
  return byShort;
}

function displayType(field: ProtoField): string {
  const base = field.map ? `map<${field.keyType ?? 'string'},${field.type}>` : field.type;
  return field.repeated ? `repeated ${base}` : base;
}

function candidateSymbols(typeName: string, currentSymbol: string, byShortName: ByShortName): string[] {
  const cleanTypeName = typeName.replace(/^\./, '');
  const currentParts = currentSymbol.split('.');
  const namespaceParts = currentParts.slice(0, -1);
  const rootNamespace = namespaceParts[0];
  const candidates: string[] = [];

  if (cleanTypeName.includes('.')) {
    candidates.push(cleanTypeName);
    if (rootNamespace) {
      candidates.push(`${rootNamespace}.${cleanTypeName}`);
    }
  }

  for (let index = namespaceParts.length; index > 0; index -= 1) {
    candidates.push(`${namespaceParts.slice(0, index).join('.')}.${cleanTypeName}`);
  }

  candidates.push(...(byShortName.get(cleanTypeName.split('.').at(-1) ?? cleanTypeName) ?? []));
  return [...new Set(candidates)];
}

function resolveSymbol(
  typeName: string,
  currentSymbol: string,
  symbolToNodeId: Map<string, string>,
  byShortName: ByShortName,
): string | null {
  const target = candidateSymbols(typeName, currentSymbol, byShortName).find((candidate) =>
    symbolToNodeId.has(candidate),
  );
  return target ? (symbolToNodeId.get(target) ?? null) : null;
}

function fieldRef(
  field: ProtoField,
  currentSymbol: string,
  symbolToNodeId: Map<string, string>,
  byShortName: ByShortName,
  ensureExternalNode: (typeName: string) => string,
): string | null {
  if (!field.map && SCALAR_TYPES.has(field.type)) {
    return null;
  }
  if (field.map && SCALAR_TYPES.has(field.type)) {
    return null;
  }

  return (
    resolveSymbol(field.type, currentSymbol, symbolToNodeId, byShortName) ??
    ensureExternalNode(field.type)
  );
}

function reservedFields(type: protobuf.Type): MapField[] {
  const numbers: string[] = [];
  const names: string[] = [];

  for (const item of type.reserved ?? []) {
    if (Array.isArray(item)) {
      const [start, end] = item;
      numbers.push(start === end ? `${start}` : `${start}-${end}`);
    } else {
      names.push(item);
    }
  }

  const count = Math.max(numbers.length, names.length);
  return Array.from({ length: count }, (_, index) => {
    const name = names[index];
    const number = numbers[index];
    const label = [name, number].filter(Boolean).join(' / ');
    return {
      id: `reserved-${kebab(name ?? number ?? `${index + 1}`)}`,
      type: 'reserved',
      name: label,
      ref: null,
      badge: 'reserved',
    };
  });
}

function enumFields(enumDefinition: protobuf.Enum): MapField[] {
  return Object.entries(enumDefinition.values).map(([name, value]) => ({
    id: kebab(name),
    type: `${value}`,
    name,
    ref: null,
  }));
}

function nodeIdForSymbol(symbol: string): string {
  return kebab(symbol);
}

function rpcNodeId(serviceSymbol: string, methodName: string): string {
  return `rpc-${kebab(`${serviceSymbol}.${methodName}`)}`;
}

function serviceNodeId(serviceSymbol: string): string {
  return `service-${kebab(serviceSymbol)}`;
}

function externalNodeId(typeName: string): string {
  return `external-${kebab(typeName)}`;
}

function sourceMaps(files: SourceFile[]): {
  definitionSource: Map<string, SourceLocation>;
  methodSource: Map<string, SourceLocation>;
} {
  const definitionSource = new Map<string, SourceLocation>();
  const methodSource = new Map<string, SourceLocation>();

  for (const file of files) {
    for (const [symbol, line] of file.definitionLines) {
      definitionSource.set(symbol, { path: file.path, line });
    }
    for (const [symbol, line] of file.methodLines) {
      methodSource.set(symbol, { path: file.path, line });
    }
  }

  return { definitionSource, methodSource };
}

function protoUrl(baseUrl: string, source?: SourceLocation): string | undefined {
  return source ? `${baseUrl}/${source.path}#L${source.line}` : undefined;
}

function serviceVersionFromText(protoText: string): string | undefined {
  const match = protoText.match(
    /option\s+\((?:[A-Za-z0-9_.]+\.)?(?:gnoi_version|gnmi_service)\)\s*=\s*"([^"]+)"/,
  );
  return match?.[1];
}

function serviceVersionForSymbol(
  symbol: string,
  definitionSource: Map<string, SourceLocation>,
  filesByPath: Map<string, SourceFile>,
): string | undefined {
  const source = definitionSource.get(symbol);
  if (!source) {
    return undefined;
  }
  return filesByPath.get(source.path)?.serviceVersion;
}

function fieldData(
  field: ProtoField,
  currentSymbol: string,
  symbolToNodeId: Map<string, string>,
  byShortName: ByShortName,
  ensureExternalNode: (typeName: string) => string,
): MapField {
  const deprecated = Boolean(field.options?.deprecated);
  const data: MapField = {
    id: kebab(field.name),
    type: displayType(field),
    name: field.name,
    ref: fieldRef(field, currentSymbol, symbolToNodeId, byShortName, ensureExternalNode),
  };

  if (field.partOf) {
    data.group = `oneof ${field.partOf.name}`;
  }
  if (deprecated) {
    data.badge = 'deprecated';
    data.deprecated = true;
  }

  return data;
}

function schemaNode(
  definition: Definition,
  symbol: string,
  index: number,
  githubBaseUrl: string,
  definitionSource: Map<string, SourceLocation>,
  symbolToNodeId: Map<string, string>,
  byShortName: ByShortName,
  ensureExternalNode: (typeName: string) => string,
): MapNode {
  const kind: MapNodeKind = definition instanceof protobuf.Enum ? 'enum' : 'message';
  const fields =
    definition instanceof protobuf.Type
      ? [
          ...definition.fieldsArray.map((field) =>
            fieldData(field, symbol, symbolToNodeId, byShortName, ensureExternalNode),
          ),
          ...reservedFields(definition),
        ]
      : enumFields(definition);
  const deprecated = Boolean(definition.options?.deprecated);
  const badges = deprecated ? ['deprecated' as const] : undefined;

  return {
    id: nodeIdForSymbol(symbol),
    type: 'schema',
    position: {
      x: 900 + (index % 3) * 390,
      y: 60 + Math.floor(index / 3) * 120,
    },
    style: {
      width: kind === 'enum' ? 310 : 340,
    },
    data: {
      id: nodeIdForSymbol(symbol),
      kind,
      label: kind === 'enum' ? `enum ${symbol}` : symbol,
      sourceSymbol: symbol,
      deprecated,
      protoUrl: protoUrl(githubBaseUrl, definitionSource.get(symbol)),
      ...(badges?.length ? { badges } : {}),
      fields,
    },
  };
}

function edgeKind(sourceNode: MapNode, field: MapField): MapEdgeKind {
  return sourceNode.data.kind === 'service' && field.type === 'rpc' ? 'rpc' : 'field';
}

function buildEdges(nodes: MapNode[]): MapEdge[] {
  const nodesById = new Map<string, MapNode>(nodes.map((node) => [node.id, node]));
  const edges: MapEdge[] = [];

  for (const node of nodes) {
    for (const field of node.data.fields ?? []) {
      if (!field.ref || !nodesById.has(field.ref)) {
        continue;
      }
      const targetNode = nodesById.get(field.ref);
      if (!targetNode) {
        continue;
      }
      const kind = edgeKind(node, field);
      edges.push({
        id: `${node.id}:${field.id}->${field.ref}`,
        source: node.id,
        sourceHandle: field.id,
        target: field.ref,
        kind,
        deprecated: Boolean(field.deprecated || targetNode.data.deprecated),
      });
    }
  }

  return edges;
}

function mapBounds(nodes: MapNode[]): MapBounds {
  const maxX = Math.max(0, ...nodes.map((node) => node.position.x + Number(node.style?.width ?? 340)));
  const maxY = Math.max(0, ...nodes.map((node) => node.position.y + 120));
  return {
    width: maxX + 80,
    height: maxY + 80,
  };
}

async function sourceFiles(repository: string, tag: string): Promise<SourceFile[]> {
  const paths = await protoPaths(repository, tag);
  const rawBaseUrl = rawBase(repository, tag);
  const files = await Promise.all(
    paths.map(async (protoPath) => {
      const text = await fetchText(`${rawBaseUrl}/${protoPath}`);
      return {
        path: protoPath,
        text,
        serviceVersion: serviceVersionFromText(text),
        definitionLines: definitionLines(text),
        methodLines: methodLines(text),
      };
    }),
  );
  return files;
}

async function generateFamilyVariant(
  config: ServiceFamilyConfig,
  tag: string,
): Promise<GeneratedFamilyVariant> {
  const files = await sourceFiles(config.repository, tag);
  const filesByPath = new Map(files.map((file) => [file.path, file] as const));
  const root = new protobuf.Root();

  for (const file of files) {
    protobuf.parse(file.text, root, { keepCase: true });
  }

  const definitions = collectDefinitions(root);
  const services = collectServices(root);
  const byShortName = groupByShortName(definitions);
  const githubBaseUrl = githubBase(config.repository, tag);
  const { definitionSource, methodSource } = sourceMaps(files);
  const symbolToNodeId = new Map(
    [...definitions.keys()].map((symbol) => [symbol, nodeIdForSymbol(symbol)] as const),
  );
  const externalNodes = new Map<string, ExternalNodeInput>();
  const ensureExternalNode = (typeName: string): string => {
    const id = externalNodeId(typeName);
    if (!externalNodes.has(id)) {
      externalNodes.set(id, {
        id,
        label: typeName,
        protoUrl: EXTERNAL_PROTO_URLS.get(typeName),
      });
    }
    return id;
  };
  const serviceNodes: MapNode[] = services.map((service, index) => {
    const symbol = service.fullName.replace(/^\./, '');
    const version =
      config.versionSource === 'repository-tag'
        ? tag
        : serviceVersionForSymbol(symbol, definitionSource, filesByPath);

    return {
      id: serviceNodeId(symbol),
      type: 'schema',
      position: {
        x: 60,
        y: 60 + index * 130,
      },
      style: {
        width: 370,
      },
      data: {
        id: serviceNodeId(symbol),
        kind: 'service',
        label: `service ${service.name}${version ? ` ${version}` : ''}`,
        sourceSymbol: symbol,
        protoUrl: protoUrl(githubBaseUrl, definitionSource.get(symbol)),
        fields: service.methodsArray.map((method) => ({
          id: kebab(method.name),
          type: 'rpc',
          name: method.name,
          ref: rpcNodeId(symbol, method.name),
          ...(method.requestStream || method.responseStream ? { badge: 'stream' as const } : {}),
        })),
      },
    };
  });
  const rpcNodes = services.flatMap((service, serviceIndex) => {
    const serviceSymbol = service.fullName.replace(/^\./, '');
    return service.methodsArray.map((method, methodIndex) => ({
      id: rpcNodeId(serviceSymbol, method.name),
      type: 'schema' as const,
      position: {
        x: 500,
        y: 60 + serviceIndex * 260 + methodIndex * 105,
      },
      style: {
        width: 280,
      },
      data: {
        id: rpcNodeId(serviceSymbol, method.name),
        kind: 'rpc' as const,
        label: `rpc ${method.name}`,
        protoUrl: protoUrl(githubBaseUrl, methodSource.get(`${serviceSymbol}.${method.name}`)),
        fields: [
          {
            id: 'takes',
            type: method.requestStream ? 'takes stream' : 'takes',
            name: method.requestType,
            ref:
              resolveSymbol(method.requestType, serviceSymbol, symbolToNodeId, byShortName) ??
              ensureExternalNode(method.requestType),
          },
          {
            id: 'returns',
            type: method.responseStream ? 'returns stream' : 'returns',
            name: method.responseType,
            ref:
              resolveSymbol(method.responseType, serviceSymbol, symbolToNodeId, byShortName) ??
              ensureExternalNode(method.responseType),
          },
        ],
      },
    }));
  });
  const definitionNodes = [...definitions.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([symbol, definition], index) =>
      schemaNode(
        definition,
        symbol,
        index,
        githubBaseUrl,
        definitionSource,
        symbolToNodeId,
        byShortName,
        ensureExternalNode,
      ),
    );
  const externalMapNodes: MapNode[] = [...externalNodes.values()]
    .sort((first, second) => first.label.localeCompare(second.label))
    .map((node, index) => ({
      id: node.id,
      type: 'schema',
      position: {
        x: 2100,
        y: 60 + index * 105,
      },
      style: {
        width: 310,
      },
      data: {
        id: node.id,
        kind: 'external',
        label: node.label,
        protoUrl: node.protoUrl,
        fields: [],
      },
    }));
  const nodes = [...serviceNodes, ...rpcNodes, ...definitionNodes, ...externalMapNodes];
  const serviceSummaries = services.map((service) => {
    const symbol = service.fullName.replace(/^\./, '');
    const version =
      config.versionSource === 'repository-tag'
        ? tag
        : serviceVersionForSymbol(symbol, definitionSource, filesByPath);
    return {
      nodeId: serviceNodeId(symbol),
      name: service.name,
      symbol,
      ...(version ? { version } : {}),
    };
  });

  return {
    tag,
    githubBase: githubBaseUrl,
    rawBase: rawBase(config.repository, tag),
    protoFiles: files.map((file) => file.path),
    services: serviceSummaries,
    nodes,
    edges: buildEdges(nodes),
    bounds: mapBounds(nodes),
  };
}

function versionChoiceId(service: ServiceSummary): string {
  return service.version ? `${service.nodeId}@${service.version}` : service.nodeId;
}

function serviceChoiceFromVariant(service: ServiceSummary, tag: string): ServiceSummary {
  return {
    ...service,
    choiceId: versionChoiceId(service),
    focusNodeId: service.nodeId,
    sourceTag: tag,
  };
}

function familyServiceChoices(
  latestVariant: GeneratedFamilyVariant,
  variants: GeneratedFamilyVariant[],
): ServiceSummary[] {
  const choices: ServiceSummary[] = [];
  const seenChoiceIds = new Set<string>();

  for (const latestService of latestVariant.services) {
    for (const variant of variants) {
      const service = variant.services.find(
        (variantService) => variantService.symbol === latestService.symbol,
      );
      if (!service) {
        continue;
      }

      const choiceId = versionChoiceId(service);
      if (seenChoiceIds.has(choiceId)) {
        continue;
      }

      seenChoiceIds.add(choiceId);
      choices.push(service.version ? serviceChoiceFromVariant(service, variant.tag) : service);
    }
  }

  return choices;
}

async function generateFamily(config: ServiceFamilyConfig): Promise<GeneratedFamily> {
  const tags = await semverTags(config.repository);
  if (!tags.length) {
    throw new Error(`Could not resolve a semantic version tag for ${config.repository}`);
  }
  const scannedVariants = await Promise.all(
    tags.map((tag) => generateFamilyVariant(config, tag)),
  );
  const latestVariant = scannedVariants[0];
  const services = familyServiceChoices(latestVariant, scannedVariants);
  const variantTags = new Set([
    latestVariant.tag,
    ...services.map((service) => service.sourceTag).filter(Boolean),
  ]);
  const variants = scannedVariants.filter((variant) => variantTags.has(variant.tag));

  return {
    id: config.id,
    label: config.label,
    repository: config.repository,
    tag: latestVariant.tag,
    githubBase: latestVariant.githubBase,
    rawBase: latestVariant.rawBase,
    protoFiles: latestVariant.protoFiles,
    services,
    nodes: latestVariant.nodes,
    edges: latestVariant.edges,
    bounds: latestVariant.bounds,
    variants,
  };
}

function exportPrefix(id: ServiceFamilyId): string {
  return `${id[0].toUpperCase()}${id.slice(1)}`;
}

function generatedSource(families: GeneratedFamily[]): string {
  const chunks = families.map((family) => {
    const prefix = exportPrefix(family.id);
    const source = {
      id: family.id,
      label: family.label,
      repository: family.repository,
      tag: family.tag,
      githubBase: family.githubBase,
      rawBase: family.rawBase,
      protoFiles: family.protoFiles,
      services: family.services,
    };

    return `export const ${family.id}MapSource = ${JSON.stringify(source, null, 2)};\n\nexport const ${family.id}MapVariants: GeneratedServiceMapVariant[] = ${JSON.stringify(
      family.variants,
      null,
      2,
    )};\n\nexport const ${family.id}MapNodes: MapNode[] = ${family.id}MapVariants[0].nodes;\n\nexport const ${family.id}MapEdges: MapEdge[] = ${family.id}MapVariants[0].edges;\n\nexport const ${family.id}MapBounds: MapBounds = ${family.id}MapVariants[0].bounds;\n\nexport function get${prefix}VisibleMap(options: VisibleMapOptions = {}): VisibleMap {\n  const variant = mapVariantForSourceTag(${family.id}MapVariants, options.sourceTag);\n  return visibleProtoMap(variant.nodes, variant.edges, options);\n}\n`;
  });

  return `// Generated by scripts/generate-service-maps.ts. Do not edit by hand.\n\nimport type { MapBounds, MapEdge, MapNode, VisibleMap, VisibleMapOptions } from './protoMapTypes';\nimport { visibleProtoMap } from './protoMapTypes';\n\ntype GeneratedServiceMapVariant = {\n  tag: string;\n  githubBase: string;\n  rawBase: string;\n  protoFiles: string[];\n  services: Array<{\n    nodeId: string;\n    name: string;\n    symbol: string;\n    choiceId?: string;\n    focusNodeId?: string;\n    sourceTag?: string;\n    version?: string;\n  }>;\n  nodes: MapNode[];\n  edges: MapEdge[];\n  bounds: MapBounds;\n};\n\nfunction mapVariantForSourceTag(\n  variants: GeneratedServiceMapVariant[],\n  sourceTag: string | null | undefined,\n): GeneratedServiceMapVariant {\n  return variants.find((variant) => variant.tag === sourceTag) ?? variants[0];\n}\n\n${chunks.join('\n')}`;
}

async function main() {
  const families = await Promise.all(serviceFamilies.map((config) => generateFamily(config)));
  await fs.writeFile(OUTPUT_PATH, generatedSource(families));
  console.log(
    `Wrote ${OUTPUT_PATH} for ${families
      .map((family) => `${family.repository} ${family.tag}`)
      .join(', ')}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
