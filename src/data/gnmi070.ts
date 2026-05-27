import type { Edge, Node } from '@xyflow/react';

const GNMI_PROTO =
  'https://github.com/openconfig/gnmi/blob/d19cebf5e7be48e7a6fa9fbdff668d18ad87be9d/proto/gnmi/gnmi.proto';
const GNMI_EXT_PROTO =
  'https://github.com/openconfig/gnmi/blob/d19cebf5e7be48e7a6fa9fbdff668d18ad87be9d/proto/gnmi_ext/gnmi_ext.proto';
const SPEC =
  'https://github.com/openconfig/reference/blob/638fba23f697d67a0f8b6b683d492b8a1254817d/rpc/gnmi/gnmi-specification.md';

export type GnmiNodeKind =
  | 'service'
  | 'rpc'
  | 'message'
  | 'enum'
  | 'oneof'
  | 'embedded'
  | 'extension'
  | 'deprecated';

export type GnmiField = {
  signature: string;
  target?: string;
  handleId?: string;
  deprecated?: boolean;
};

export type GnmiNodeData = {
  title: string;
  kind: GnmiNodeKind;
  subtitle?: string;
  packageName?: string;
  fields?: GnmiField[];
  values?: string[];
  visibleHandles?: {
    headerSource?: boolean;
    headerTarget?: boolean;
    fieldSources?: string[];
    fieldTargets?: string[];
  };
  docsUrl?: string;
  codeUrl?: string;
  codePath?: string;
  note?: string;
};

export type GnmiNode = Node<GnmiNodeData, 'gnmi'>;
export type GnmiEdge = Edge<{ relation: string }>;

export const HEADER_SOURCE_HANDLE = 'header-source';
export const HEADER_TARGET_HANDLE = 'header-target';

const proto = (line: number) => `${GNMI_PROTO}#L${line}`;
const extProto = (line: number) => `${GNMI_EXT_PROTO}#L${line}`;
const spec = (anchor: string) => `${SPEC}#${anchor}`;

const codePath = (path: string, line: number) => `${path}#L${line}`;
const slugHandle = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const fieldHandleId = (signature: string) => `field-${slugHandle(signature)}`;

const withFieldHandles = (fields?: GnmiField[]) =>
  fields?.map((field) => ({
    ...field,
    handleId: field.handleId ?? fieldHandleId(field.signature),
  }));

const node = (
  id: string,
  position: { x: number; y: number },
  data: GnmiNodeData,
): GnmiNode => ({
  id,
  type: 'gnmi',
  position,
  data: {
    ...data,
    fields: withFieldHandles(data.fields),
  },
});

const findSourceHandle = (source: string, target: string, relation: string) => {
  const sourceNode = gnmiNodes.find((node) => node.id === source);
  const candidates = sourceNode?.data.fields?.filter((field) => field.target === target) ?? [];
  const normalizedRelation = relation.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const relationTokens = normalizedRelation.split(' ').filter(Boolean);

  const field =
    candidates.find((candidate) => {
      const signature = candidate.signature.toLowerCase();
      return relationTokens.some((token) => signature.includes(token));
    }) ?? candidates[0];

  return field?.handleId ?? HEADER_SOURCE_HANDLE;
};

const edge = (
  source: string,
  target: string,
  relation: string,
  kind: 'rpc' | 'field' | 'oneof' | 'service' | 'deprecated' = 'field',
): GnmiEdge => ({
  id: `${source}-${relation}-${target}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase(),
  source,
  target,
  sourceHandle: findSourceHandle(source, target, relation),
  targetHandle: HEADER_TARGET_HANDLE,
  label: relation,
  type: 'smart',
  animated: kind === 'rpc',
  data: { relation },
  className: `edge-${kind}`,
});

export const gnmiNodes: GnmiNode[] = [
  node('service-gnmi', { x: 700, y: 410 }, {
    title: 'service gNMI 0.7.0',
    kind: 'service',
    subtitle: 'OpenConfig gRPC Network Management Interface',
    docsUrl: spec('grpc-network-management-interface-gnmi'),
    codeUrl: proto(44),
    codePath: codePath('proto/gnmi/gnmi.proto', 44),
    fields: [
      { signature: 'rpc Capabilities', target: 'rpc-capabilities' },
      { signature: 'rpc Get', target: 'rpc-get' },
      { signature: 'rpc Set', target: 'rpc-set' },
      { signature: 'rpc Subscribe', target: 'rpc-subscribe' },
    ],
  }),
  node('rpc-capabilities', { x: 710, y: 80 }, {
    title: 'Capabilities',
    kind: 'rpc',
    subtitle: 'Capability discovery',
    docsUrl: spec('32-capability-discovery'),
    codeUrl: proto(51),
    codePath: codePath('proto/gnmi/gnmi.proto', 51),
    fields: [
      { signature: 'takes CapabilityRequest', target: 'capability-request' },
      { signature: 'returns CapabilityResponse', target: 'capability-response' },
    ],
  }),
  node('rpc-get', { x: 80, y: 430 }, {
    title: 'Get',
    kind: 'rpc',
    subtitle: 'Retrieve snapshots of state',
    docsUrl: spec('33-retrieving-snapshots-of-state-information'),
    codeUrl: proto(57),
    codePath: codePath('proto/gnmi/gnmi.proto', 57),
    fields: [
      { signature: 'takes GetRequest', target: 'get-request' },
      { signature: 'returns GetResponse', target: 'get-response' },
    ],
  }),
  node('rpc-set', { x: 1290, y: 430 }, {
    title: 'Set',
    kind: 'rpc',
    subtitle: 'Modify state',
    docsUrl: spec('34-modifying-state'),
    codeUrl: proto(62),
    codePath: codePath('proto/gnmi/gnmi.proto', 62),
    fields: [
      { signature: 'takes SetRequest', target: 'set-request' },
      { signature: 'returns SetResponse', target: 'set-response' },
    ],
  }),
  node('rpc-subscribe', { x: 710, y: 880 }, {
    title: 'Subscribe',
    kind: 'rpc',
    subtitle: 'Telemetry update stream',
    docsUrl: spec('35-subscribing-to-telemetry-updates'),
    codeUrl: proto(68),
    codePath: codePath('proto/gnmi/gnmi.proto', 68),
    fields: [
      { signature: 'takes SubscribeRequest', target: 'subscribe-request' },
      { signature: 'returns SubscribeResponse', target: 'subscribe-response' },
    ],
  }),

  node('capability-request', { x: 350, y: 40 }, {
    title: 'CapabilityRequest',
    kind: 'message',
    docsUrl: spec('321-the-capabilityrequest-message'),
    codeUrl: proto(431),
    codePath: codePath('proto/gnmi/gnmi.proto', 431),
    fields: [{ signature: 'repeated gnmi_ext.Extension extension' }],
  }),
  node('capability-response', { x: 1030, y: 40 }, {
    title: 'CapabilityResponse',
    kind: 'message',
    docsUrl: spec('322-the-capabilityresponse-message'),
    codeUrl: proto(440),
    codePath: codePath('proto/gnmi/gnmi.proto', 440),
    fields: [
      { signature: 'repeated ModelData supported_models', target: 'model-data' },
      { signature: 'repeated Encoding supported_encodings', target: 'encoding' },
      { signature: 'string gNMI_version' },
      { signature: 'repeated gnmi_ext.Extension extension' },
    ],
  }),
  node('model-data', { x: 1390, y: 80 }, {
    title: 'ModelData',
    kind: 'message',
    docsUrl: spec('261-the-modeldata-message'),
    codeUrl: proto(454),
    codePath: codePath('proto/gnmi/gnmi.proto', 454),
    fields: [
      { signature: 'string name' },
      { signature: 'string organization' },
      { signature: 'string version' },
    ],
  }),

  node('get-request', { x: 80, y: 120 }, {
    title: 'GetRequest',
    kind: 'message',
    docsUrl: spec('331-the-getrequest-message'),
    codeUrl: proto(389),
    codePath: codePath('proto/gnmi/gnmi.proto', 389),
    fields: [
      { signature: 'repeated Path path', target: 'path' },
      { signature: 'Path prefix', target: 'path' },
      { signature: 'DataType type', target: 'data-type' },
      { signature: 'Encoding encoding', target: 'encoding' },
      { signature: 'repeated ModelData use_models', target: 'model-data' },
      { signature: 'repeated gnmi_ext.Extension extension' },
    ],
  }),
  node('get-response', { x: 80, y: 660 }, {
    title: 'GetResponse',
    kind: 'message',
    docsUrl: spec('332-the-getresponse-message'),
    codeUrl: proto(416),
    codePath: codePath('proto/gnmi/gnmi.proto', 416),
    fields: [
      { signature: 'repeated Notification notification', target: 'notification' },
      { signature: 'repeated gnmi_ext.Extension extension' },
      { signature: 'Error error', target: 'error', deprecated: true },
    ],
  }),
  node('data-type', { x: 420, y: 120 }, {
    title: 'DataType',
    kind: 'enum',
    docsUrl: spec('331-the-getrequest-message'),
    codeUrl: proto(395),
    codePath: codePath('proto/gnmi/gnmi.proto', 395),
    values: ['ALL', 'CONFIG', 'STATE', 'OPERATIONAL'],
  }),
  node('encoding', { x: 420, y: 270 }, {
    title: 'Encoding',
    kind: 'enum',
    codeUrl: proto(453),
    codePath: codePath('proto/gnmi/gnmi.proto', 453),
    values: ['JSON', 'BYTES', 'PROTO', 'ASCII', 'JSON_IETF'],
  }),
  node('path', { x: 420, y: 430 }, {
    title: 'Path',
    kind: 'message',
    docsUrl: spec('222-paths'),
    codeUrl: 'https://github.com/openconfig/gnmi/blob/master/proto/gnmi/gnmi.proto#L135',
    codePath: codePath('proto/gnmi/gnmi.proto', 135),
    fields: [
      { signature: 'repeated string element', deprecated: true },
      { signature: 'string origin' },
      { signature: 'repeated PathElem elem', target: 'path-elem' },
      { signature: 'string target' },
    ],
  }),
  node('path-elem', { x: 420, y: 650 }, {
    title: 'PathElem',
    kind: 'message',
    docsUrl: spec('222-paths'),
    codeUrl: 'https://github.com/openconfig/gnmi/blob/master/proto/gnmi/gnmi.proto#L148',
    codePath: codePath('proto/gnmi/gnmi.proto', 148),
    fields: [
      { signature: 'string name' },
      { signature: 'map<string, string> key' },
    ],
  }),
  node('notification', { x: 420, y: 840 }, {
    title: 'Notification',
    kind: 'message',
    docsUrl: spec('21-reusable-notification-message-format'),
    codeUrl: proto(79),
    codePath: codePath('proto/gnmi/gnmi.proto', 79),
    fields: [
      { signature: 'int64 timestamp' },
      { signature: 'Path prefix', target: 'path' },
      { signature: 'string alias' },
      { signature: 'repeated Update update', target: 'update' },
      { signature: 'repeated Path delete', target: 'path' },
      { signature: 'bool atomic' },
    ],
  }),
  node('update', { x: 970, y: 410 }, {
    title: 'Update',
    kind: 'message',
    docsUrl: spec('223-node-values'),
    codeUrl: proto(95),
    codePath: codePath('proto/gnmi/gnmi.proto', 95),
    fields: [
      { signature: 'Path path', target: 'path' },
      { signature: 'Value value', target: 'value', deprecated: true },
      { signature: 'TypedValue val', target: 'typed-value' },
      { signature: 'uint32 duplicates' },
    ],
  }),
  node('typed-value', { x: 690, y: 600 }, {
    title: 'TypedValue',
    kind: 'message',
    docsUrl: spec('223-node-values'),
    codeUrl: proto(167),
    codePath: codePath('proto/gnmi/gnmi.proto', 167),
    fields: [
      { signature: 'oneof value', target: 'typed-value-oneof' },
      { signature: 'string string_val' },
      { signature: 'int64 int_val' },
      { signature: 'uint64 uint_val' },
      { signature: 'bool bool_val' },
      { signature: 'bytes bytes_val' },
      { signature: 'float float_val' },
      { signature: 'Decimal64 decimal_val', target: 'decimal64' },
      { signature: 'ScalarArray leaflist_val', target: 'scalar-array' },
      { signature: 'google.protobuf.Any any_val', target: 'protobuf-any' },
      { signature: 'bytes json_val' },
      { signature: 'bytes json_ietf_val' },
      { signature: 'string ascii_val' },
      { signature: 'bytes proto_bytes' },
    ],
  }),
  node('typed-value-oneof', { x: 690, y: 800 }, {
    title: 'oneof value',
    kind: 'oneof',
    subtitle: 'TypedValue variants',
    fields: [
      { signature: 'scalar primitives' },
      { signature: 'Decimal64 decimal_val', target: 'decimal64' },
      { signature: 'ScalarArray leaflist_val', target: 'scalar-array' },
      { signature: 'google.protobuf.Any any_val', target: 'protobuf-any' },
      { signature: 'JSON / JSON_IETF / ASCII / proto bytes' },
    ],
  }),
  node('decimal64', { x: 690, y: 1110 }, {
    title: 'Decimal64',
    kind: 'message',
    codeUrl: proto(189),
    codePath: codePath('proto/gnmi/gnmi.proto', 189),
    fields: [
      { signature: 'int64 digits' },
      { signature: 'uint32 precision' },
    ],
  }),
  node('scalar-array', { x: 970, y: 1110 }, {
    title: 'ScalarArray',
    kind: 'message',
    codeUrl: proto(195),
    codePath: codePath('proto/gnmi/gnmi.proto', 195),
    fields: [{ signature: 'repeated TypedValue element', target: 'typed-value' }],
  }),
  node('protobuf-any', { x: 970, y: 680 }, {
    title: 'google.protobuf.Any',
    kind: 'embedded',
    codeUrl: 'https://github.com/protocolbuffers/protobuf/blob/master/src/google/protobuf/any.proto',
    codePath: 'src/google/protobuf/any.proto',
    fields: [
      { signature: 'string type_url' },
      { signature: 'bytes value' },
    ],
  }),
  node('value', { x: 1190, y: 760 }, {
    title: 'Value',
    kind: 'deprecated',
    docsUrl: spec('223-node-values'),
    codeUrl: proto(104),
    codePath: codePath('proto/gnmi/gnmi.proto', 104),
    note: 'Deprecated in favor of TypedValue.',
  }),
  node('error', { x: 70, y: 920 }, {
    title: 'Error',
    kind: 'deprecated',
    codeUrl: 'https://github.com/openconfig/gnmi/blob/master/proto/gnmi/gnmi.proto#L395',
    codePath: codePath('proto/gnmi/gnmi.proto', 395),
    note: 'Deprecated field/message shown for map completeness.',
  }),

  node('set-request', { x: 1290, y: 120 }, {
    title: 'SetRequest',
    kind: 'message',
    docsUrl: spec('341-the-setrequest-message'),
    codeUrl: proto(332),
    codePath: codePath('proto/gnmi/gnmi.proto', 332),
    fields: [
      { signature: 'Path prefix', target: 'path' },
      { signature: 'repeated Path delete', target: 'path' },
      { signature: 'repeated Update replace', target: 'update' },
      { signature: 'repeated Update update', target: 'update' },
      { signature: 'repeated gnmi_ext.Extension extension' },
    ],
  }),
  node('set-response', { x: 1290, y: 640 }, {
    title: 'SetResponse',
    kind: 'message',
    docsUrl: spec('342-the-setresponse-message'),
    codeUrl: proto(349),
    codePath: codePath('proto/gnmi/gnmi.proto', 349),
    fields: [
      { signature: 'Path prefix', target: 'path' },
      { signature: 'repeated UpdateResult response', target: 'update-result' },
      { signature: 'int64 timestamp' },
      { signature: 'repeated gnmi_ext.Extension extension' },
    ],
  }),
  node('update-result', { x: 1290, y: 910 }, {
    title: 'UpdateResult',
    kind: 'message',
    docsUrl: spec('342-the-setresponse-message'),
    codeUrl: proto(368),
    codePath: codePath('proto/gnmi/gnmi.proto', 368),
    fields: [
      { signature: 'Path path', target: 'path' },
      { signature: 'Operation op', target: 'operation' },
      { signature: 'Error message', target: 'error', deprecated: true },
      { signature: 'int64 timestamp', deprecated: true },
    ],
  }),
  node('operation', { x: 1580, y: 930 }, {
    title: 'Operation',
    kind: 'enum',
    codeUrl: proto(373),
    codePath: codePath('proto/gnmi/gnmi.proto', 373),
    values: ['INVALID', 'DELETE', 'REPLACE', 'UPDATE'],
  }),

  node('subscribe-request', { x: 330, y: 1160 }, {
    title: 'SubscribeRequest',
    kind: 'message',
    docsUrl: spec('3511-the-subscriberequest-message'),
    codeUrl: proto(202),
    codePath: codePath('proto/gnmi/gnmi.proto', 202),
    fields: [
      { signature: 'oneof request', target: 'subscribe-request-oneof' },
      { signature: 'repeated gnmi_ext.Extension extension' },
    ],
  }),
  node('subscribe-request-oneof', { x: 610, y: 1240 }, {
    title: 'oneof request',
    kind: 'oneof',
    fields: [
      { signature: 'SubscriptionList subscribe', target: 'subscription-list' },
      { signature: 'Poll poll', target: 'poll' },
      { signature: 'AliasList aliases', target: 'alias-list' },
    ],
  }),
  node('poll', { x: 330, y: 1420 }, {
    title: 'Poll',
    kind: 'message',
    docsUrl: spec('35153-poll-subscriptions'),
    codeUrl: proto(219),
    codePath: codePath('proto/gnmi/gnmi.proto', 219),
    note: 'Empty message used to request updates for POLL subscriptions.',
  }),
  node('subscription-list', { x: 610, y: 1460 }, {
    title: 'SubscriptionList',
    kind: 'message',
    docsUrl: spec('3512-the-subscriptionlist-message'),
    codeUrl: proto(246),
    codePath: codePath('proto/gnmi/gnmi.proto', 246),
    fields: [
      { signature: 'Path prefix', target: 'path' },
      { signature: 'repeated Subscription subscription', target: 'subscription' },
      { signature: 'bool use_aliases' },
      { signature: 'QOSMarking qos', target: 'qos-marking' },
      { signature: 'Mode mode', target: 'mode' },
      { signature: 'bool allow_aggregation' },
      { signature: 'repeated ModelData use_models', target: 'model-data' },
      { signature: 'Encoding encoding', target: 'encoding' },
      { signature: 'bool updates_only' },
    ],
  }),
  node('subscription', { x: 240, y: 1700 }, {
    title: 'Subscription',
    kind: 'message',
    docsUrl: spec('3513-the-subscription-message'),
    codeUrl: proto(281),
    codePath: codePath('proto/gnmi/gnmi.proto', 281),
    fields: [
      { signature: 'Path path', target: 'path' },
      { signature: 'SubscriptionMode mode', target: 'subscription-mode' },
      { signature: 'uint64 sample_interval' },
      { signature: 'bool suppress_redundant' },
      { signature: 'uint64 heartbeat_interval' },
    ],
  }),
  node('subscription-mode', { x: 560, y: 1750 }, {
    title: 'SubscriptionMode',
    kind: 'enum',
    docsUrl: spec('35152-stream-subscriptions'),
    codeUrl: proto(299),
    codePath: codePath('proto/gnmi/gnmi.proto', 299),
    values: ['TARGET_DEFINED', 'ON_CHANGE', 'SAMPLE'],
  }),
  node('mode', { x: 860, y: 1750 }, {
    title: 'Mode',
    kind: 'enum',
    docsUrl: spec('3512-the-subscriptionlist-message'),
    codeUrl: proto(253),
    codePath: codePath('proto/gnmi/gnmi.proto', 253),
    values: ['STREAM', 'ONCE', 'POLL'],
  }),
  node('qos-marking', { x: 860, y: 1580 }, {
    title: 'QOSMarking',
    kind: 'message',
    docsUrl: spec('3512-the-subscriptionlist-message'),
    codeUrl: proto(308),
    codePath: codePath('proto/gnmi/gnmi.proto', 308),
    fields: [{ signature: 'uint32 marking' }],
  }),
  node('alias-list', { x: 1140, y: 1450 }, {
    title: 'AliasList',
    kind: 'message',
    docsUrl: spec('3516-client-defined-aliases-within-a-subscription'),
    codeUrl: proto(325),
    codePath: codePath('proto/gnmi/gnmi.proto', 325),
    fields: [{ signature: 'repeated Alias alias', target: 'alias' }],
  }),
  node('alias', { x: 1430, y: 1510 }, {
    title: 'Alias',
    kind: 'message',
    docsUrl: spec('242-path-aliases'),
    codeUrl: proto(315),
    codePath: codePath('proto/gnmi/gnmi.proto', 315),
    fields: [
      { signature: 'string alias' },
      { signature: 'Path path', target: 'path' },
    ],
  }),
  node('subscribe-response', { x: 1010, y: 1160 }, {
    title: 'SubscribeResponse',
    kind: 'message',
    docsUrl: spec('3514-the-subscriberesponse-message'),
    codeUrl: proto(226),
    codePath: codePath('proto/gnmi/gnmi.proto', 226),
    fields: [
      { signature: 'oneof response', target: 'subscribe-response-oneof' },
      { signature: 'repeated gnmi_ext.Extension extension' },
    ],
  }),
  node('subscribe-response-oneof', { x: 1110, y: 1350 }, {
    title: 'oneof response',
    kind: 'oneof',
    fields: [
      { signature: 'Notification update', target: 'notification' },
      { signature: 'bool sync_response' },
      { signature: 'Error error', target: 'error', deprecated: true },
    ],
  }),

  node('gnmi-ext-extension', { x: 1660, y: 170 }, {
    title: 'gnmi_ext.Extension',
    kind: 'extension',
    packageName: 'gnmi_ext',
    docsUrl: spec('27-extensions-to-gnmi'),
    codeUrl: extProto(27),
    codePath: codePath('proto/gnmi_ext/gnmi_ext.proto', 27),
    fields: [
      { signature: 'oneof ext' },
      { signature: 'RegisteredExtension registered_ext', target: 'registered-extension' },
      { signature: 'MasterArbitration master_arbitration', target: 'master-arbitration' },
    ],
    note: 'Extension field arrows from gNMI messages are intentionally omitted, matching the PDF legend.',
  }),
  node('registered-extension', { x: 1660, y: 430 }, {
    title: 'RegisteredExtension',
    kind: 'extension',
    packageName: 'gnmi_ext',
    codeUrl: extProto(44),
    codePath: codePath('proto/gnmi_ext/gnmi_ext.proto', 44),
    fields: [
      { signature: 'ExtensionID id', target: 'extension-id' },
      { signature: 'bytes msg' },
    ],
  }),
  node('extension-id', { x: 1660, y: 640 }, {
    title: 'gnmi_ext.ExtensionID',
    kind: 'enum',
    packageName: 'gnmi_ext',
    codeUrl: extProto(37),
    codePath: codePath('proto/gnmi_ext/gnmi_ext.proto', 37),
    values: ['EID_UNSET = 0', 'EID_EXPERIMENTAL = 999'],
  }),
  node('master-arbitration', { x: 1660, y: 830 }, {
    title: 'MasterArbitration',
    kind: 'extension',
    packageName: 'gnmi_ext',
    docsUrl: spec('27-extensions-to-gnmi'),
    codeUrl: extProto(63),
    codePath: codePath('proto/gnmi_ext/gnmi_ext.proto', 63),
    note: 'Arbitration extension type shown with the rest of gnmi_ext.',
  }),
];

export const gnmiEdges: GnmiEdge[] = [
  edge('service-gnmi', 'rpc-capabilities', 'rpc', 'service'),
  edge('service-gnmi', 'rpc-get', 'rpc', 'service'),
  edge('service-gnmi', 'rpc-set', 'rpc', 'service'),
  edge('service-gnmi', 'rpc-subscribe', 'rpc', 'service'),

  edge('rpc-capabilities', 'capability-request', 'takes', 'rpc'),
  edge('rpc-capabilities', 'capability-response', 'returns', 'rpc'),
  edge('rpc-get', 'get-request', 'takes', 'rpc'),
  edge('rpc-get', 'get-response', 'returns', 'rpc'),
  edge('rpc-set', 'set-request', 'takes', 'rpc'),
  edge('rpc-set', 'set-response', 'returns', 'rpc'),
  edge('rpc-subscribe', 'subscribe-request', 'takes', 'rpc'),
  edge('rpc-subscribe', 'subscribe-response', 'returns', 'rpc'),

  edge('capability-response', 'model-data', 'supported_models'),
  edge('capability-response', 'encoding', 'supported_encodings'),
  edge('get-request', 'path', 'path / prefix'),
  edge('get-request', 'data-type', 'type'),
  edge('get-request', 'encoding', 'encoding'),
  edge('get-request', 'model-data', 'use_models'),
  edge('get-response', 'notification', 'notification'),
  edge('get-response', 'error', 'error', 'deprecated'),

  edge('path', 'path-elem', 'elem'),
  edge('notification', 'path', 'prefix / delete'),
  edge('notification', 'update', 'update'),
  edge('update', 'path', 'path'),
  edge('update', 'typed-value', 'val'),
  edge('update', 'value', 'value', 'deprecated'),
  edge('typed-value', 'typed-value-oneof', 'value', 'oneof'),
  edge('typed-value-oneof', 'decimal64', 'decimal_val', 'oneof'),
  edge('typed-value-oneof', 'scalar-array', 'leaflist_val', 'oneof'),
  edge('typed-value-oneof', 'protobuf-any', 'any_val', 'oneof'),
  edge('scalar-array', 'typed-value', 'element'),

  edge('set-request', 'path', 'prefix / delete'),
  edge('set-request', 'update', 'replace / update'),
  edge('set-response', 'path', 'prefix'),
  edge('set-response', 'update-result', 'response'),
  edge('update-result', 'path', 'path'),
  edge('update-result', 'operation', 'op'),
  edge('update-result', 'error', 'message', 'deprecated'),

  edge('subscribe-request', 'subscribe-request-oneof', 'request', 'oneof'),
  edge('subscribe-request-oneof', 'subscription-list', 'subscribe', 'oneof'),
  edge('subscribe-request-oneof', 'poll', 'poll', 'oneof'),
  edge('subscribe-request-oneof', 'alias-list', 'aliases', 'oneof'),
  edge('subscription-list', 'path', 'prefix'),
  edge('subscription-list', 'subscription', 'subscription'),
  edge('subscription-list', 'qos-marking', 'qos'),
  edge('subscription-list', 'mode', 'mode'),
  edge('subscription-list', 'model-data', 'use_models'),
  edge('subscription-list', 'encoding', 'encoding'),
  edge('subscription', 'path', 'path'),
  edge('subscription', 'subscription-mode', 'mode'),
  edge('alias-list', 'alias', 'alias'),
  edge('alias', 'path', 'path'),
  edge('subscribe-response', 'subscribe-response-oneof', 'response', 'oneof'),
  edge('subscribe-response-oneof', 'notification', 'update', 'oneof'),
  edge('subscribe-response-oneof', 'error', 'error', 'deprecated'),

  edge('gnmi-ext-extension', 'registered-extension', 'registered_ext', 'oneof'),
  edge('gnmi-ext-extension', 'master-arbitration', 'master_arbitration', 'oneof'),
  edge('registered-extension', 'extension-id', 'id'),
];

export const sourceLinks = {
  project: 'https://github.com/hellt/gnmi-map',
  author: 'https://netdevops.me/',
  social: 'https://twitter.com/ntdvps',
};
