import type { MapEdge, MapField, MapNode } from './protoMapTypes';

export type FieldSelection = {
  nodeId: string;
  fieldId: string;
};

export type SelectionHashTarget =
  | {
    kind: 'node';
    nodeId: string;
    hashValue: string;
  }
  | {
    kind: 'field';
    nodeId: string;
    fieldId: string;
    edgeId: string | null;
    hashValue: string;
  };

function decodeSelectionHash(hash: string): string {
  const value = hash.replace(/^#/, '');
  if (!value || value.startsWith('/')) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeSelectionHash(value: string): string {
  return value ? `#${encodeURIComponent(value)}` : '';
}

function selectionHashName(value: string): string {
  return value
    .trim()
    .replace(/\s+v?\d+(?:\.\d+){1,3}(?:[-+][\w.]+)?$/i, '')
    .toLowerCase();
}

function selectionHashValueForNode(node: MapNode): string {
  const name = selectionHashName(node.data.label) || node.id;
  return `${node.data.kind}-${name}`;
}

function selectionHashValueForField(node: MapNode, field: MapField): string {
  const nodeName = selectionHashValueForNode(node);
  const fieldName = selectionHashName(field.name) || field.id;
  return `${nodeName}-field-${fieldName}`;
}

export function selectionHashForTarget(target: SelectionHashTarget | null): string {
  if (!target) {
    return '';
  }

  return encodeSelectionHash(target.hashValue);
}

export function selectionHashForSelection(
  selectedId: string | null,
  selectedField: FieldSelection | null,
  nodes: MapNode[],
): string {
  if (selectedId) {
    const node = nodes.find((currentNode) => currentNode.id === selectedId);
    return node ? encodeSelectionHash(selectionHashValueForNode(node)) : '';
  }

  if (selectedField) {
    const node = nodes.find((currentNode) => currentNode.id === selectedField.nodeId);
    const field = node?.data.fields?.find(
      (currentField) => currentField.id === selectedField.fieldId,
    );
    return node && field ? encodeSelectionHash(selectionHashValueForField(node, field)) : '';
  }

  return '';
}

export function resolveSelectionHash(
  hash: string,
  nodes: MapNode[],
  edges: MapEdge[],
): SelectionHashTarget | null {
  const value = decodeSelectionHash(hash);
  if (!value) {
    return null;
  }

  const selectedNode = nodes.find((node) => selectionHashValueForNode(node) === value);
  if (selectedNode) {
    return {
      kind: 'node',
      nodeId: selectedNode.id,
      hashValue: selectionHashValueForNode(selectedNode),
    };
  }

  const fieldTarget = nodes
    .flatMap((node) =>
      (node.data.fields ?? []).map((field) => ({
        node,
        field,
        hashValue: selectionHashValueForField(node, field),
      })),
    )
    .find((target) => target.hashValue === value);
  if (!fieldTarget) {
    return null;
  }

  const { node: fieldNode, field, hashValue } = fieldTarget;
  const edgeId =
    edges.find((edge) => edge.source === fieldNode.id && edge.sourceHandle === field.id)?.id ?? null;

  return {
    kind: 'field',
    nodeId: fieldNode.id,
    fieldId: field.id,
    edgeId,
    hashValue,
  };
}

export function replaceCurrentUrlHash(hash: string): void {
  const nextUrl = `${window.location.pathname}${window.location.search}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (currentUrl !== nextUrl) {
    window.history.replaceState(null, '', nextUrl);
  }
}
