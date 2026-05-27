import fs from 'node:fs/promises';
import path from 'node:path';
import protobuf from 'protobufjs';
import {
  mapBounds,
  mapNodes as layoutNodes,
  type MapBounds,
  type MapBadge,
  type MapEdge,
  type MapEdgeKind,
  type MapField,
  type MapNode,
  type MapSource,
} from '../src/gnmiMap';

const GNMI_TAGS_API = 'https://api.github.com/repos/openconfig/gnmi/tags?per_page=30';
const GNMI_GITHUB_BASE = 'https://github.com/openconfig/gnmi/blob';
const GNMI_RAW_BASE = 'https://raw.githubusercontent.com/openconfig/gnmi';
const SPECBASE =
  'https://github.com/openconfig/reference/blob/master/rpc/gnmi/gnmi-specification.md';
const OUTPUT_PATH = path.resolve('src/gnmiMap.ts');

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
type SourceKind = 'gnmi' | 'gnmi_ext';
type LinesBySource = Record<SourceKind, Map<string, number>>;
type SymbolMaps = {
  nodeIdToSymbol: Map<string, string>;
  symbolToNodeId: Map<string, string>;
};
type GitHubTag = {
  name: string;
};
type GeneratedSourceInput = {
  nodes: MapNode[];
  edges: MapEdge[];
  bounds: MapBounds;
  source: MapSource;
};

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

const EXTERNAL_REFS = new Map<string, string>([
  ['google.protobuf.Any', 'any'],
  ['google.protobuf.Duration', 'duration'],
]);

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
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
  protoText.split('\n').forEach((line, index) => {
    const match = stripLineComment(line).match(/^\s*rpc\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (match) {
      lines.set(match[1], index + 1);
    }
  });
  return lines;
}

function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .replace(/\./g, '-')
    .toLowerCase();
}

function titleFromNode(node: MapNode): string {
  return node.data.label.replace(/^enum\s+/, '');
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

function groupByShortName(definitions: Definitions): ByShortName {
  const byShort: ByShortName = new Map();
  definitions.forEach((definition, fullName) => {
    const shortName = fullName.split('.').at(-1) ?? fullName;
    byShort.set(shortName, [...(byShort.get(shortName) ?? []), fullName]);
  });
  return byShort;
}

function specUrlFromLayout(node: MapNode): string | undefined {
  if (!node.data.specUrl) {
    return undefined;
  }
  const hash = node.data.specUrl.split('#')[1];
  return hash ? `${SPECBASE}#${hash}` : SPECBASE;
}

function resolveSymbol(
  node: MapNode,
  definitions: Definitions,
  byShortName: ByShortName,
): string | null {
  if (node.data.sourceSymbol) {
    return node.data.sourceSymbol;
  }

  const title = titleFromNode(node);
  if (definitions.has(title)) {
    return title;
  }

  if (title.startsWith('gnmi_ext.')) {
    return title;
  }

  const matches = byShortName.get(title) ?? [];
  if (matches.length === 1) {
    return matches[0];
  }

  const gnmiMatch = matches.find((name) => name.startsWith('gnmi.'));
  if (gnmiMatch) {
    return gnmiMatch;
  }

  const extMatch = matches.find((name) => name.startsWith('gnmi_ext.'));
  if (extMatch) {
    return extMatch;
  }

  return null;
}

function displayType(field: ProtoField): string {
  const base = field.map ? `map<${field.keyType ?? 'string'},${field.type}>` : field.type;
  return field.repeated ? `repeated ${base}` : base;
}

function resolveFieldRef(
  field: ProtoField,
  currentSymbol: string,
  symbolToNodeId: Map<string, string>,
  byShortName: ByShortName,
): string | null {
  if (field.map || SCALAR_TYPES.has(field.type)) {
    return null;
  }

  if (EXTERNAL_REFS.has(field.type)) {
    return EXTERNAL_REFS.get(field.type) ?? null;
  }

  const currentParts = currentSymbol.split('.');
  const packageName = currentParts[0];
  const candidates: string[] = [];

  if (field.type.includes('.')) {
    candidates.push(field.type);
  } else {
    candidates.push(`${currentSymbol}.${field.type}`);
    candidates.push(`${packageName}.${field.type}`);
    candidates.push(...(byShortName.get(field.type) ?? []));
  }

  const target = candidates.find((candidate) => symbolToNodeId.has(candidate));
  return target ? (symbolToNodeId.get(target) ?? null) : null;
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

function fieldData(
  field: ProtoField,
  currentSymbol: string,
  symbolToNodeId: Map<string, string>,
  byShortName: ByShortName,
): MapField {
  const deprecated = Boolean(field.options?.deprecated);
  const data: MapField = {
    id: kebab(field.name),
    type: displayType(field),
    name: field.name,
    ref: resolveFieldRef(field, currentSymbol, symbolToNodeId, byShortName),
  };

  if (field.partOf) {
    data.group = `oneof ${field.partOf.name}`;
  }
  if (deprecated) {
    data.badge = 'deprecated';
    data.deprecated = true;
  } else if (field.name === 'extension' && field.type === 'gnmi_ext.Extension') {
    data.badge = 'optional';
  }

  return data;
}

function enumFields(enumDefinition: protobuf.Enum): MapField[] {
  return Object.entries(enumDefinition.values).map(([name, value]) => ({
    id: kebab(name.replace(/^EID_/, '')),
    type: `${value}`,
    name,
    ref: null,
  }));
}

function protoUrl(source: SourceKind, line: number | undefined, gnmiTag: string): string | undefined {
  if (!line) {
    return undefined;
  }

  const file =
    source === 'gnmi_ext' ? 'proto/gnmi_ext/gnmi_ext.proto' : 'proto/gnmi/gnmi.proto';
  return `${GNMI_GITHUB_BASE}/${gnmiTag}/${file}#L${line}`;
}

function buildSymbolMaps(
  nodes: MapNode[],
  definitions: Definitions,
  byShortName: ByShortName,
): SymbolMaps {
  const symbolToNodeId = new Map<string, string>();
  const nodeIdToSymbol = new Map<string, string>();

  nodes.forEach((node) => {
    const symbol = resolveSymbol(node, definitions, byShortName);
    if (!symbol || !definitions.has(symbol)) {
      return;
    }
    symbolToNodeId.set(symbol, node.id);
    nodeIdToSymbol.set(node.id, symbol);
  });

  return { nodeIdToSymbol, symbolToNodeId };
}

function serviceNode(
  node: MapNode,
  service: protobuf.Service,
  serviceLine: number | undefined,
  serviceVersion: string,
  gnmiTag: string,
): MapNode {
  const methods = service.methodsArray;
  return {
    ...node,
    style: { ...node.style },
    data: {
      id: node.id,
      kind: node.data.kind,
      label: `service gNMI ${serviceVersion}`,
      protoUrl: protoUrl('gnmi', serviceLine, gnmiTag),
      specUrl: specUrlFromLayout(node),
      fields: methods.map((method) => ({
        id: kebab(method.name),
        type: 'rpc',
        name: method.name,
        ref: `rpc-${kebab(method.name)}`,
        ...(method.requestStream || method.responseStream ? { badge: 'stream' as const } : {}),
      })),
    },
  };
}

function rpcNode(
  node: MapNode,
  service: protobuf.Service,
  rpcLines: Map<string, number>,
  gnmiTag: string,
): MapNode {
  const methodName = node.id.replace(
    /^rpc-/,
    '',
  ).replace(/(^|-)([a-z])/g, (_match: string, _separator: string, letter: string) =>
    letter.toUpperCase(),
  );
  const method = service.methods[methodName];
  if (!method) {
    return node;
  }

  return {
    ...node,
    style: { ...node.style },
    data: {
      id: node.id,
      kind: node.data.kind,
      label: `rpc ${method.name}`,
      protoUrl: protoUrl('gnmi', rpcLines.get(method.name), gnmiTag),
      specUrl: specUrlFromLayout(node),
      fields: [
        {
          id: 'takes',
          type: method.requestStream ? 'takes stream' : 'takes',
          name: method.requestType,
          ref: kebab(method.requestType),
        },
        {
          id: 'returns',
          type: method.responseStream ? 'returns stream' : 'returns',
          name: method.responseType,
          ref: kebab(method.responseType),
        },
      ],
    },
  };
}

function schemaNode(
  node: MapNode,
  definition: Definition,
  symbol: string,
  symbolToNodeId: Map<string, string>,
  byShortName: ByShortName,
  linesBySource: LinesBySource,
  gnmiTag: string,
): MapNode {
  const source: SourceKind = symbol.startsWith('gnmi_ext.') ? 'gnmi_ext' : 'gnmi';
  const fields =
    definition instanceof protobuf.Type
      ? [
          ...definition.fieldsArray.map((field) =>
            fieldData(field, symbol, symbolToNodeId, byShortName),
          ),
          ...reservedFields(definition),
        ]
      : enumFields(definition);
  const deprecated = Boolean(definition.options?.deprecated);
  const badges = deprecated
    ? [...new Set<MapBadge>([...(node.data.badges ?? []), 'deprecated'])]
    : node.data.badges?.filter((badge) => badge !== 'deprecated');

  return {
    ...node,
    style: { ...node.style },
    data: {
      id: node.id,
      kind: node.data.kind,
      label: node.data.label,
      sourceSymbol: symbol,
      deprecated,
      protoUrl: protoUrl(source, linesBySource[source].get(symbol), gnmiTag),
      specUrl: specUrlFromLayout(node),
      ...(badges?.length ? { badges } : {}),
      fields,
    },
  };
}

function edgeKind(sourceNode: MapNode, field: MapField, targetNode: MapNode): MapEdgeKind {
  if (field.type === 'rpc') {
    return 'rpc';
  }
  if (field.type.includes('gnmi_ext.Extension')) {
    return 'extension';
  }
  if (sourceNode.data.sourceSymbol?.startsWith('gnmi_ext.')) {
    return 'extension-detail';
  }
  if (targetNode.data.sourceSymbol?.startsWith('gnmi_ext.')) {
    return 'extension-detail';
  }
  return 'field';
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
      const kind = edgeKind(node, field, targetNode);
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

const GENERATED_TYPE_DEFINITIONS = `import type { Edge, Node } from '@xyflow/react';

export type MapNodeKind = 'service' | 'rpc' | 'message' | 'enum' | 'external' | 'legend';
export type MapEdgeKind = 'rpc' | 'field' | 'extension' | 'extension-detail';
export type MapBadge = 'stream' | 'optional' | 'deprecated' | 'reserved';

export type MapSource = {
  gnmiTag: string;
  gnmiServiceVersion: string;
  gnmiBase: string;
  extBase: string;
  specBase: string;
};

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
};

export type VisibleMap = {
  nodes: MapNode[];
  edges: MapEdge[];
};`;

function generatedSource({ nodes, edges, bounds, source }: GeneratedSourceInput): string {
  return `// Generated by scripts/generate-map-data.ts. Do not edit by hand.\n\n${GENERATED_TYPE_DEFINITIONS}\n\nexport const mapSource: MapSource = ${JSON.stringify(
    source,
    null,
    2,
  )};\n\nexport const mapNodes: MapNode[] = ${JSON.stringify(nodes, null, 2)};\n\nexport const mapEdges: MapEdge[] = ${JSON.stringify(
    edges,
    null,
    2,
  )};\n\nexport const mapBounds: MapBounds = ${JSON.stringify(bounds, null, 2)};\n\nexport function getVisibleMap({\n  showDeprecated = false,\n  showExtensions = true,\n}: VisibleMapOptions = {}): VisibleMap {\n  const visibleNodes = mapNodes\n    .filter((node) => node.data.kind !== 'legend')\n    .filter((node) => showDeprecated || !node.data.deprecated)\n    .map((node) => ({\n      ...node,\n      data: {\n        ...node.data,\n        fields: (node.data.fields ?? []).filter((field) => showDeprecated || !field.deprecated),\n      },\n    }));\n  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));\n  const visibleHandles = new Set(\n    visibleNodes.flatMap((node) =>\n      (node.data.fields ?? []).map((field) => \`\${node.id}:\${field.id}\`),\n    ),\n  );\n  const visibleEdges = mapEdges.filter((edge) => {\n    if (!showExtensions && edge.kind === 'extension') {\n      return false;\n    }\n    if (!showDeprecated && edge.deprecated) {\n      return false;\n    }\n    return (\n      visibleNodeIds.has(edge.source) &&\n      visibleNodeIds.has(edge.target) &&\n      visibleHandles.has(\`\${edge.source}:\${edge.sourceHandle}\`)\n    );\n  });\n\n  return { nodes: visibleNodes, edges: visibleEdges };\n}\n`;
}

async function main() {
  const tags = await fetchJson<GitHubTag[]>(GNMI_TAGS_API);
  const latestTag = tags.find((tag) => /^v\d+\.\d+\.\d+$/.test(tag.name));
  if (!latestTag) {
    throw new Error('Could not resolve latest openconfig/gnmi tag');
  }

  const gnmiTag = latestTag.name;
  const gnmiRawUrl = `${GNMI_RAW_BASE}/${gnmiTag}/proto/gnmi/gnmi.proto`;
  const extRawUrl = `${GNMI_RAW_BASE}/${gnmiTag}/proto/gnmi_ext/gnmi_ext.proto`;
  const [gnmiProto, extProto] = await Promise.all([fetchText(gnmiRawUrl), fetchText(extRawUrl)]);

  const root = new protobuf.Root();
  protobuf.parse(extProto, root, { keepCase: true });
  protobuf.parse(gnmiProto, root, { keepCase: true });

  const definitions = collectDefinitions(root);
  const byShortName = groupByShortName(definitions);
  const { nodeIdToSymbol, symbolToNodeId } = buildSymbolMaps(
    layoutNodes,
    definitions,
    byShortName,
  );
  const service = root.lookupService('gnmi.gNMI');
  const gnmiNamespace = root.lookup('gnmi');
  if (!gnmiNamespace) {
    throw new Error('Could not resolve gNMI namespace');
  }
  const serviceVersion = gnmiNamespace.options?.['(gnmi_service)'];
  if (typeof serviceVersion !== 'string') {
    throw new Error('Could not resolve gNMI service version');
  }
  const linesBySource: LinesBySource = {
    gnmi: definitionLines(gnmiProto),
    gnmi_ext: definitionLines(extProto),
  };
  const rpcLines = methodLines(gnmiProto);

  const nodes: MapNode[] = layoutNodes.map((node) => {
    if (node.id === 'service-gnmi') {
      return serviceNode(node, service, linesBySource.gnmi.get('gnmi.gNMI'), serviceVersion, gnmiTag);
    }
    if (node.data.kind === 'rpc') {
      return rpcNode(node, service, rpcLines, gnmiTag);
    }

    const symbol = nodeIdToSymbol.get(node.id);
    if (symbol) {
      const definition = definitions.get(symbol);
      if (!definition) {
        return node;
      }
      return schemaNode(
        node,
        definition,
        symbol,
        symbolToNodeId,
        byShortName,
        linesBySource,
        gnmiTag,
      );
    }

    return {
      ...node,
      style: { ...node.style },
      data: {
        ...node.data,
        id: node.id,
        specUrl: specUrlFromLayout(node),
      },
    };
  });
  const edges = buildEdges(nodes);
  const source: MapSource = {
    gnmiTag,
    gnmiServiceVersion: serviceVersion,
    gnmiBase: `${GNMI_GITHUB_BASE}/${gnmiTag}/proto/gnmi/gnmi.proto`,
    extBase: `${GNMI_GITHUB_BASE}/${gnmiTag}/proto/gnmi_ext/gnmi_ext.proto`,
    specBase: SPECBASE,
  };

  await fs.writeFile(OUTPUT_PATH, generatedSource({ nodes, edges, bounds: mapBounds, source }));
  console.log(`Wrote ${OUTPUT_PATH} from openconfig/gnmi ${gnmiTag}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
