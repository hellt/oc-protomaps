import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BaseEdge,
  type NodeChange,
  Background,
  Controls,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  Handle,
  MarkerType,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  BookOpen,
  ExternalLink,
  EyeOff,
  FileCode2,
  FileDown,
  Focus,
  GitBranch,
  Moon,
  RotateCcw,
  Search,
  Sun,
} from 'lucide-react';
import {
  getVisibleMap,
  type MapEdge,
  type MapEdgeKind,
  type MapField,
  type MapNode,
  mapSource,
} from './gnmiMap';
import {
  applyManualPositions,
  computeReadableNodeLayout,
  improveNodeLayout,
  routeReadableLayout,
  type RoutePoint,
  type TargetHandleLayout,
} from './mapLayout';

const edgeStyleByKind: Record<MapEdgeKind, CSSProperties> = {
  rpc: { stroke: 'var(--edge-rpc)', strokeWidth: 2.2 },
  field: { stroke: 'var(--edge-field)', strokeWidth: 1.6 },
  extension: {
    stroke: 'var(--edge-extension)',
    strokeWidth: 1.4,
    strokeDasharray: '7 6',
  },
  'extension-detail': { stroke: 'var(--edge-extension-detail)', strokeWidth: 1.5 },
};

const nodeTypes: NodeTypes = {
  schema: SchemaNode,
};

const edgeTypes: EdgeTypes = {
  routed: RoutedEdge,
};

const pdfMapUrl = `${import.meta.env.BASE_URL}gnmi_0.10.0_map.pdf`;
const themeStorageKey = 'gnmi-map-theme';

type ThemeMode = 'light' | 'dark';

type NodePosition = {
  x: number;
  y: number;
};

type RoutedEdgeData = Record<string, unknown> & {
  routePoints: RoutePoint[];
  routeBridges: RouteBridge[];
};

type RoutedMapEdge = Edge<RoutedEdgeData, 'routed'> & {
  sourceHandle: string;
  targetHandle: string;
  kind: MapEdgeKind;
  deprecated: boolean;
};

type FieldConnectionIds = Record<string, string>;
type FieldClickHandler = (edgeId: string) => void;

type RouteBridge = RoutePoint & {
  orientation: 'horizontal' | 'vertical';
};

type RouteSegment = {
  edgeId: string;
  index: number;
  start: RoutePoint;
  end: RoutePoint;
  orientation: 'horizontal' | 'vertical';
  fixed: number;
  from: number;
  to: number;
};

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

function getInitialTheme(): ThemeMode {
  const savedTheme = window.localStorage.getItem(themeStorageKey);
  if (isThemeMode(savedTheme)) {
    return savedTheme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function searchableText(node: MapNode): string {
  const fieldText = node.data.fields
    ?.map((field) => `${field.type} ${field.name} ${field.group ?? ''} ${field.badge ?? ''}`)
    .join(' ');

  return `${node.data.kind} ${node.data.label} ${fieldText ?? ''}`.toLowerCase();
}

function fieldMatches(field: MapField, query: string): boolean {
  if (!query) {
    return false;
  }

  return `${field.type} ${field.name} ${field.group ?? ''} ${field.badge ?? ''}`
    .toLowerCase()
    .includes(query);
}

function AppShell() {
  const { fitView } = useReactFlow<MapNode, RoutedMapEdge>();
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [queryValue, setQueryValue] = useState('');
  const [showExtensions, setShowExtensions] = useState(false);
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [manualPositions, setManualPositions] = useState<Record<string, NodePosition>>({});
  const [routingPositions, setRoutingPositions] = useState<Record<string, NodePosition>>({});

  const query = queryValue.trim().toLowerCase();
  const darkMode = theme === 'dark';
  const visibleMap = useMemo(
    () => getVisibleMap({ showDeprecated, showExtensions }),
    [showDeprecated, showExtensions],
  );
  const fallbackLayoutNodes = useMemo(() => improveNodeLayout(visibleMap.nodes), [visibleMap.nodes]);
  const [elkLayoutNodes, setElkLayoutNodes] = useState<MapNode[] | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    setElkLayoutNodes(null);

    computeReadableNodeLayout(visibleMap.nodes, visibleMap.edges)
      .then((layoutNodes) => {
        if (!cancelled) {
          setElkLayoutNodes(layoutNodes);
        }
      })
      .catch((error) => {
        console.error('Failed to compute readable map layout', error);
      });

    return () => {
      cancelled = true;
    };
  }, [visibleMap.edges, visibleMap.nodes]);

  const layoutNodes = elkLayoutNodes ?? fallbackLayoutNodes;
  useEffect(() => {
    if (!elkLayoutNodes) {
      return;
    }

    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => fitView({ padding: 0.1, duration: 350 }));
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [elkLayoutNodes, fitView]);

  const routedLayoutNodes = useMemo(
    () => applyManualPositions(layoutNodes, routingPositions),
    [layoutNodes, routingPositions],
  );
  const readableLayout = useMemo(
    () => routeReadableLayout(routedLayoutNodes, visibleMap.edges),
    [routedLayoutNodes, visibleMap.edges],
  );
  const displayedLayoutNodes = useMemo(
    () => applyManualPositions(readableLayout.nodes, manualPositions),
    [manualPositions, readableLayout.nodes],
  );

  const nodeMatches = useMemo(() => {
    if (!query) {
      return new Set<string>();
    }

    return new Set(
      visibleMap.nodes
        .filter((currentNode) => searchableText(currentNode).includes(query))
        .map((currentNode) => currentNode.id),
    );
  }, [query, visibleMap.nodes]);

  const selectedEdge = useMemo(
    () => visibleMap.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [selectedEdgeId, visibleMap.edges],
  );
  const selectedEdgeEndpointIds = useMemo(
    () =>
      selectedEdge ? new Set([selectedEdge.source, selectedEdge.target]) : new Set<string>(),
    [selectedEdge],
  );
  const edgeIdBySourceHandle = useMemo(
    () =>
      new Map(
        visibleMap.edges.map((edge) => [`${edge.source}:${edge.sourceHandle}`, edge.id] as const),
      ),
    [visibleMap.edges],
  );
  const selectFieldConnection = useCallback((edgeId: string) => {
    setSelectedId(null);
    setSelectedEdgeId(edgeId);
  }, []);

  const nodes = useMemo(
    () =>
      displayedLayoutNodes.map((currentNode) => {
        const active = !query || nodeMatches.has(currentNode.id);
        const edgeEndpoint = selectedEdgeEndpointIds.has(currentNode.id);
        const fieldConnectionIds = Object.fromEntries(
          (currentNode.data.fields ?? [])
            .map((field) => [
              field.id,
              edgeIdBySourceHandle.get(`${currentNode.id}:${field.id}`),
            ])
            .filter((entry): entry is [string, string] => Boolean(entry[1])),
        );

        return {
          ...currentNode,
          selected: selectedId === currentNode.id,
          data: {
            ...currentNode.data,
            active: active || edgeEndpoint,
            edgeEndpoint,
            activeEdgeSourceHandle:
              selectedEdge?.source === currentNode.id ? selectedEdge.sourceHandle : null,
            fieldConnectionIds,
            onFieldConnectionClick: selectFieldConnection,
            query,
            showExtensions,
          },
        };
      }),
    [
      nodeMatches,
      displayedLayoutNodes,
      edgeIdBySourceHandle,
      query,
      selectFieldConnection,
      selectedEdge,
      selectedEdgeEndpointIds,
      selectedId,
      showExtensions,
    ],
  );

  const routeBridgesByEdge = useMemo(
    () => routeBridges(readableLayout.edges),
    [readableLayout.edges],
  );

  const edges = useMemo<RoutedMapEdge[]>(
    () =>
      readableLayout.edges.map(({ edge, routePoints, targetHandle }) => {
        const connectedToMatch =
          !query || nodeMatches.has(edge.source) || nodeMatches.has(edge.target);
        const style = edgeStyleByKind[edge.kind] ?? edgeStyleByKind.field;
        const selected = selectedEdge?.id === edge.id;
        const selectionDimmed = Boolean(selectedEdge) && !selected;
        const opacity = connectedToMatch ? (selectionDimmed ? 0.24 : 1) : 0.14;
        const stroke = selected ? 'var(--edge-selected)' : style.stroke;
        const strokeWidth =
          typeof style.strokeWidth === 'number'
            ? style.strokeWidth + (selected ? 1.8 : 0)
            : style.strokeWidth;

        return {
          ...edge,
          type: 'routed',
          targetHandle,
          selected,
          zIndex: selected ? 12 : 1,
          interactionWidth: 28,
          className: [
            'flow-edge',
            `flow-edge-${edge.kind}`,
            selected ? 'is-selected' : '',
            selectionDimmed ? 'is-dimmed' : '',
          ]
            .filter(Boolean)
            .join(' '),
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
          animated: selected || (query ? connectedToMatch : edge.kind === 'rpc'),
          data: { routePoints, routeBridges: routeBridgesByEdge.get(edge.id) ?? [] },
          style: {
            ...style,
            opacity,
            stroke,
            strokeWidth,
          },
        } satisfies RoutedMapEdge;
      }),
    [nodeMatches, query, readableLayout.edges, routeBridgesByEdge, selectedEdge],
  );

  const selectedNode = useMemo(
    () => nodes.find((currentNode) => currentNode.id === selectedId),
    [nodes, selectedId],
  );

  const fit = useCallback(() => {
    fitView({ padding: 0.12, duration: 450 });
  }, [fitView]);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<MapNode>[]) => {
    setManualPositions((currentPositions) => {
      let nextPositions = currentPositions;

      for (const change of changes) {
        if (change.type !== 'position' || !change.position) {
          continue;
        }

        if (nextPositions === currentPositions) {
          nextPositions = { ...currentPositions };
        }

        nextPositions[change.id] = change.position;
      }

      return nextPositions;
    });

    setRoutingPositions((currentPositions) => {
      let nextPositions = currentPositions;

      for (const change of changes) {
        if (change.type !== 'position' || !change.position || change.dragging !== false) {
          continue;
        }

        if (nextPositions === currentPositions) {
          nextPositions = { ...currentPositions };
        }

        nextPositions[change.id] = change.position;
      }

      return nextPositions;
    });

    setSelectedId((currentSelectedId) => {
      let selectedNodeWasCleared = false;

      for (const change of changes) {
        if (change.type !== 'select') {
          continue;
        }

        if (change.selected) {
          return change.id;
        }

        if (change.id === currentSelectedId) {
          selectedNodeWasCleared = true;
        }
      }

      return selectedNodeWasCleared ? null : currentSelectedId;
    });
  }, []);

  const resetLayout = useCallback(() => {
    setManualPositions({});
    setRoutingPositions({});
    window.requestAnimationFrame(() => fitView({ padding: 0.12, duration: 450 }));
  }, [fitView]);

  const hasManualPositions = Object.keys(manualPositions).length > 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-kicker">gNMI service {mapSource.gnmiServiceVersion}</span>
          <h1>React Flow Map</h1>
        </div>

        <div className="toolbar" role="toolbar" aria-label="Map controls">
          <label className="search-box">
            <Search size={16} aria-hidden="true" />
            <input
              value={queryValue}
              onChange={(event) => setQueryValue(event.target.value)}
              placeholder="Search messages, fields, enums"
              type="search"
            />
          </label>

          <button
            className="theme-switch"
            type="button"
            role="switch"
            aria-checked={darkMode}
            aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
            title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
            onClick={toggleTheme}
          >
            <span className="theme-switch-track" aria-hidden="true">
              <Sun className="theme-switch-icon theme-switch-icon-sun" size={15} />
              <Moon className="theme-switch-icon theme-switch-icon-moon" size={15} />
              <span className="theme-switch-thumb" />
            </span>
          </button>

          <button className="tool-button" type="button" onClick={fit}>
            <Focus size={16} aria-hidden="true" />
            Fit
          </button>

          <button
            className="tool-button"
            type="button"
            onClick={resetLayout}
            disabled={!hasManualPositions}
          >
            <RotateCcw size={16} aria-hidden="true" />
            Reset
          </button>

          <button
            className={`tool-button ${showExtensions ? 'is-active' : ''}`}
            type="button"
            onClick={() => setShowExtensions((value) => !value)}
            aria-pressed={showExtensions}
            data-tooltip="Show gNMI extension fields and extension-detail relationships."
            title="Show gNMI extension fields and extension-detail relationships."
          >
            <GitBranch size={16} aria-hidden="true" />
            Extensions
          </button>

          <button
            className={`tool-button ${showDeprecated ? 'is-active' : ''}`}
            type="button"
            onClick={() => setShowDeprecated((value) => !value)}
            aria-pressed={showDeprecated}
            data-tooltip="Show deprecated proto fields and deprecated message types."
            title="Show deprecated proto fields and deprecated message types."
          >
            <EyeOff size={16} aria-hidden="true" />
            Deprecated
          </button>

          <a className="tool-button" href={pdfMapUrl} target="_blank" rel="noreferrer">
            <FileDown size={16} aria-hidden="true" />
            PDF
          </a>
        </div>
      </header>

      <main className="map-stage">
        <ReactFlow<MapNode, RoutedMapEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={(_, node) => {
            setRoutingPositions((currentPositions) => ({
              ...currentPositions,
              [node.id]: node.position,
            }));
          }}
          nodesDraggable
          minZoom={0.18}
          maxZoom={1.7}
          defaultViewport={{ x: 70, y: 40, zoom: 0.42 }}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          onNodeClick={(_, node) => {
            setSelectedId(node.id);
            setSelectedEdgeId(null);
          }}
          onEdgeClick={(event, edge) => {
            event.stopPropagation();
            setSelectedId(null);
            setSelectedEdgeId(edge.id);
          }}
          onPaneClick={() => {
            setSelectedId(null);
            setSelectedEdgeId(null);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--background-pattern)" gap={34} size={1.1} />
          <Controls position="bottom-left" />
        </ReactFlow>

        <Inspector
          node={selectedNode}
          totalNodes={visibleMap.nodes.length}
          totalEdges={visibleMap.edges.length}
        />
      </main>
    </div>
  );
}

function SchemaNode({ data, selected }: NodeProps<MapNode>) {
  const fields = data.fields ?? [];
  const dimmed = data.active === false;
  const targetHandles = targetHandlesFromData(data);
  const fieldConnectionIds = fieldConnectionIdsFromData(data);
  const onFieldConnectionClick = fieldClickHandlerFromData(data);
  const activeEdgeSourceHandle =
    typeof data.activeEdgeSourceHandle === 'string' ? data.activeEdgeSourceHandle : null;
  const className = [
    'schema-node',
    `kind-${data.kind}`,
    selected ? 'is-selected' : '',
    data.edgeEndpoint ? 'is-edge-endpoint' : '',
    dimmed ? 'is-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={className}>
      {targetHandles.length ? (
        targetHandles.map((handle) => (
          <Handle
            key={handle.id}
            type="target"
            id={handle.id}
            position={Position.Left}
            className="node-target"
            style={{ top: `${handle.y}px` }}
          />
        ))
      ) : (
        <Handle type="target" position={Position.Left} className="node-target" />
      )}

      <header className="node-header">
        <span className="node-kind">{data.kind}</span>
        <strong title={data.label}>{data.label}</strong>
        <div className="node-links nodrag nopan">
          {data.protoUrl ? (
            <a href={data.protoUrl} title="Proto definition" target="_blank" rel="noreferrer">
              <FileCode2 size={14} aria-hidden="true" />
            </a>
          ) : null}
          {data.specUrl ? (
            <a href={data.specUrl} title="gNMI documentation" target="_blank" rel="noreferrer">
              <BookOpen size={14} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </header>

      {data.badges?.length ? (
        <div className="node-badges">
          {data.badges.map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>
      ) : null}

      <div className="node-body">
        {fields.length ? (
          fields.map((field) => (
            <FieldRow
              key={field.id}
              field={field}
              highlighted={fieldMatches(field, data.query ?? '')}
              edgeHighlighted={field.id === activeEdgeSourceHandle}
              connectionEdgeId={fieldConnectionIds[field.id]}
              onConnectionClick={onFieldConnectionClick}
              showExtensions={data.showExtensions}
            />
          ))
        ) : (
          <div className="empty-field">empty message</div>
        )}
      </div>
    </section>
  );
}

type FieldRowProps = {
  field: MapField;
  highlighted: boolean;
  edgeHighlighted: boolean;
  connectionEdgeId?: string;
  onConnectionClick?: FieldClickHandler;
  showExtensions?: boolean;
};

function FieldRow({
  field,
  highlighted,
  edgeHighlighted,
  connectionEdgeId,
  onConnectionClick,
  showExtensions,
}: FieldRowProps) {
  const isExtension = field.ref === 'extension';
  const visibleExtensionHandle = !isExtension || showExtensions;
  const clickable = Boolean(connectionEdgeId && onConnectionClick);
  const selectConnection = () => {
    if (connectionEdgeId && onConnectionClick) {
      onConnectionClick(connectionEdgeId);
    }
  };

  return (
    <div
      className={[
        'field-row',
        field.ref ? 'has-ref' : '',
        highlighted ? 'is-highlighted' : '',
        edgeHighlighted ? 'is-edge-highlighted' : '',
        clickable ? 'is-clickable nodrag nopan' : '',
        field.badge === 'deprecated' ? 'is-deprecated' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? `${field.name} -> ${field.ref}` : undefined}
      aria-label={clickable ? `Highlight ${field.name} connection to ${field.ref}` : undefined}
      onClick={(event) => {
        if (!clickable) {
          return;
        }
        event.stopPropagation();
        selectConnection();
      }}
      onKeyDown={(event) => {
        if (!clickable || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        selectConnection();
      }}
    >
      <span className="field-type">{field.type}</span>
      <span className="field-name">{field.name}</span>
      {field.group ? <span className="field-group">{field.group}</span> : null}
      {field.badge ? <span className={`field-badge badge-${field.badge}`}>{field.badge}</span> : null}
      {field.ref && visibleExtensionHandle ? (
        <Handle
          type="source"
          id={field.id}
          position={Position.Right}
          className="field-handle"
          title={`${field.name} -> ${field.ref}`}
        />
      ) : null}
    </div>
  );
}

function RoutedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerEnd,
  style,
  interactionWidth,
}: EdgeProps<RoutedMapEdge>) {
  const routePoints =
    data?.routePoints?.length && data.routePoints.length > 1
      ? data.routePoints
      : [
        { x: sourceX, y: sourceY },
        { x: targetX, y: targetY },
      ];
  const routeBridges = data?.routeBridges ?? [];
  const stroke = typeof style?.stroke === 'string' ? style.stroke : 'var(--edge-field)';
  const strokeWidth = typeof style?.strokeWidth === 'number' ? style.strokeWidth : 1.6;
  const path = roundedRoutePath(routePoints);

  return (
    <>
      <path
        className="flow-edge-halo"
        d={path}
        style={{ strokeWidth: strokeWidth + 5 }}
      />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth ?? 28}
      />
      {routeBridges.map((bridge, index) => {
        const path = bridgePath(bridge);

        return (
          <g key={`${bridge.orientation}-${bridge.x}-${bridge.y}-${index}`}>
            <path className="flow-edge-bridge-gap" d={path} />
            <path
              className="flow-edge-bridge"
              d={path}
              style={{
                stroke,
                strokeWidth: Math.max(strokeWidth, 1.8),
              }}
            />
          </g>
        );
      })}
    </>
  );
}

function roundedRoutePath(points: RoutePoint[], radius = 18): string {
  if (!points.length) {
    return '';
  }

  const [start] = points;
  const commands = [`M ${start.x} ${start.y}`];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    if (!next) {
      commands.push(`L ${current.x} ${current.y}`);
      continue;
    }

    const incomingDistance = pointDistance(previous, current);
    const outgoingDistance = pointDistance(current, next);
    if (incomingDistance === 0 || outgoingDistance === 0) {
      commands.push(`L ${current.x} ${current.y}`);
      continue;
    }

    const cornerRadius = Math.min(radius, incomingDistance / 2, outgoingDistance / 2);
    const incomingUnit = {
      x: (current.x - previous.x) / incomingDistance,
      y: (current.y - previous.y) / incomingDistance,
    };
    const outgoingUnit = {
      x: (next.x - current.x) / outgoingDistance,
      y: (next.y - current.y) / outgoingDistance,
    };
    const beforeCorner = {
      x: current.x - incomingUnit.x * cornerRadius,
      y: current.y - incomingUnit.y * cornerRadius,
    };
    const afterCorner = {
      x: current.x + outgoingUnit.x * cornerRadius,
      y: current.y + outgoingUnit.y * cornerRadius,
    };

    commands.push(
      `L ${roundPathNumber(beforeCorner.x)} ${roundPathNumber(beforeCorner.y)}`,
      `Q ${current.x} ${current.y} ${roundPathNumber(afterCorner.x)} ${roundPathNumber(afterCorner.y)}`,
    );
  }

  return commands.join(' ');
}

function bridgePath(bridge: RouteBridge): string {
  const radius = 9;
  const height = 4;

  if (bridge.orientation === 'horizontal') {
    return [
      `M ${bridge.x - radius} ${bridge.y}`,
      `Q ${bridge.x} ${bridge.y - height} ${bridge.x + radius} ${bridge.y}`,
    ].join(' ');
  }

  return [
    `M ${bridge.x} ${bridge.y - radius}`,
    `Q ${bridge.x + height} ${bridge.y} ${bridge.x} ${bridge.y + radius}`,
  ].join(' ');
}

function routeBridges(
  routedEdges: Array<{ edge: MapEdge; routePoints: RoutePoint[] }>,
): Map<string, RouteBridge[]> {
  const bridgesByEdge = new Map<string, RouteBridge[]>();
  const segments = routedEdges.flatMap(({ edge, routePoints }) =>
    routeSegments(edge.id, routePoints),
  );

  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    const first = segments[firstIndex];

    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const second = segments[secondIndex];
      if (first.edgeId === second.edgeId) {
        continue;
      }

      if (first.orientation !== second.orientation) {
        addCrossingBridge(bridgesByEdge, first, second);
      }
    }
  }

  for (const [edgeId, bridges] of bridgesByEdge) {
    bridgesByEdge.set(edgeId, dedupeBridges(bridges));
  }

  return bridgesByEdge;
}

function routeSegments(edgeId: string, points: RoutePoint[]): RouteSegment[] {
  const segments: RouteSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (start.x === end.x && start.y === end.y) {
      continue;
    }

    if (start.y === end.y) {
      segments.push({
        edgeId,
        index,
        start,
        end,
        orientation: 'horizontal',
        fixed: start.y,
        from: Math.min(start.x, end.x),
        to: Math.max(start.x, end.x),
      });
      continue;
    }

    if (start.x === end.x) {
      segments.push({
        edgeId,
        index,
        start,
        end,
        orientation: 'vertical',
        fixed: start.x,
        from: Math.min(start.y, end.y),
        to: Math.max(start.y, end.y),
      });
    }
  }

  return segments;
}

function addCrossingBridge(
  bridgesByEdge: Map<string, RouteBridge[]>,
  first: RouteSegment,
  second: RouteSegment,
): void {
  const horizontal = first.orientation === 'horizontal' ? first : second;
  const vertical = first.orientation === 'vertical' ? first : second;
  const x = vertical.fixed;
  const y = horizontal.fixed;
  const crossingMargin = 34;

  if (
    x <= horizontal.from + crossingMargin ||
    x >= horizontal.to - crossingMargin ||
    y <= vertical.from + crossingMargin ||
    y >= vertical.to - crossingMargin
  ) {
    return;
  }

  if (segmentsShareEndpoint(first, second)) {
    return;
  }

  const bridgeSegment = first.edgeId > second.edgeId ? first : second;
  appendBridge(bridgesByEdge, bridgeSegment.edgeId, {
    x,
    y,
    orientation: bridgeSegment.orientation,
  });
}

function appendBridge(
  bridgesByEdge: Map<string, RouteBridge[]>,
  edgeId: string,
  bridge: RouteBridge,
): void {
  bridgesByEdge.set(edgeId, [...(bridgesByEdge.get(edgeId) ?? []), bridge]);
}

function dedupeBridges(bridges: RouteBridge[]): RouteBridge[] {
  const seen = new Set<string>();

  return bridges
    .sort((first, second) => first.x - second.x || first.y - second.y)
    .filter((bridge) => {
      const key = `${bridge.orientation}:${Math.round(bridge.x / 8)}:${Math.round(bridge.y / 8)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function segmentsShareEndpoint(first: RouteSegment, second: RouteSegment): boolean {
  return (
    pointsEqual(first.start, second.start) ||
    pointsEqual(first.start, second.end) ||
    pointsEqual(first.end, second.start) ||
    pointsEqual(first.end, second.end)
  );
}

function pointsEqual(first: RoutePoint, second: RoutePoint): boolean {
  return Math.abs(first.x - second.x) < 0.5 && Math.abs(first.y - second.y) < 0.5;
}

function pointDistance(first: RoutePoint, second: RoutePoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function roundPathNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function targetHandlesFromData(data: MapNode['data']): TargetHandleLayout[] {
  return Array.isArray(data.targetHandles)
    ? (data.targetHandles as TargetHandleLayout[])
    : [];
}

function fieldConnectionIdsFromData(data: MapNode['data']): FieldConnectionIds {
  return data.fieldConnectionIds &&
    typeof data.fieldConnectionIds === 'object' &&
    !Array.isArray(data.fieldConnectionIds)
    ? (data.fieldConnectionIds as FieldConnectionIds)
    : {};
}

function fieldClickHandlerFromData(data: MapNode['data']): FieldClickHandler | undefined {
  return typeof data.onFieldConnectionClick === 'function'
    ? (data.onFieldConnectionClick as FieldClickHandler)
    : undefined;
}

type InspectorProps = {
  node?: MapNode;
  totalNodes: number;
  totalEdges: number;
};

function Inspector({ node, totalNodes, totalEdges }: InspectorProps) {
  if (!node) {
    return (
      <aside className="inspector">
        <span className="inspector-kicker">Map</span>
        <h2>{totalNodes} nodes</h2>
        <p>{totalEdges} relationships across gNMI RPCs, messages, enums, and external types.</p>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <span className="inspector-kicker">{node.data.kind}</span>
      <h2>{node.data.label}</h2>

      <div className="inspector-actions">
        {node.data.protoUrl ? (
          <a href={node.data.protoUrl} target="_blank" rel="noreferrer">
            <FileCode2 size={15} aria-hidden="true" />
            Proto
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        ) : null}
        {node.data.specUrl ? (
          <a href={node.data.specUrl} target="_blank" rel="noreferrer">
            <BookOpen size={15} aria-hidden="true" />
            Docs
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        ) : null}
      </div>

      {node.data.fields?.length ? (
        <div className="inspector-fields">
          {node.data.fields.map((field) => (
            <div key={field.id} className="inspector-field">
              <span>{field.type}</span>
              <strong>{field.name}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p>No fields.</p>
      )}
    </aside>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppShell />
    </ReactFlowProvider>
  );
}
