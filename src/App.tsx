import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronDown,
  ChevronRight,
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
  type MapEdge,
  type MapEdgeKind,
  type MapField,
  type MapNode,
} from './protoMapTypes';
import {
  applyManualPositions,
  computeReadableNodeLayout,
  improveNodeLayout,
  routeReadableLayout,
  type RoutePoint,
  type TargetHandleLayout,
} from './mapLayout';
import {
  getInitialServiceRoute,
  serviceChoiceForRoute,
  serviceMapOrder,
  serviceMaps,
  type ServiceId,
  type ServiceMapChoice,
  type ServiceMapDefinition,
} from './serviceMaps';

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

const themeStorageKey = 'gnmi-map-theme';

type ThemeMode = 'light' | 'dark';

type NodePosition = {
  x: number;
  y: number;
};

const cachedElkLayoutPositions = new Map<string, Record<string, NodePosition>>();
const cachedElkLayoutPromises = new Map<string, Promise<Record<string, NodePosition>>>();

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

function nodePositions(nodes: MapNode[]): Record<string, NodePosition> {
  return Object.fromEntries(nodes.map((node) => [node.id, node.position]));
}

function computeElkLayoutPositions(
  cacheKey: string,
  visibleMap: { nodes: MapNode[]; edges: MapEdge[] },
  compact: boolean,
  force = false,
): Promise<Record<string, NodePosition>> {
  if (force) {
    cachedElkLayoutPositions.delete(cacheKey);
    cachedElkLayoutPromises.delete(cacheKey);
  }

  const cachedPositions = cachedElkLayoutPositions.get(cacheKey);
  if (cachedPositions) {
    return Promise.resolve(cachedPositions);
  }

  const cachedPromise = cachedElkLayoutPromises.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const layoutPromise = computeReadableNodeLayout(visibleMap.nodes, visibleMap.edges, {
    compact,
  }).then(
    (layoutNodes) => {
      const positions = nodePositions(layoutNodes);
      cachedElkLayoutPositions.set(cacheKey, positions);
      cachedElkLayoutPromises.delete(cacheKey);
      return positions;
    },
    (error: unknown) => {
      cachedElkLayoutPromises.delete(cacheKey);
      throw error;
    },
  );
  cachedElkLayoutPromises.set(cacheKey, layoutPromise);

  return layoutPromise;
}

function serviceSubtitle(serviceMap: ServiceMapDefinition): string {
  if (serviceMap.serviceVersion) {
    return `${serviceMap.label} service ${serviceMap.serviceVersion}`;
  }
  return serviceMap.sourceTag
    ? `${serviceMap.label} ${serviceMap.sourceTag}`
    : `${serviceMap.label} service family`;
}

type ServiceChoiceGroup = {
  key: string;
  label: string;
  displayLabel: string;
  choices: ServiceMapChoice[];
};

function displayServiceChoiceLabel(label: string): string {
  if (/^g[A-Z0-9]+$/.test(label) || /^[A-Z0-9]+$/.test(label)) {
    return label;
  }

  return label
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function versionParts(version: string | undefined): number[] | null {
  if (!version) {
    return null;
  }

  const match = version.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compareVersionsDescending(
  first: string | undefined,
  second: string | undefined,
): number {
  if (!first && !second) {
    return 0;
  }
  if (!first) {
    return 1;
  }
  if (!second) {
    return -1;
  }

  const firstParts = versionParts(first);
  const secondParts = versionParts(second);
  if (!firstParts || !secondParts) {
    return second.localeCompare(first, undefined, { numeric: true, sensitivity: 'base' });
  }

  return (
    secondParts[0] - firstParts[0] ||
    secondParts[1] - firstParts[1] ||
    secondParts[2] - firstParts[2]
  );
}

function groupedServiceChoices(serviceChoices: ServiceMapChoice[]): ServiceChoiceGroup[] {
  const groups = new Map<string, ServiceChoiceGroup>();

  for (const choice of serviceChoices) {
    const key = choice.version ? choice.label : `${choice.label}:${choice.symbol}:${choice.id}`;
    const group = groups.get(key);

    if (group) {
      group.choices.push(choice);
      continue;
    }

    groups.set(key, {
      key,
      label: choice.label,
      displayLabel: displayServiceChoiceLabel(choice.label),
      choices: [choice],
    });
  }

  return [...groups.values()].map((group) => ({
    ...group,
    choices: [...group.choices].sort((first, second) =>
      compareVersionsDescending(first.version, second.version),
    ),
  }));
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
  const initialServiceRoute = useMemo(() => getInitialServiceRoute(), []);
  const [activeServiceId, setActiveServiceId] = useState<ServiceId>(
    () => initialServiceRoute.serviceId,
  );
  const [serviceChoiceIds, setServiceChoiceIds] = useState<Record<ServiceId, string>>(() => ({
    gnmi: serviceMaps.gnmi.defaultServiceChoiceId,
    gnoi: serviceMaps.gnoi.defaultServiceChoiceId,
    gnsi: serviceMaps.gnsi.defaultServiceChoiceId,
    gribi: serviceMaps.gribi.defaultServiceChoiceId,
    [initialServiceRoute.serviceId]: initialServiceRoute.serviceChoiceId,
  }));
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [layoutResetCount, setLayoutResetCount] = useState(0);
  const [layoutPending, setLayoutPending] = useState(false);
  const [elkLayoutPositions, setElkLayoutPositions] =
    useState<Record<string, NodePosition> | null>(null);
  const [queryValue, setQueryValue] = useState('');
  const [showExtensions, setShowExtensions] = useState(false);
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [manualPositions, setManualPositions] = useState<Record<string, NodePosition>>({});
  const [routingPositions, setRoutingPositions] = useState<Record<string, NodePosition>>({});
  const appliedLayoutResetCount = useRef(0);

  const activeService = serviceMaps[activeServiceId];
  const activeServiceChoice =
    serviceChoiceForRoute(activeService, serviceChoiceIds[activeServiceId]) ??
    activeService.serviceChoices[0];
  const activeServiceChoiceId = activeServiceChoice.id;
  const activeFocusNodeId = activeServiceChoice.focusNodeId ?? activeServiceChoice.id;
  const activeSourceTag = activeServiceChoice.sourceTag ?? null;
  const defaultServiceChoice = serviceChoiceForRoute(
    activeService,
    activeService.defaultServiceChoiceId,
  );
  const defaultFocusNodeId = defaultServiceChoice.focusNodeId ?? defaultServiceChoice.id;
  const rpcFocusedChoice = activeFocusNodeId.startsWith('rpc-');
  const compactLayout =
    rpcFocusedChoice ||
    activeServiceChoiceId !== activeService.defaultServiceChoiceId ||
    activeFocusNodeId !== defaultFocusNodeId;
  const layoutCacheKey = `${activeServiceId}:${activeServiceChoiceId}:${compactLayout ? 'compact' : 'regular'}`;
  const query = queryValue.trim().toLowerCase();
  const darkMode = theme === 'dark';
  const visibleMap = useMemo(
    () =>
      activeService.getVisibleMap({
        showDeprecated,
        showExtensions,
        focusNodeId: activeFocusNodeId,
        sourceTag: activeSourceTag,
      }),
    [activeFocusNodeId, activeService, activeSourceTag, showDeprecated, showExtensions],
  );
  const layoutSourceMap = useMemo(
    () =>
      activeService.getVisibleMap({
        showDeprecated: true,
        showExtensions: true,
        focusNodeId: activeFocusNodeId,
        sourceTag: activeSourceTag,
      }),
    [activeFocusNodeId, activeService, activeSourceTag],
  );
  const fallbackLayoutNodes = useMemo(() => improveNodeLayout(visibleMap.nodes), [visibleMap.nodes]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedEdgeId(null);
    setManualPositions({});
    setRoutingPositions({});
    setQueryValue('');
    setElkLayoutPositions(cachedElkLayoutPositions.get(layoutCacheKey) ?? null);
  }, [layoutCacheKey]);

  useEffect(() => {
    const nextHash =
      activeService.serviceChoices.length > 1
        ? `#${activeServiceId}/${encodeURIComponent(activeServiceChoiceId)}`
        : `#${activeServiceId}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${nextHash}`,
      );
    }
  }, [activeService, activeServiceChoiceId, activeServiceId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    setLayoutPending(true);
    const forceLayout = layoutResetCount > appliedLayoutResetCount.current;
    if (forceLayout) {
      appliedLayoutResetCount.current = layoutResetCount;
    }

    computeElkLayoutPositions(layoutCacheKey, layoutSourceMap, compactLayout, forceLayout)
      .then((layoutPositions) => {
        if (!cancelled) {
          setElkLayoutPositions(layoutPositions);
        }
      })
      .catch((error) => {
        console.error('Failed to compute readable map layout', error);
      })
      .finally(() => {
        if (!cancelled) {
          setLayoutPending(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [compactLayout, layoutCacheKey, layoutResetCount, layoutSourceMap]);

  const layoutNodes = useMemo(
    () =>
      elkLayoutPositions ? applyManualPositions(visibleMap.nodes, elkLayoutPositions) : fallbackLayoutNodes,
    [elkLayoutPositions, fallbackLayoutNodes, visibleMap.nodes],
  );

  useEffect(() => {
    if (!elkLayoutPositions) {
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
  }, [elkLayoutPositions, fitView]);

  const routedLayoutNodes = useMemo(
    () => applyManualPositions(layoutNodes, routingPositions),
    [layoutNodes, routingPositions],
  );
  const readableLayout = useMemo(
    () =>
      routeReadableLayout(routedLayoutNodes, visibleMap.edges, {
        compact: compactLayout,
      }),
    [compactLayout, routedLayoutNodes, visibleMap.edges],
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
  const selectedNodeConnections = useMemo(() => {
    const edgeIds = new Set<string>();
    const nodeIds = new Set<string>();

    if (!selectedId) {
      return { edgeIds, nodeIds };
    }

    for (const edge of visibleMap.edges) {
      if (edge.source !== selectedId && edge.target !== selectedId) {
        continue;
      }

      edgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }

    return { edgeIds, nodeIds };
  }, [selectedId, visibleMap.edges]);
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
        const selectedNodeRelated = selectedNodeConnections.nodeIds.has(currentNode.id);
        const edgeEndpoint =
          selectedEdgeEndpointIds.has(currentNode.id) ||
          (selectedNodeRelated && currentNode.id !== selectedId);
        const selectionActive = Boolean(selectedId || selectedEdge);
        const active = selectionActive
          ? selectedNodeRelated || selectedEdgeEndpointIds.has(currentNode.id)
          : !query || nodeMatches.has(currentNode.id);
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
            active: active || edgeEndpoint || currentNode.id === selectedId,
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
      selectedNodeConnections,
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
        const connectedToSelectedNode = selectedNodeConnections.edgeIds.has(edge.id);
        const highlighted = selected || connectedToSelectedNode;
        const selectionDimmed =
          (Boolean(selectedEdge) && !selected) || (Boolean(selectedId) && !connectedToSelectedNode);
        const opacity = highlighted ? 1 : connectedToMatch ? (selectionDimmed ? 0.18 : 1) : 0.14;
        const stroke = highlighted ? 'var(--edge-selected)' : style.stroke;
        const strokeWidth =
          typeof style.strokeWidth === 'number'
            ? style.strokeWidth + (highlighted ? 1.8 : 0)
            : style.strokeWidth;

        return {
          ...edge,
          type: 'routed',
          targetHandle,
          selected,
          zIndex: highlighted ? 12 : 1,
          interactionWidth: 28,
          className: [
            'flow-edge',
            `flow-edge-${edge.kind}`,
            highlighted ? 'is-selected' : '',
            selectionDimmed ? 'is-dimmed' : '',
          ]
            .filter(Boolean)
            .join(' '),
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
          data: { routePoints, routeBridges: routeBridgesByEdge.get(edge.id) ?? [] },
          style: {
            ...style,
            opacity,
            stroke,
            strokeWidth,
          },
        } satisfies RoutedMapEdge;
      }),
    [
      nodeMatches,
      query,
      readableLayout.edges,
      routeBridgesByEdge,
      selectedEdge,
      selectedId,
      selectedNodeConnections,
    ],
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
    setLayoutResetCount((count) => count + 1);
  }, []);
  const selectServiceChoice = useCallback(
    (serviceChoiceId: string) => {
      setServiceChoiceIds((currentChoices) => ({
        ...currentChoices,
        [activeServiceId]: serviceChoiceId,
      }));
    },
    [activeServiceId],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-kicker">{serviceSubtitle(activeService)}</span>
          <h1>{activeService.title}</h1>
        </div>

        <ServiceNav activeServiceId={activeServiceId} onSelect={setActiveServiceId} />

        <ServiceChoiceMenu
          serviceMap={activeService}
          value={activeServiceChoiceId}
          onSelect={selectServiceChoice}
        />

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

          <button className="tool-button" type="button" onClick={fit} title="Fit map">
            <Focus size={16} aria-hidden="true" />
            <span className="tool-label">Fit</span>
          </button>

          <button
            className="tool-button"
            type="button"
            onClick={resetLayout}
            disabled={layoutPending}
            title="Reset layout"
          >
            <RotateCcw size={16} aria-hidden="true" />
            <span className="tool-label">Reset</span>
          </button>

          <button
            className={`tool-button ${showExtensions ? 'is-active' : ''}`}
            type="button"
            onClick={() => setShowExtensions((value) => !value)}
            aria-pressed={showExtensions}
            data-tooltip="Show extension fields and extension-detail relationships."
            title="Show extension fields and extension-detail relationships."
          >
            <GitBranch size={16} aria-hidden="true" />
            <span className="tool-label">Extensions</span>
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
            <span className="tool-label">Deprecated</span>
          </button>

          {activeService.pdfUrl ? (
            <a
              className="tool-button"
              href={activeService.pdfUrl}
              target="_blank"
              rel="noreferrer"
              title="Download PDF"
            >
              <FileDown size={16} aria-hidden="true" />
              <span className="tool-label">PDF</span>
            </a>
          ) : null}
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
          serviceLabel={activeService.label}
          serviceChoice={activeServiceChoice}
          totalNodes={visibleMap.nodes.length}
          totalEdges={visibleMap.edges.length}
        />
      </main>
    </div>
  );
}

type ServiceNavProps = {
  activeServiceId: ServiceId;
  onSelect: (serviceId: ServiceId) => void;
};

function ServiceNav({ activeServiceId, onSelect }: ServiceNavProps) {
  return (
    <nav className="service-nav" aria-label="Service maps">
      {serviceMapOrder.map((serviceId) => {
        const serviceMap = serviceMaps[serviceId];
        const active = serviceId === activeServiceId;

        return (
          <button
            key={serviceId}
            className={`service-tab ${active ? 'is-active' : ''}`}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(serviceId)}
          >
            <span>{serviceMap.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

type ServiceChoiceMenuProps = {
  serviceMap: ServiceMapDefinition;
  value: string;
  onSelect: (serviceChoiceId: string) => void;
};

function ServiceChoiceMenu({ serviceMap, value, onSelect }: ServiceChoiceMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(
    () => groupedServiceChoices(serviceMap.serviceChoices),
    [serviceMap.serviceChoices],
  );
  const selectedChoice = serviceChoiceForRoute(serviceMap, value);
  const selectedGroup =
    groups.find((group) => group.choices.some((choice) => choice.id === selectedChoice.id)) ??
    groups[0];
  const [open, setOpen] = useState(false);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(
    selectedGroup?.key ?? null,
  );
  const activeGroup =
    groups.find((group) => group.key === activeGroupKey) ?? selectedGroup ?? groups[0];

  useEffect(() => {
    setOpen(false);
    setActiveGroupKey(selectedGroup?.key ?? null);
  }, [selectedGroup?.key, serviceMap.id]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  if (serviceMap.serviceChoices.length <= 1) {
    return null;
  }

  const selectedDisplayLabel = displayServiceChoiceLabel(selectedChoice.label);
  const activeGroupHasVersion = activeGroup?.choices.some((choice) => choice.version);
  const activeGroupSelectedChoice = activeGroup?.choices.find(
    (choice) => choice.id === selectedChoice.id,
  );
  const activeGroupPreselectedChoice =
    activeGroupSelectedChoice ?? (activeGroupHasVersion ? activeGroup?.choices[0] : undefined);

  const selectChoice = (serviceChoiceId: string) => {
    onSelect(serviceChoiceId);
    setOpen(false);
  };

  return (
    <div className="service-choice" ref={menuRef}>
      <button
        className="service-choice-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${serviceMap.label} service`}
        onClick={() => {
          setOpen((currentOpen) => !currentOpen);
          setActiveGroupKey(selectedGroup?.key ?? groups[0]?.key ?? null);
        }}
      >
        <span className="service-choice-current">
          <span className="service-choice-name">{selectedDisplayLabel}</span>
          {selectedChoice.version ? (
            <span className="service-choice-version">{selectedChoice.version}</span>
          ) : null}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {open ? (
        <div className="service-choice-popover" role="menu" aria-label={`${serviceMap.label} maps`}>
          <div className="service-choice-list">
            {groups.map((group) => {
              const groupSelected = group.choices.some(
                (choice) => choice.id === selectedChoice.id,
              );
              const groupHasVersion = group.choices.some((choice) => choice.version);
              const itemClassName = [
                'service-choice-item',
                group.key === activeGroup?.key ? 'is-active' : '',
                groupSelected ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <button
                  key={group.key}
                  className={itemClassName}
                  type="button"
                  role="menuitem"
                  aria-haspopup={groupHasVersion ? 'menu' : undefined}
                  aria-expanded={groupHasVersion ? group.key === activeGroup?.key : undefined}
                  aria-current={groupSelected ? 'true' : undefined}
                  onClick={() => {
                    if (groupHasVersion) {
                      selectChoice(group.choices[0].id);
                    } else {
                      selectChoice(group.choices[0].id);
                    }
                  }}
                  onFocus={() => setActiveGroupKey(group.key)}
                  onMouseEnter={() => setActiveGroupKey(group.key)}
                >
                  <span className="service-choice-name">{group.displayLabel}</span>
                  {groupHasVersion ? <ChevronRight size={14} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          {activeGroup && activeGroupHasVersion ? (
            <div
              className="service-choice-submenu"
              role="menu"
              aria-label={`${activeGroup.displayLabel} versions`}
            >
              {activeGroup.choices.map((choice) => {
                const selected = choice.id === selectedChoice.id;
                const preselected = choice.id === activeGroupPreselectedChoice?.id;
                const versionItemClassName = [
                  'service-choice-version-item',
                  selected ? 'is-selected' : '',
                  !selected && preselected ? 'is-preselected' : '',
                ]
                  .filter(Boolean)
                  .join(' ');

                return (
                  <button
                    key={choice.id}
                    className={versionItemClassName}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => selectChoice(choice.id)}
                  >
                    <span>{choice.version ?? 'Current'}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
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
            <a href={data.specUrl} title="Service documentation" target="_blank" rel="noreferrer">
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
  const fieldTitle = [field.type, field.name, field.group, field.badge]
    .filter(Boolean)
    .join(' ');
  const selectConnection = () => {
    if (connectionEdgeId && onConnectionClick) {
      onConnectionClick(connectionEdgeId);
    }
  };

  return (
    <div
      className={[
        'field-row',
        field.group || field.badge ? 'is-detail' : '',
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
      title={field.ref ? `${fieldTitle} -> ${field.ref}` : fieldTitle}
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
      ? alignRouteEndpoints(data.routePoints, { x: sourceX, y: sourceY }, { x: targetX, y: targetY })
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

function alignRouteEndpoints(
  routePoints: RoutePoint[],
  source: RoutePoint,
  target: RoutePoint,
): RoutePoint[] {
  const alignedPoints = routePoints.map((point) => ({ ...point }));
  const lastIndex = alignedPoints.length - 1;

  alignedPoints[0] = { ...alignedPoints[0], y: source.y };
  alignedPoints[lastIndex] = { ...alignedPoints[lastIndex], y: target.y };

  if (alignedPoints.length > 2) {
    alignedPoints[1] = { ...alignedPoints[1], y: source.y };
    alignedPoints[lastIndex - 1] = { ...alignedPoints[lastIndex - 1], y: target.y };
  }

  return alignedPoints;
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
  serviceLabel: string;
  serviceChoice: ServiceMapChoice;
  totalNodes: number;
  totalEdges: number;
};

function Inspector({ node, serviceLabel, serviceChoice, totalNodes, totalEdges }: InspectorProps) {
  if (!node) {
    return (
      <aside className="inspector">
        <span className="inspector-kicker">{serviceLabel}</span>
        <h2>{totalNodes} nodes</h2>
        <p>
          {totalEdges} relationships across {serviceChoice.label} RPCs, messages, enums, and
          external types.
        </p>
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
