import type { MapDiffStatus, MapEdge, MapField, MapNode, VisibleMap } from './protoMapTypes';

export type ProtoMapDiffSummary = {
  addedNodes: number;
  changedNodes: number;
  removedNodes: number;
  addedFields: number;
  changedFields: number;
  removedFields: number;
  addedEdges: number;
  changedEdges: number;
  removedEdges: number;
  breakingChanges: number;
};

export type ProtoMapDiffResult = {
  map: VisibleMap;
  summary: ProtoMapDiffSummary;
};

const emptySummary: ProtoMapDiffSummary = {
  addedNodes: 0,
  changedNodes: 0,
  removedNodes: 0,
  addedFields: 0,
  changedFields: 0,
  removedFields: 0,
  addedEdges: 0,
  changedEdges: 0,
  removedEdges: 0,
  breakingChanges: 0,
};

export function buildProtoMapDiff(currentMap: VisibleMap, baseMap: VisibleMap): ProtoMapDiffResult {
  const summary = { ...emptySummary };
  const baseNodesById = new Map(baseMap.nodes.map((node) => [node.id, node]));
  const currentNodesById = new Map(currentMap.nodes.map((node) => [node.id, node]));
  const baseEdgesById = new Map(baseMap.edges.map((edge) => [edge.id, edge]));
  const currentEdgesById = new Map(currentMap.edges.map((edge) => [edge.id, edge]));
  const nodes: MapNode[] = currentMap.nodes.map((node) => {
    const baseNode = baseNodesById.get(node.id);
    if (!baseNode) {
      summary.addedNodes += 1;
      summary.addedFields += node.data.fields?.length ?? 0;
      return annotateNode(node, 'added', 'Added in selected version', (field) =>
        annotateField(field, 'added', ['Added in selected version']),
      );
    }

    const nodeChanges = nodeChangeDescriptions(node, baseNode);
    const fields = mergeFields(node.data.fields ?? [], baseNode.data.fields ?? [], summary);
    const hasFieldChanges = fields.some((field) => field.diffStatus);
    const diffStatus: MapDiffStatus | undefined =
      nodeChanges.length || hasFieldChanges ? 'changed' : undefined;
    const diffChanges = nodeChanges.length ? nodeChanges : ['Field changes'];

    if (diffStatus) {
      summary.changedNodes += 1;
    }

    return {
      ...node,
      data: {
        ...node.data,
        fields,
        ...(diffStatus ? { diffStatus, diffChanges } : {}),
      },
    };
  });

  for (const baseNode of baseMap.nodes) {
    if (currentNodesById.has(baseNode.id)) {
      continue;
    }

    summary.removedNodes += 1;
    summary.removedFields += baseNode.data.fields?.length ?? 0;
    nodes.push(
      annotateNode(baseNode, 'removed', 'Removed from selected version', (field) =>
        annotateField(field, 'removed', ['Removed from selected version']),
      ),
    );
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const fieldHandles = new Set(
    nodes.flatMap((node) => (node.data.fields ?? []).map((field) => `${node.id}:${field.id}`)),
  );
  const edges = currentMap.edges.map((edge) => {
    const baseEdge = baseEdgesById.get(edge.id);
    if (!baseEdge) {
      summary.addedEdges += 1;
      return annotateEdge(edge, 'added', ['Added in selected version']);
    }

    const changes = edgeChangeDescriptions(edge, baseEdge);
    if (!changes.length) {
      return edge;
    }

    summary.changedEdges += 1;
    return annotateEdge(edge, 'changed', changes);
  });

  for (const baseEdge of baseMap.edges) {
    if (
      currentEdgesById.has(baseEdge.id) ||
      !nodeIds.has(baseEdge.source) ||
      !nodeIds.has(baseEdge.target) ||
      !fieldHandles.has(`${baseEdge.source}:${baseEdge.sourceHandle}`)
    ) {
      continue;
    }

    summary.removedEdges += 1;
    edges.push(annotateEdge(baseEdge, 'removed', ['Removed from selected version']));
  }

  summary.breakingChanges =
    summary.removedNodes +
    summary.removedFields +
    summary.removedEdges +
    summary.changedFields +
    summary.changedEdges;

  return {
    map: { nodes, edges },
    summary,
  };
}

function mergeFields(
  currentFields: MapField[],
  baseFields: MapField[],
  summary: ProtoMapDiffSummary,
): MapField[] {
  const baseFieldsById = new Map(baseFields.map((field) => [field.id, field]));
  const currentFieldsById = new Map(currentFields.map((field) => [field.id, field]));
  const fields = currentFields.map((field) => {
    const baseField = baseFieldsById.get(field.id);
    if (!baseField) {
      summary.addedFields += 1;
      return annotateField(field, 'added', ['Added in selected version']);
    }

    const changes = fieldChangeDescriptions(field, baseField);
    if (!changes.length) {
      return field;
    }

    summary.changedFields += 1;
    return annotateField(field, 'changed', changes);
  });

  for (const baseField of baseFields) {
    if (currentFieldsById.has(baseField.id)) {
      continue;
    }

    summary.removedFields += 1;
    fields.push(annotateField(baseField, 'removed', ['Removed from selected version']));
  }

  return fields;
}

function annotateNode(
  node: MapNode,
  status: MapDiffStatus,
  change: string,
  annotateFields?: (field: MapField) => MapField,
): MapNode {
  return {
    ...node,
    data: {
      ...node.data,
      diffStatus: status,
      diffChanges: [change],
      fields: annotateFields ? (node.data.fields ?? []).map(annotateFields) : node.data.fields,
    },
  };
}

function annotateField(
  field: MapField,
  status: MapDiffStatus,
  changes: string[],
): MapField {
  return {
    ...field,
    diffStatus: status,
    diffChanges: changes,
  };
}

function annotateEdge(edge: MapEdge, status: MapDiffStatus, changes: string[]): MapEdge {
  return {
    ...edge,
    diffStatus: status,
    diffChanges: changes,
  };
}

function nodeChangeDescriptions(current: MapNode, base: MapNode): string[] {
  const changes: string[] = [];
  compareValue(changes, 'label', current.data.label, base.data.label);
  compareValue(changes, 'kind', current.data.kind, base.data.kind);
  compareValue(
    changes,
    'deprecated',
    Boolean(current.data.deprecated),
    Boolean(base.data.deprecated),
  );
  compareValue(
    changes,
    'badges',
    badgeSignature(current.data.badges),
    badgeSignature(base.data.badges),
  );
  return changes;
}

function fieldChangeDescriptions(current: MapField, base: MapField): string[] {
  const changes: string[] = [];
  compareValue(changes, 'type', current.type, base.type);
  compareValue(changes, 'name', current.name, base.name);
  compareValue(changes, 'target', current.ref ?? '', base.ref ?? '');
  compareValue(changes, 'group', current.group ?? '', base.group ?? '');
  compareValue(changes, 'badge', current.badge ?? '', base.badge ?? '');
  compareValue(changes, 'deprecated', Boolean(current.deprecated), Boolean(base.deprecated));
  return changes;
}

function edgeChangeDescriptions(current: MapEdge, base: MapEdge): string[] {
  const changes: string[] = [];
  compareValue(changes, 'source', current.source, base.source);
  compareValue(changes, 'source field', current.sourceHandle, base.sourceHandle);
  compareValue(changes, 'target', current.target, base.target);
  compareValue(changes, 'relationship', current.kind, base.kind);
  compareValue(changes, 'deprecated', Boolean(current.deprecated), Boolean(base.deprecated));
  return changes;
}

function compareValue(
  changes: string[],
  label: string,
  current: string | boolean,
  base: string | boolean,
): void {
  if (current === base) {
    return;
  }

  changes.push(`${label} changed`);
}

function badgeSignature(badges: readonly string[] | undefined): string {
  return [...(badges ?? [])].sort().join(',');
}
