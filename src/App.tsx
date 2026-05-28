import {
  type CSSProperties,
  type KeyboardEventHandler,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  Box,
  Button,
  Chip,
  CssBaseline,
  Divider,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import DataObjectOutlinedIcon from '@mui/icons-material/DataObjectOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FilterListIcon from '@mui/icons-material/FilterList';
import FitScreenOutlinedIcon from '@mui/icons-material/FitScreenOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SearchIcon from '@mui/icons-material/Search';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined';
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
  mapNodesBounds,
  routeReadableLayout,
  type LayoutBounds,
  type RoutePoint,
  type TargetHandleLayout,
} from './mapLayout';
import {
  getInitialServiceRoute,
  serviceChoiceForRoute,
  serviceMapOrder,
  serviceMaps,
  serviceRoutePath,
  type ServiceId,
  type ServiceMapChoice,
  type ServiceMapDefinition,
} from './serviceMaps';
import { downloadMapPdf, downloadMapSvg, type MapExportInput } from './mapExport';
import { createAppTheme, type ThemeMode } from './theme';
import { HotkeysDialog } from './hotkeysDialog.tsx';

const edgeStyleByKind: Record<MapEdgeKind, CSSProperties> = {
  rpc: { stroke: 'var(--edge-field)', strokeWidth: 2.2 },
  field: { stroke: 'var(--edge-field)', strokeWidth: 1.6 },
  extension: {
    stroke: 'var(--edge-field)',
    strokeWidth: 1.4,
    strokeDasharray: '7 6',
  },
  'extension-detail': { stroke: 'var(--edge-field)', strokeWidth: 1.5 },
};

const nodeTypes: NodeTypes = {
  schema: SchemaNode,
};

const edgeTypes: EdgeTypes = {
  routed: RoutedEdge,
};

const themeStorageKey = 'gnmi-map-theme';
const routeBasePath = import.meta.env.BASE_URL;

type NodePosition = {
  x: number;
  y: number;
};

const cachedElkLayoutPositions = new Map<string, Record<string, NodePosition>>();
const cachedElkLayoutPromises = new Map<string, Promise<Record<string, NodePosition>>>();

type RoutedEdgeData = Record<string, unknown> & {
  routePoints: RoutePoint[];
};

type RoutedMapEdge = Edge<RoutedEdgeData, 'routed'> & {
  sourceHandle: string;
  targetHandle: string;
  kind: MapEdgeKind;
  deprecated: boolean;
};

type FieldConnectionIds = Record<string, string>;
type FieldSelection = {
  nodeId: string;
  fieldId: string;
};
type FieldSelectHandler = (fieldId: string, edgeId?: string) => void;

type SelectedFieldDetails = {
  node: MapNode;
  field: MapField;
  refNode?: MapNode;
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

function routePointsBounds(routePoints: RoutePoint[]): LayoutBounds | null {
  if (!routePoints.length) {
    return null;
  }

  const minX = Math.min(...routePoints.map((point) => point.x));
  const minY = Math.min(...routePoints.map((point) => point.y));
  const maxX = Math.max(...routePoints.map((point) => point.x));
  const maxY = Math.max(...routePoints.map((point) => point.y));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function mergeBounds(first: LayoutBounds | null, second: LayoutBounds | null): LayoutBounds | null {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  const minX = Math.min(first.x, second.x);
  const minY = Math.min(first.y, second.y);
  const maxX = Math.max(first.x + first.width, second.x + second.width);
  const maxY = Math.max(first.y + first.height, second.y + second.height);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
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

function interfaceTitle(serviceId: ServiceId): string {
  return serviceId.toUpperCase();
}

function serviceSubtitle(serviceChoice: ServiceMapChoice): string {
  return `${displayServiceChoiceLabel(serviceChoice.label)} Service`;
}

type ServiceChoiceGroup = {
  key: string;
  label: string;
  displayLabel: string;
  choices: ServiceMapChoice[];
};

type RpcFilterChoice = {
  id: string;
  label: string;
};

const allRpcFilterId = '__all-rpcs__';

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

function rpcFilterChoicesForService(
  visibleMap: { nodes: MapNode[] },
  serviceNodeId: string,
): RpcFilterChoice[] {
  const serviceNode = visibleMap.nodes.find((node) => node.id === serviceNodeId);

  return (serviceNode?.data.fields ?? [])
    .filter((field) => field.type === 'rpc' && field.ref)
    .map((field) => ({
      id: field.ref as string,
      label: field.name,
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

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

type AppShellProps = {
  themeMode: ThemeMode;
  onToggleTheme: () => void;
};

function AppShell({ themeMode, onToggleTheme }: AppShellProps) {
  const { fitBounds, fitView } = useReactFlow<MapNode, RoutedMapEdge>();
  const initialServiceRoute = useMemo(() => getInitialServiceRoute(routeBasePath), []);
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
  const [layoutResetCount, setLayoutResetCount] = useState(0);
  const [layoutPending, setLayoutPending] = useState(false);
  const [pdfExportPending, setPdfExportPending] = useState(false);
  const [elkLayoutPositions, setElkLayoutPositions] =
    useState<Record<string, NodePosition> | null>(null);
  const [queryValue, setQueryValue] = useState('');
  const [showExtensions, setShowExtensions] = useState(false);
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [rpcFilterIds, setRpcFilterIds] = useState<Record<string, string>>(() =>
    initialServiceRoute.rpcFilterId
      ? {
        [`${initialServiceRoute.serviceId}:${initialServiceRoute.serviceChoiceId}`]:
          initialServiceRoute.rpcFilterId,
      }
      : {},
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState<FieldSelection | null>(null);
  const [manualPositions, setManualPositions] = useState<Record<string, NodePosition>>({});
  const [routingPositions, setRoutingPositions] = useState<Record<string, NodePosition>>({});
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const appliedLayoutResetCount = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastSelectionFitKeyRef = useRef<string | null>(null);
  const inspectorFitFramesRef = useRef<{ first: number | null; second: number | null }>({
    first: null,
    second: null,
  });

  const activeService = serviceMaps[activeServiceId];
  const activeServiceChoice =
    serviceChoiceForRoute(activeService, serviceChoiceIds[activeServiceId]) ??
    activeService.serviceChoices[0];
  const activeServiceChoiceId = activeServiceChoice.id;
  const activeServiceFocusNodeId = activeServiceChoice.focusNodeId ?? activeServiceChoice.id;
  const activeSourceTag = activeServiceChoice.sourceTag ?? null;
  const serviceScopedMap = useMemo(
    () =>
      activeService.getVisibleMap({
        showDeprecated: true,
        showExtensions: true,
        focusNodeId: activeServiceFocusNodeId,
        sourceTag: activeSourceTag,
      }),
    [activeService, activeServiceFocusNodeId, activeSourceTag],
  );
  const rpcFilterChoices = useMemo(
    () => rpcFilterChoicesForService(serviceScopedMap, activeServiceFocusNodeId),
    [activeServiceFocusNodeId, serviceScopedMap],
  );
  const rpcFilterKey = `${activeServiceId}:${activeServiceChoiceId}`;
  const selectedRpcFilterId = rpcFilterIds[rpcFilterKey] ?? allRpcFilterId;
  const activeRpcFilterChoice =
    selectedRpcFilterId === allRpcFilterId
      ? null
      : rpcFilterChoices.find((choice) => choice.id === selectedRpcFilterId) ?? null;
  const activeRpcFocusNodeId = activeRpcFilterChoice?.id ?? null;
  const defaultServiceChoice = serviceChoiceForRoute(
    activeService,
    activeService.defaultServiceChoiceId,
  );
  const defaultFocusNodeId = defaultServiceChoice.focusNodeId ?? defaultServiceChoice.id;
  const compactLayout =
    Boolean(activeRpcFocusNodeId) ||
    activeServiceChoiceId !== activeService.defaultServiceChoiceId ||
    activeServiceFocusNodeId !== defaultFocusNodeId;
  const layoutCacheKey = `${activeServiceId}:${activeServiceChoiceId}:${activeRpcFocusNodeId ?? 'all-rpcs'}:${compactLayout ? 'compact' : 'regular'}`;
  const query = queryValue.trim().toLowerCase();
  const darkMode = themeMode === 'dark';
  const visibleMap = useMemo(
    () =>
      activeService.getVisibleMap({
        showDeprecated,
        showExtensions,
        focusNodeId: activeServiceFocusNodeId,
        rpcFocusNodeId: activeRpcFocusNodeId,
        sourceTag: activeSourceTag,
      }),
    [
      activeRpcFocusNodeId,
      activeService,
      activeServiceFocusNodeId,
      activeSourceTag,
      showDeprecated,
      showExtensions,
    ],
  );
  const layoutSourceMap = useMemo(
    () =>
      activeService.getVisibleMap({
        showDeprecated: true,
        showExtensions: true,
        focusNodeId: activeServiceFocusNodeId,
        rpcFocusNodeId: activeRpcFocusNodeId,
        sourceTag: activeSourceTag,
      }),
    [activeRpcFocusNodeId, activeService, activeServiceFocusNodeId, activeSourceTag],
  );
  const fallbackLayoutNodes = useMemo(() => improveNodeLayout(visibleMap.nodes), [visibleMap.nodes]);

  useEffect(() => {
    setSelectedId(null);
    setSelectedEdgeId(null);
    setSelectedField(null);
    setManualPositions({});
    setRoutingPositions({});
    setQueryValue('');
    setElkLayoutPositions(cachedElkLayoutPositions.get(layoutCacheKey) ?? null);
  }, [layoutCacheKey]);

  useEffect(() => {
    const nextUrl = `${serviceRoutePath(
      {
        serviceId: activeServiceId,
        serviceChoiceId: activeServiceChoiceId,
        rpcFilterId: activeRpcFocusNodeId,
      },
      routeBasePath,
    )}${window.location.search}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentUrl !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activeRpcFocusNodeId, activeServiceChoiceId, activeServiceId]);

  useEffect(() => {
    const handleGlobalSearchKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && queryValue) {
        setQueryValue('');
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey || isTextEditingTarget(event.target)) {
        return;
      }

      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        void fitView({ padding: 0.12, duration: 450 });
        return;
      }

      if (event.key !== '/') {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener('keydown', handleGlobalSearchKeys);

    return () => {
      window.removeEventListener('keydown', handleGlobalSearchKeys);
    };
  }, [fitView, queryValue]);

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
  const selectField = useCallback((nodeId: string, fieldId: string, edgeId?: string) => {
    setSelectedId(null);
    setSelectedField({ nodeId, fieldId });
    setSelectedEdgeId(edgeId ?? null);
  }, []);

  const nodes = useMemo(
    () =>
      displayedLayoutNodes.map((currentNode) => {
        const selectedNodeRelated = selectedNodeConnections.nodeIds.has(currentNode.id);
        const edgeEndpoint =
          selectedEdgeEndpointIds.has(currentNode.id) ||
          (selectedNodeRelated && currentNode.id !== selectedId);
        const selectedFieldInNode = selectedField?.nodeId === currentNode.id;
        const selectionActive = Boolean(selectedId || selectedEdge || selectedField);
        const active = selectionActive
          ? selectedNodeRelated || selectedEdgeEndpointIds.has(currentNode.id) || selectedFieldInNode
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
            selectedFieldId: selectedFieldInNode ? selectedField.fieldId : null,
            onFieldSelect: (fieldId: string, edgeId?: string) =>
              selectField(currentNode.id, fieldId, edgeId),
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
      selectField,
      selectedEdge,
      selectedEdgeEndpointIds,
      selectedField,
      selectedId,
      selectedNodeConnections,
      showExtensions,
    ],
  );

  const matchedNodes = useMemo(
    () => (query ? nodes.filter((currentNode) => nodeMatches.has(currentNode.id)) : []),
    [nodeMatches, nodes, query],
  );

  useEffect(() => {
    if (!query || matchedNodes.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      void fitView({
        nodes: matchedNodes,
        padding: 0.24,
        duration: 350,
        maxZoom: 1.2,
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [fitView, matchedNodes, query]);

  const selectionFitKey = useMemo(() => {
    if (selectedId) {
      return `node:${selectedId}`;
    }

    if (selectedEdge) {
      return `edge:${selectedEdge.id}`;
    }

    if (selectedField) {
      return `field:${selectedField.nodeId}:${selectedField.fieldId}`;
    }

    return null;
  }, [selectedEdge, selectedField, selectedId]);

  const selectionFitNodeIds = useMemo(() => {
    const nodeIds = new Set<string>();

    if (selectedId) {
      nodeIds.add(selectedId);
      selectedNodeConnections.nodeIds.forEach((nodeId) => nodeIds.add(nodeId));
    }

    if (selectedEdge) {
      selectedEdgeEndpointIds.forEach((nodeId) => nodeIds.add(nodeId));
    }

    if (selectedField) {
      nodeIds.add(selectedField.nodeId);
      selectedEdgeEndpointIds.forEach((nodeId) => nodeIds.add(nodeId));
    }

    return nodeIds;
  }, [selectedEdge, selectedEdgeEndpointIds, selectedField, selectedId, selectedNodeConnections.nodeIds]);

  const selectionFitNodes = useMemo(
    () =>
      selectionFitNodeIds.size
        ? nodes.filter((currentNode) => selectionFitNodeIds.has(currentNode.id))
        : [],
    [nodes, selectionFitNodeIds],
  );

  const selectionFitEdges = useMemo(() => {
    if (selectedId) {
      return readableLayout.edges.filter(({ edge }) => selectedNodeConnections.edgeIds.has(edge.id));
    }

    if (selectedEdge) {
      return readableLayout.edges.filter(({ edge }) => edge.id === selectedEdge.id);
    }

    return [];
  }, [readableLayout.edges, selectedEdge, selectedId, selectedNodeConnections.edgeIds]);

  const selectionFitBounds = useMemo(() => {
    const nodeBounds = selectionFitNodes.length ? mapNodesBounds(selectionFitNodes) : null;
    const edgeBounds = routePointsBounds(selectionFitEdges.flatMap((edge) => edge.routePoints));

    return mergeBounds(nodeBounds, edgeBounds);
  }, [selectionFitEdges, selectionFitNodes]);

  useEffect(() => {
    if (!selectionFitKey) {
      lastSelectionFitKeyRef.current = null;
      return;
    }

    if (!selectionFitBounds || lastSelectionFitKeyRef.current === selectionFitKey) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      lastSelectionFitKeyRef.current = selectionFitKey;
      void fitBounds(selectionFitBounds, {
        padding: 0.24,
        duration: 350,
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [fitBounds, selectionFitBounds, selectionFitKey]);

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
          (Boolean(selectedEdge) && !selected) ||
          (Boolean(selectedId) && !connectedToSelectedNode) ||
          (selectedField !== null && !selectedEdge);
        const opacity = highlighted ? 1 : connectedToMatch ? (selectionDimmed ? 0.18 : 1) : 0.14;
        const stroke = highlighted ? 'var(--edge-selected)' : 'var(--edge-field)';
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
            highlighted ? 'is-selected' : '',
            selectionDimmed ? 'is-dimmed' : '',
          ]
            .filter(Boolean)
            .join(' '),
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
          data: { routePoints },
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
      selectedEdge,
      selectedField,
      selectedId,
      selectedNodeConnections,
    ],
  );

  const selectedNode = useMemo(
    () => nodes.find((currentNode) => currentNode.id === selectedId),
    [nodes, selectedId],
  );
  const activeServiceNode = useMemo(
    () =>
      visibleMap.nodes.find(
        (currentNode) =>
          currentNode.id === activeServiceFocusNodeId || currentNode.data.kind === 'service',
      ),
    [activeServiceFocusNodeId, visibleMap.nodes],
  );
  const selectedFieldDetails = useMemo<SelectedFieldDetails | null>(() => {
    if (!selectedField) {
      return null;
    }

    const node = nodes.find((currentNode) => currentNode.id === selectedField.nodeId);
    const field = node?.data.fields?.find((currentField) => currentField.id === selectedField.fieldId);
    const refNode =
      typeof field?.ref === 'string'
        ? nodes.find((currentNode) => currentNode.id === field.ref)
        : undefined;

    return node && field ? { node, field, refNode } : null;
  }, [nodes, selectedField]);
  const exportInput = useMemo<MapExportInput>(
    () => ({
      layout: readableLayout,
      serviceLabel: activeService.label,
      serviceTitle: activeService.title,
      serviceChoiceLabel: displayServiceChoiceLabel(activeServiceChoice.label),
      serviceChoiceVersion: activeServiceChoice.version ?? activeService.serviceVersion,
      rpcFilterLabel: activeRpcFilterChoice?.label ?? null,
      sourceRepository: activeService.sourceRepository,
      sourceTag: activeSourceTag ?? activeService.sourceTag ?? null,
      showDeprecated,
      showExtensions,
    }),
    [
      activeRpcFilterChoice,
      activeService,
      activeServiceChoice,
      activeSourceTag,
      readableLayout,
      showDeprecated,
      showExtensions,
    ],
  );

  const fit = useCallback(() => {
    fitView({ padding: 0.12, duration: 450 });
  }, [fitView]);

  const fitCurrentFocus = useCallback(() => {
    if (selectionFitKey && selectionFitBounds) {
      void fitBounds(selectionFitBounds, {
        padding: 0.24,
        duration: 350,
      });
      return;
    }

    if (query && matchedNodes.length > 0) {
      void fitView({
        nodes: matchedNodes,
        padding: 0.24,
        duration: 350,
        maxZoom: 1.2,
      });
      return;
    }

    void fitView({ padding: 0.12, duration: 450 });
  }, [fitBounds, fitView, matchedNodes, query, selectionFitBounds, selectionFitKey]);

  const cancelInspectorFit = useCallback(() => {
    const { first, second } = inspectorFitFramesRef.current;

    if (first !== null) {
      window.cancelAnimationFrame(first);
    }

    if (second !== null) {
      window.cancelAnimationFrame(second);
    }

    inspectorFitFramesRef.current = { first: null, second: null };
  }, []);

  const scheduleInspectorFit = useCallback(() => {
    cancelInspectorFit();

    const first = window.requestAnimationFrame(() => {
      inspectorFitFramesRef.current.first = null;
      const second = window.requestAnimationFrame(() => {
        inspectorFitFramesRef.current.second = null;
        fitCurrentFocus();
      });
      inspectorFitFramesRef.current.second = second;
    });

    inspectorFitFramesRef.current.first = first;
  }, [cancelInspectorFit, fitCurrentFocus]);

  useEffect(() => cancelInspectorFit, [cancelInspectorFit]);

  const toggleInspector = useCallback(() => {
    setInspectorCollapsed((collapsed) => !collapsed);
    scheduleInspectorFit();
  }, [scheduleInspectorFit]);

  useEffect(() => {
    const handleDetailsToggleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTextEditingTarget(event.target)) {
        return;
      }

      if (event.key.toLowerCase() !== 'd') {
        return;
      }

      event.preventDefault();
      toggleInspector();
    };

    window.addEventListener('keydown', handleDetailsToggleKey);

    return () => {
      window.removeEventListener('keydown', handleDetailsToggleKey);
    };
  }, [toggleInspector]);

  const onNodesChange = useCallback((changes: NodeChange<MapNode>[]) => {
    const selectedNodeChanged = changes.some(
      (change) => change.type === 'select' && change.selected,
    );

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

    if (selectedNodeChanged) {
      setSelectedEdgeId(null);
      setSelectedField(null);
    }
  }, []);

  const resetLayout = useCallback(() => {
    setManualPositions({});
    setRoutingPositions({});
    setLayoutResetCount((count) => count + 1);
  }, []);
  const exportSvg = useCallback(() => {
    downloadMapSvg(exportInput);
  }, [exportInput]);
  const exportPdf = useCallback(async () => {
    setPdfExportPending(true);
    try {
      await downloadMapPdf(exportInput);
    } catch (error) {
      console.error('Failed to export PDF', error);
    } finally {
      setPdfExportPending(false);
    }
  }, [exportInput]);
  const clearSearch = useCallback(() => {
    setQueryValue('');
    searchInputRef.current?.focus();
  }, []);
  const handleSearchKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>(
    (event) => {
      if (event.key !== 'Escape' || !event.currentTarget.value) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      clearSearch();
    },
    [clearSearch],
  );
  const selectServiceChoice = useCallback(
    (serviceChoiceId: string) => {
      setServiceChoiceIds((currentChoices) => ({
        ...currentChoices,
        [activeServiceId]: serviceChoiceId,
      }));
    },
    [activeServiceId],
  );
  const selectRpcFilter = useCallback(
    (rpcFilterId: string | null) => {
      setRpcFilterIds((currentFilterIds) => {
        const nextFilterIds = { ...currentFilterIds };
        if (!rpcFilterId || rpcFilterId === allRpcFilterId) {
          delete nextFilterIds[rpcFilterKey];
        } else {
          nextFilterIds[rpcFilterKey] = rpcFilterId;
        }
        return nextFilterIds;
      });
    },
    [rpcFilterKey],
  );
  const exportDisabled = layoutPending || pdfExportPending;

  return (
    <Box className="app-shell">
      <Box component="header" className="topbar">
        <Box className="brand">
          <span className="brand-kicker">{interfaceTitle(activeServiceId)}</span>
          <h1>{serviceSubtitle(activeServiceChoice)}</h1>
        </Box>

        <ServiceNav activeServiceId={activeServiceId} onSelect={setActiveServiceId} />

        <ServiceChoiceMenu
          serviceMap={activeService}
          value={activeServiceChoiceId}
          onSelect={selectServiceChoice}
        />

        <RpcFilterMenu
          choices={rpcFilterChoices}
          value={activeRpcFocusNodeId}
          onSelect={selectRpcFilter}
        />

        <Stack className="toolbar" direction="row" role="toolbar" aria-label="Map controls">
          <TextField
            className="map-search"
            value={queryValue}
            onChange={(event) => setQueryValue(event.target.value)}
            placeholder="Search messages, fields, enums"
            type="text"
            size="small"
            hiddenLabel
            inputRef={searchInputRef}
            slotProps={{
              htmlInput: {
                'aria-label': 'Search messages, fields, enums. Press slash to focus.',
                'aria-keyshortcuts': '/',
                onKeyDown: handleSearchKeyDown,
              },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18 }} />
                  </InputAdornment>
                ),
                endAdornment: queryValue ? (
                  <InputAdornment position="end">
                    <Tooltip title="Clear search">
                      <IconButton
                        aria-label="Clear search"
                        edge="end"
                        size="small"
                        type="button"
                        onClick={clearSearch}
                        onMouseDown={(event) => event.preventDefault()}
                        sx={{ mr: -0.75 }}
                      >
                        <CloseIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ) : (
                  <InputAdornment position="end">
                    <kbd className="search-keyboard-hint" title="Press / to search">
                      /
                    </kbd>
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              flex: '1 1 180px',
              width: { xs: '100%', md: 'clamp(140px, 18vw, 280px)' },
              minWidth: { xs: 0, md: 130 },
              '& .MuiInputBase-root': {
                height: 38,
              },
            }}
          />

          <Tooltip title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}>
            <IconButton
              type="button"
              aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
              aria-pressed={darkMode}
              onClick={onToggleTheme}
              sx={{
                flex: '0 0 auto',
                width: 38,
                height: 38,
                border: '1px solid var(--line)',
                bgcolor: 'var(--panel)',
                color: darkMode ? 'var(--switch-sun)' : 'var(--switch-moon)',
                '&:hover': {
                  borderColor: 'var(--focus)',
                  bgcolor: 'var(--panel)',
                  color: 'var(--focus)',
                },
              }}
            >
              {darkMode ? (
                <WbSunnyOutlinedIcon sx={{ fontSize: 19 }} />
              ) : (
                <DarkModeOutlinedIcon sx={{ fontSize: 19 }} />
              )}
            </IconButton>
          </Tooltip>

          <ViewOptionsMenu
            onFit={fit}
            onResetLayout={resetLayout}
            layoutPending={layoutPending}
            showExtensions={showExtensions}
            onToggleExtensions={() => setShowExtensions((value) => !value)}
            showDeprecated={showDeprecated}
            onToggleDeprecated={() => setShowDeprecated((value) => !value)}
            onExportPdf={exportPdf}
            onExportSvg={exportSvg}
            exportDisabled={exportDisabled}
            pdfExportPending={pdfExportPending}
          />
        </Stack>
      </Box>

      <main className={`map-stage${inspectorCollapsed ? ' is-inspector-collapsed' : ''}`}>
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
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.18}
          maxZoom={1.7}
          defaultViewport={{ x: 70, y: 40, zoom: 0.42 }}
          fitView
          fitViewOptions={{ padding: 0.08 }}
          onNodeClick={(_, node) => {
            setSelectedId(node.id);
            setSelectedEdgeId(null);
            setSelectedField(null);
          }}
          onEdgeClick={(event, edge) => {
            event.stopPropagation();
            setSelectedId(null);
            setSelectedEdgeId(edge.id);
            setSelectedField(null);
          }}
          onPaneClick={() => {
            setSelectedId(null);
            setSelectedEdgeId(null);
            setSelectedField(null);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--background-pattern)" gap={34} size={1.1} />
          <Controls position="bottom-left" />
          <div className="map-attribution" aria-label="Created with love by Florian Schwarz and Roman Dodin">
            <span>Created with</span>
            <FavoriteIcon className="map-attribution-heart" aria-hidden="true" />
            <span>by Florian Schwarz / Roman Dodin</span>
          </div>
        </ReactFlow>

        <div className="inspector-shell" role="complementary" aria-label="Details panel">
          {inspectorCollapsed ? (
            <span className="inspector-collapsed-icon" aria-hidden="true">
              <InfoOutlinedIcon sx={{ fontSize: 18 }} />
            </span>
          ) : null}

          <button
            className="inspector-toggle"
            type="button"
            aria-label={inspectorCollapsed ? 'Show details panel' : 'Hide details panel'}
            aria-expanded={!inspectorCollapsed}
            onClick={toggleInspector}
          >
            {inspectorCollapsed ? (
              <ChevronLeftIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightIcon sx={{ fontSize: 18 }} />
            )}
          </button>

          {!inspectorCollapsed ? (
            <Inspector
              node={selectedNode}
              selectedField={selectedFieldDetails}
              service={activeService}
              serviceLabel={activeService.label}
              serviceChoice={activeServiceChoice}
              serviceNode={activeServiceNode}
              totalNodes={visibleMap.nodes.length}
              totalEdges={visibleMap.edges.length}
            />
          ) : null}
        </div>
      </main>
    </Box>
  );
}

type ServiceNavProps = {
  activeServiceId: ServiceId;
  onSelect: (serviceId: ServiceId) => void;
};

function ServiceNav({ activeServiceId, onSelect }: ServiceNavProps) {
  return (
    <Tabs
      className="service-nav"
      value={activeServiceId}
      onChange={(_, serviceId: ServiceId) => onSelect(serviceId)}
      aria-label="Service maps"
      variant="scrollable"
      scrollButtons="auto"
      sx={{
        flex: '0 1 auto',
        minWidth: 0,
        p: '3px',
        border: '1px solid var(--line)',
        borderRadius: '8px',
        bgcolor: 'var(--panel-soft)',
      }}
    >
      {serviceMapOrder.map((serviceId) => (
        <Tab key={serviceId} value={serviceId} label={serviceMaps[serviceId].label} />
      ))}
    </Tabs>
  );
}

type ServiceChoiceMenuProps = {
  serviceMap: ServiceMapDefinition;
  value: string;
  onSelect: (serviceChoiceId: string) => void;
};

function ServiceChoiceMenu({ serviceMap, value, onSelect }: ServiceChoiceMenuProps) {
  const groups = useMemo(
    () => groupedServiceChoices(serviceMap.serviceChoices),
    [serviceMap.serviceChoices],
  );
  const selectedChoice = serviceChoiceForRoute(serviceMap, value);
  const selectedGroup =
    groups.find((group) => group.choices.some((choice) => choice.id === selectedChoice.id)) ??
    groups[0];
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(
    selectedGroup?.key ?? null,
  );
  const activeGroup =
    groups.find((group) => group.key === activeGroupKey) ?? selectedGroup ?? groups[0];
  const open = Boolean(anchorEl);

  useEffect(() => {
    setAnchorEl(null);
    setActiveGroupKey(selectedGroup?.key ?? null);
  }, [selectedGroup?.key, serviceMap.id]);

  if (serviceMap.serviceChoices.length <= 1) {
    return null;
  }

  const triggerId = `${serviceMap.id}-choice-trigger`;
  const selectedDisplayLabel = displayServiceChoiceLabel(selectedChoice.label);
  const activeGroupHasVersion = activeGroup?.choices.some((choice) => choice.version);
  const activeGroupSelectedChoice = activeGroup?.choices.find(
    (choice) => choice.id === selectedChoice.id,
  );
  const activeGroupPreselectedChoice =
    activeGroupSelectedChoice ?? (activeGroupHasVersion ? activeGroup?.choices[0] : undefined);

  const selectChoice = (serviceChoiceId: string) => {
    onSelect(serviceChoiceId);
    setAnchorEl(null);
  };

  return (
    <Box className="service-choice">
      <Button
        id={triggerId}
        variant="outlined"
        color="inherit"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${serviceMap.id}-choice-menu` : undefined}
        aria-label={`${serviceMap.label} service`}
        endIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
        onClick={(event) => {
          setAnchorEl((currentAnchor) => (currentAnchor ? null : event.currentTarget));
          setActiveGroupKey(selectedGroup?.key ?? groups[0]?.key ?? null);
        }}
        sx={{
          justifyContent: 'space-between',
          width: '100%',
          height: 38,
          minWidth: 0,
          px: 1.25,
          borderColor: 'var(--line)',
          bgcolor: 'var(--panel)',
          color: 'var(--ink)',
          '&:hover': {
            borderColor: 'var(--focus)',
            bgcolor: 'var(--panel)',
          },
        }}
      >
        <Box className="service-choice-current" component="span">
          <Box className="service-choice-name" component="span">
            {selectedDisplayLabel}
          </Box>
          {selectedChoice.version ? (
            <Chip
              component="span"
              label={selectedChoice.version}
              size="small"
              sx={{
                flex: '0 0 auto',
                bgcolor: 'var(--panel-soft)',
                color: 'var(--muted)',
              }}
            />
          ) : null}
        </Box>
      </Button>

      <Menu
        id={`${serviceMap.id}-choice-menu`}
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          list: {
            'aria-labelledby': triggerId,
            dense: true,
          },
          paper: {
            sx: {
              mt: 0.75,
              maxWidth: 'min(420px, calc(100vw - 24px))',
            },
          },
        }}
      >
        <Box className="service-choice-popover" role="presentation">
          <Box className="service-choice-list">
            {groups.map((group) => {
              const groupSelected = group.choices.some(
                (choice) => choice.id === selectedChoice.id,
              );
              const groupHasVersion = group.choices.some((choice) => choice.version);
              const active = group.key === activeGroup?.key;

              return (
                <MenuItem
                  key={group.key}
                  selected={active || groupSelected}
                  aria-haspopup={groupHasVersion ? 'menu' : undefined}
                  aria-expanded={groupHasVersion ? group.key === activeGroup?.key : undefined}
                  aria-current={groupSelected ? 'true' : undefined}
                  onClick={() => {
                    selectChoice(group.choices[0].id);
                  }}
                  onFocus={() => setActiveGroupKey(group.key)}
                  onMouseEnter={() => setActiveGroupKey(group.key)}
                  sx={{ minWidth: 166 }}
                >
                  <ListItemText
                    primary={
                      <Typography component="span" noWrap sx={{ fontSize: 13, fontWeight: 800 }}>
                        {group.displayLabel}
                      </Typography>
                    }
                  />
                  {groupHasVersion ? <ChevronRightIcon sx={{ fontSize: 18 }} /> : null}
                </MenuItem>
              );
            })}
          </Box>

          {activeGroup && activeGroupHasVersion ? (
            <Box
              className="service-choice-submenu"
              role="menu"
              aria-label={`${activeGroup.displayLabel} versions`}
            >
              {activeGroup.choices.map((choice) => {
                const selected = choice.id === selectedChoice.id;
                const preselected = choice.id === activeGroupPreselectedChoice?.id;

                return (
                  <MenuItem
                    key={choice.id}
                    selected={selected || (!selected && preselected)}
                    aria-checked={selected}
                    onClick={() => selectChoice(choice.id)}
                    sx={{
                      justifyContent: 'center',
                      minWidth: 62,
                      px: 1,
                    }}
                  >
                    <span>{choice.version ?? 'Current'}</span>
                  </MenuItem>
                );
              })}
            </Box>
          ) : null}
        </Box>
      </Menu>
    </Box>
  );
}

type RpcFilterMenuProps = {
  choices: RpcFilterChoice[];
  value: string | null;
  onSelect: (rpcFilterId: string | null) => void;
};

function RpcFilterMenu({ choices, value, onSelect }: RpcFilterMenuProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const selectedChoice = choices.find((choice) => choice.id === value) ?? null;
  const selectedLabel = selectedChoice
    ? displayServiceChoiceLabel(selectedChoice.label)
    : 'All RPCs';
  const open = Boolean(anchorEl);

  useEffect(() => {
    setAnchorEl(null);
  }, [choices, value]);

  if (!choices.length) {
    return null;
  }

  const selectChoice = (rpcFilterId: string | null) => {
    onSelect(rpcFilterId);
    setAnchorEl(null);
  };

  return (
    <Box className="rpc-filter">
      <Button
        id="rpc-filter-trigger"
        variant="outlined"
        color="inherit"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'rpc-filter-menu' : undefined}
        aria-label="RPC filter"
        startIcon={<FilterListIcon sx={{ fontSize: 18 }} />}
        endIcon={<ExpandMoreIcon sx={{ fontSize: 18 }} />}
        onClick={(event) => setAnchorEl((currentAnchor) => (currentAnchor ? null : event.currentTarget))}
        sx={{
          justifyContent: 'space-between',
          width: '100%',
          height: 38,
          minWidth: 0,
          px: 1.25,
          borderColor: 'var(--line)',
          bgcolor: 'var(--panel)',
          color: 'var(--ink)',
          '& .MuiButton-startIcon': { mr: 0.75 },
          '& .MuiButton-endIcon': { ml: 0.75 },
          '&:hover': {
            borderColor: 'var(--focus)',
            bgcolor: 'var(--panel)',
          },
        }}
      >
        <Box className="rpc-filter-current" component="span">
          {selectedLabel}
        </Box>
      </Button>

      <Menu
        id="rpc-filter-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          list: {
            'aria-labelledby': 'rpc-filter-trigger',
            dense: true,
          },
          paper: {
            sx: {
              mt: 0.75,
              minWidth: 190,
              maxHeight: 'min(430px, calc(100vh - 120px))',
            },
          },
        }}
      >
        <MenuItem
          selected={!selectedChoice}
          role="menuitemradio"
          aria-checked={!selectedChoice}
          onClick={() => selectChoice(null)}
        >
          <ListItemText
            primary={
              <Typography component="span" noWrap sx={{ fontSize: 13, fontWeight: 800 }}>
                All RPCs
              </Typography>
            }
          />
        </MenuItem>

        {choices.map((choice) => {
          const selected = choice.id === selectedChoice?.id;
          return (
            <MenuItem
              key={choice.id}
              selected={selected}
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => selectChoice(choice.id)}
            >
              <ListItemText
                primary={
                  <Typography component="span" noWrap sx={{ fontSize: 13, fontWeight: 800 }}>
                    {displayServiceChoiceLabel(choice.label)}
                  </Typography>
                }
              />
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}

type ViewOptionsMenuProps = {
  onFit: () => void;
  onResetLayout: () => void;
  layoutPending: boolean;
  showExtensions: boolean;
  onToggleExtensions: () => void;
  showDeprecated: boolean;
  onToggleDeprecated: () => void;
  onExportPdf: () => Promise<void>;
  onExportSvg: () => void;
  exportDisabled: boolean;
  pdfExportPending: boolean;
};

function ViewOptionsMenu({
  onFit,
  onResetLayout,
  layoutPending,
  showExtensions,
  onToggleExtensions,
  showDeprecated,
  onToggleDeprecated,
  onExportPdf,
  onExportSvg,
  exportDisabled,
  pdfExportPending,
}: ViewOptionsMenuProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [hotkeysOpen, setHotkeysOpen] = useState(false);
  const open = Boolean(anchorEl);

  const fit = () => {
    onFit();
    setAnchorEl(null);
  };
  const resetLayout = () => {
    onResetLayout();
    setAnchorEl(null);
  };
  const exportPdf = () => {
    void onExportPdf();
    setAnchorEl(null);
  };
  const exportSvg = () => {
    onExportSvg();
    setAnchorEl(null);
  };
  const openHotkeys = () => {
    setAnchorEl(null);
    setHotkeysOpen(true);
  };

  return (
    <Box className="view-options">
      <Tooltip title="View options">
        <IconButton
          id="view-options-trigger"
          className="view-options-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'view-options-menu' : undefined}
          aria-label="View options"
          onClick={(event) => setAnchorEl((currentAnchor) => (currentAnchor ? null : event.currentTarget))}
          sx={{
            width: 38,
            height: 38,
            border: '1px solid var(--line)',
            bgcolor: 'var(--panel)',
            color: 'var(--ink)',
            '&:hover': {
              borderColor: 'var(--focus)',
              bgcolor: 'var(--panel)',
              color: 'var(--focus)',
            },
          }}
        >
          <SettingsOutlinedIcon sx={{ fontSize: 19 }} />
        </IconButton>
      </Tooltip>

      <Menu
        id="view-options-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          list: {
            'aria-labelledby': 'view-options-trigger',
            dense: true,
          },
          paper: {
            sx: {
              mt: 0.75,
              minWidth: 186,
            },
          },
        }}
      >
        <MenuItem onClick={fit}>
          <ListItemIcon>
            <FitScreenOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Fit" />
        </MenuItem>

        <MenuItem onClick={resetLayout} disabled={layoutPending}>
          <ListItemIcon>
            <RestartAltIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Reset" />
        </MenuItem>

        <MenuItem onClick={openHotkeys}>
          <ListItemIcon>
            <InfoOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Hotkeys" />
        </MenuItem>

        <Divider sx={{ my: 0.5 }} />

        <MenuItem
          selected={showExtensions}
          role="menuitemcheckbox"
          aria-checked={showExtensions}
          onClick={onToggleExtensions}
          title="Show extension fields and extension-detail relationships."
        >
          <ListItemIcon>
            <HubOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Extensions" />
          {showExtensions ? <CheckIcon sx={{ fontSize: 16 }} /> : null}
        </MenuItem>

        <MenuItem
          selected={showDeprecated}
          role="menuitemcheckbox"
          aria-checked={showDeprecated}
          onClick={onToggleDeprecated}
          title="Show deprecated proto fields and deprecated message types."
        >
          <ListItemIcon>
            <VisibilityOffOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Deprecated" />
          {showDeprecated ? <CheckIcon sx={{ fontSize: 16 }} /> : null}
        </MenuItem>

        <Divider sx={{ my: 0.5 }} />

        <MenuItem onClick={exportPdf} disabled={exportDisabled} aria-busy={pdfExportPending}>
          <ListItemIcon>
            <PictureAsPdfOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Export PDF" />
        </MenuItem>

        <MenuItem onClick={exportSvg} disabled={exportDisabled}>
          <ListItemIcon>
            <DataObjectOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Export SVG" />
        </MenuItem>
      </Menu>

      <HotkeysDialog open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
    </Box>
  );
}

function SchemaNode({ data, selected }: NodeProps<MapNode>) {
  const fields = data.fields ?? [];
  const dimmed = data.active === false;
  const targetHandles = targetHandlesFromData(data);
  const fieldConnectionIds = fieldConnectionIdsFromData(data);
  const onFieldSelect = fieldSelectHandlerFromData(data);
  const selectedFieldId = typeof data.selectedFieldId === 'string' ? data.selectedFieldId : null;
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
              <CodeOutlinedIcon sx={{ fontSize: 14 }} aria-hidden="true" />
            </a>
          ) : null}
          {data.specUrl ? (
            <a href={data.specUrl} title="Service documentation" target="_blank" rel="noreferrer">
              <MenuBookOutlinedIcon sx={{ fontSize: 14 }} aria-hidden="true" />
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
              selected={field.id === selectedFieldId}
              connectionEdgeId={fieldConnectionIds[field.id]}
              onFieldSelect={onFieldSelect}
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
  selected: boolean;
  connectionEdgeId?: string;
  onFieldSelect?: FieldSelectHandler;
  showExtensions?: boolean;
};

function FieldRow({
  field,
  highlighted,
  edgeHighlighted,
  selected,
  connectionEdgeId,
  onFieldSelect,
  showExtensions,
}: FieldRowProps) {
  const isExtension = field.ref === 'extension';
  const visibleExtensionHandle = !isExtension || showExtensions;
  const clickable = Boolean(onFieldSelect);
  const fieldTitle = [field.type, field.name, field.group, field.badge]
    .filter(Boolean)
    .join(' ');
  const selectField = () => {
    if (onFieldSelect) {
      onFieldSelect(field.id, connectionEdgeId);
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
        selected ? 'is-selected' : '',
        clickable ? 'is-clickable nodrag nopan' : '',
        field.badge === 'deprecated' ? 'is-deprecated' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={field.ref ? `${fieldTitle} -> ${field.ref}` : fieldTitle}
      aria-label={clickable ? `Select ${field.name} field` : undefined}
      onClick={(event) => {
        if (!clickable) {
          return;
        }
        event.stopPropagation();
        selectField();
      }}
      onKeyDown={(event) => {
        if (!clickable || (event.key !== 'Enter' && event.key !== ' ')) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        selectField();
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

function fieldSelectHandlerFromData(data: MapNode['data']): FieldSelectHandler | undefined {
  return typeof data.onFieldSelect === 'function'
    ? (data.onFieldSelect as FieldSelectHandler)
    : undefined;
}

type DescriptionBlock = {
  text: string;
  preformatted: boolean;
};

function descriptionBlocks(description: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let lines: string[] = [];

  const flush = () => {
    const trimmedLines = lines.map((line) => line.trimEnd()).filter((line) => line.trim());
    lines = [];
    if (!trimmedLines.length) {
      return;
    }

    const preformatted = isPreformattedDescription(trimmedLines);
    if (preformatted) {
      blocks.push({ preformatted: true, text: trimmedLines.join('\n') });
      return;
    }

    for (const text of readableParagraphs(
      trimmedLines
        .map((line) => line.trim())
        .join(' ')
        .replace(/\s+/g, ' '),
    )) {
      blocks.push({ preformatted: false, text });
    }
  };

  for (const line of description.replace(/\r\n/g, '\n').split('\n')) {
    if (line.trim()) {
      lines.push(line);
    } else {
      flush();
    }
  }
  flush();

  return blocks;
}

function isPreformattedDescription(lines: string[]): boolean {
  return lines.some((line) =>
    /(?:<-{2,}|-{2,}>|={3,}|\|)|^\s*(?:Client|Target)\s|^\s*(?:[-*]|\d+[.)])\s/.test(line),
  );
}

function readableParagraphs(text: string): string[] {
  if (text.length < 220) {
    return [text];
  }

  const sentences = text.match(/[^.!?]+(?:[.!?]+(?:\)|\])?)?/g)?.map((sentence) => sentence.trim()) ?? [
    text,
  ];
  const paragraphs: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (!sentence) {
      continue;
    }
    if (!current) {
      current = sentence;
      continue;
    }
    if (current.length + sentence.length > 260) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = `${current} ${sentence}`;
    }
  }

  if (current) {
    paragraphs.push(current);
  }
  return paragraphs.length ? paragraphs : [text];
}

function normalizedSectionNumber(section: string): string {
  return section.replace(/\s+/g, '');
}

function sectionAnchorPrefix(section: string): string {
  return normalizedSectionNumber(section).replace(/\./g, '');
}

function gnmiSpecificationSectionUrl(section: string, specUrl: string | undefined): string | null {
  if (!specUrl) {
    return null;
  }

  const hash = specUrl.split('#')[1];
  const anchorPrefix = sectionAnchorPrefix(section);
  if (!hash || (hash !== anchorPrefix && !hash.startsWith(`${anchorPrefix}-`))) {
    return null;
  }

  return specUrl;
}

function linkedDescriptionText(
  text: string,
  keyPrefix: string,
  specUrl: string | undefined,
): ReactNode[] {
  const sectionReferencePattern =
    /\bgNMI Specification\s+Section(?:\s+Section)?\s+((?:\d+\s*\.\s*)*\d+)/gi;
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(sectionReferencePattern)) {
    const index = match.index ?? 0;
    const section = match[1];
    const href = gnmiSpecificationSectionUrl(section, specUrl);
    if (!href) {
      continue;
    }

    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }
    nodes.push(
      <a
        key={`${keyPrefix}:section:${index}`}
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {`gNMI Specification Section ${normalizedSectionNumber(section)}`}
      </a>,
    );
    cursor = index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes.length ? nodes : [text];
}

function inlineDescriptionText(text: string, specUrl?: string): ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.flatMap((part, index): ReactNode[] =>
    part.startsWith('`') && part.endsWith('`') ? (
      [<code key={`code:${index}`}>{part.slice(1, -1)}</code>]
    ) : (
      linkedDescriptionText(part, `text:${index}`, specUrl)
    ),
  );
}

function DescriptionText({
  text,
  className,
  specUrl,
}: {
  text: string;
  className: string;
  specUrl?: string;
}) {
  const blocks = descriptionBlocks(text);
  if (!blocks.length) {
    return null;
  }

  return (
    <div className={className}>
      {blocks.map((block, index) =>
        block.preformatted ? (
          <pre key={index}>{block.text}</pre>
        ) : (
          <p key={index}>{inlineDescriptionText(block.text, specUrl)}</p>
        ),
      )}
    </div>
  );
}

type InspectorProps = {
  node?: MapNode;
  selectedField?: SelectedFieldDetails | null;
  service: ServiceMapDefinition;
  serviceLabel: string;
  serviceChoice: ServiceMapChoice;
  serviceNode?: MapNode;
  totalNodes: number;
  totalEdges: number;
};

type InspectorDocumentationLink = {
  href: string;
  label: string;
  description: string;
  icon: ReactNode;
};

function Inspector({
  node,
  selectedField,
  service,
  serviceLabel,
  serviceChoice,
  serviceNode,
  totalNodes,
  totalEdges,
}: InspectorProps) {
  if (selectedField) {
    const { node: parentNode, field, refNode } = selectedField;
    const refFieldCount = refNode?.data.fields?.length ?? 0;

    return (
      <Paper component="aside" className="inspector" elevation={0} square>
        <Typography className="inspector-kicker" component="span">
          {parentNode.data.kind} field
        </Typography>
        <Typography variant="h6" component="h2">
          {field.name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {field.type} in {parentNode.data.label}
        </Typography>

        <Stack className="inspector-actions" direction="row" sx={{ flexWrap: 'wrap' }}>
          {parentNode.data.protoUrl ? (
            <Button
              component="a"
              href={parentNode.data.protoUrl}
              target="_blank"
              rel="noreferrer"
              size="small"
              variant="outlined"
              startIcon={<CodeOutlinedIcon fontSize="small" />}
              endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
            >
              Proto
            </Button>
          ) : null}
          {parentNode.data.specUrl ? (
            <Button
              component="a"
              href={parentNode.data.specUrl}
              target="_blank"
              rel="noreferrer"
              size="small"
              variant="outlined"
              startIcon={<MenuBookOutlinedIcon fontSize="small" />}
              endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
            >
              Docs
            </Button>
          ) : null}
        </Stack>

        <div className="inspector-fields">
          <div className="inspector-field">
            <div className="inspector-field-main">
              <span>{field.type}</span>
              <strong>{field.name}</strong>
              {field.group ? <span>{field.group}</span> : null}
              {field.badge ? <span>{field.badge}</span> : null}
            </div>
            {field.description ? (
              <DescriptionText
                className="inspector-field-description"
                text={field.description}
                specUrl={parentNode.data.specUrl}
              />
            ) : (
              <p className="inspector-field-description">No field description in the proto.</p>
            )}
          </div>

          {refNode ? (
            <div className="inspector-field">
              <div className="inspector-field-main">
                <span>{refNode.data.kind}</span>
                <strong>{refNode.data.label}</strong>
              </div>
              {refNode.data.description ? (
                <DescriptionText
                  className="inspector-field-description"
                  text={refNode.data.description}
                  specUrl={refNode.data.specUrl}
                />
              ) : (
                <p className="inspector-field-description">
                  {refFieldCount
                    ? `${refNode.data.label} has ${refFieldCount} fields.`
                    : `${refNode.data.label} is an empty ${refNode.data.kind}.`}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </Paper>
    );
  }

  if (!node) {
    const displayChoiceLabel = displayServiceChoiceLabel(serviceChoice.label);
    const sourceTag = serviceChoice.sourceTag ?? service.sourceTag;
    const version = serviceChoice.version ?? service.serviceVersion;
    const repositoryUrl = `https://github.com/${service.sourceRepository}`;
    const sourceTagUrl = sourceTag ? `${repositoryUrl}/tree/${sourceTag}` : null;
    const documentationLinks: InspectorDocumentationLink[] = [];

    if (serviceNode?.data.specUrl) {
      documentationLinks.push({
        href: serviceNode.data.specUrl,
        label: 'Specification',
        description: `${displayChoiceLabel} protocol documentation`,
        icon: <MenuBookOutlinedIcon fontSize="small" />,
      });
    }

    if (serviceNode?.data.protoUrl) {
      documentationLinks.push({
        href: serviceNode.data.protoUrl,
        label: 'Service proto',
        description: serviceChoice.symbol,
        icon: <CodeOutlinedIcon fontSize="small" />,
      });
    }

    documentationLinks.push({
      href: repositoryUrl,
      label: 'Source repository',
      description: service.sourceRepository,
      icon: <HubOutlinedIcon fontSize="small" />,
    });

    if (sourceTag && sourceTagUrl) {
      documentationLinks.push({
        href: sourceTagUrl,
        label: 'Source tag',
        description: sourceTag,
        icon: <CodeOutlinedIcon fontSize="small" />,
      });
    }

    return (
      <Paper component="aside" className="inspector" elevation={0} square>
        <Typography className="inspector-kicker" component="span">
          {serviceLabel}
        </Typography>
        <Typography variant="h6" component="h2">
          {displayChoiceLabel} documentation
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {service.description}
        </Typography>

        <div className="inspector-summary" aria-label="Current map summary">
          {version ? <span>Version {version}</span> : null}
          {sourceTag ? <span>{sourceTag}</span> : null}
          <span>{totalNodes} nodes</span>
          <span>{totalEdges} relationships</span>
        </div>

        <div className="inspector-doc-links" aria-label={`${serviceLabel} documentation links`}>
          {documentationLinks.map((link) => (
            <a key={`${link.label}:${link.href}`} href={link.href} target="_blank" rel="noreferrer">
              <span className="inspector-doc-icon" aria-hidden="true">
                {link.icon}
              </span>
              <span className="inspector-doc-text">
                <strong>{link.label}</strong>
                <span>{link.description}</span>
              </span>
              <OpenInNewIcon sx={{ fontSize: 14 }} />
            </a>
          ))}
        </div>
      </Paper>
    );
  }

  return (
    <Paper component="aside" className="inspector" elevation={0} square>
      <Typography className="inspector-kicker" component="span">
        {node.data.kind}
      </Typography>
      <Typography variant="h6" component="h2">
        {node.data.label}
      </Typography>

      <Stack className="inspector-actions" direction="row" sx={{ flexWrap: 'wrap' }}>
        {node.data.protoUrl ? (
          <Button
            component="a"
            href={node.data.protoUrl}
            target="_blank"
            rel="noreferrer"
            size="small"
            variant="outlined"
            startIcon={<CodeOutlinedIcon fontSize="small" />}
            endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
          >
            Proto
          </Button>
        ) : null}
        {node.data.specUrl ? (
          <Button
            component="a"
            href={node.data.specUrl}
            target="_blank"
            rel="noreferrer"
            size="small"
            variant="outlined"
            startIcon={<MenuBookOutlinedIcon fontSize="small" />}
            endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
          >
            Docs
          </Button>
        ) : null}
      </Stack>

      {node.data.description ? (
        <DescriptionText
          className="inspector-description"
          text={node.data.description}
          specUrl={node.data.specUrl}
        />
      ) : null}

      {node.data.fields?.length ? (
        <div className="inspector-fields">
          {node.data.fields.map((field) => (
            <div key={field.id} className="inspector-field">
              <div className="inspector-field-main">
                <span>{field.type}</span>
                <strong>{field.name}</strong>
              </div>
              {field.description ? (
                <DescriptionText
                  className="inspector-field-description"
                  text={field.description}
                  specUrl={node.data.specUrl}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No fields.
        </Typography>
      )}
    </Paper>
  );
}

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme);
  const muiTheme = useMemo(() => createAppTheme(themeMode), [themeMode]);
  const toggleTheme = useCallback(() => {
    setThemeMode((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline enableColorScheme />
      <ReactFlowProvider>
        <AppShell themeMode={themeMode} onToggleTheme={toggleTheme} />
      </ReactFlowProvider>
    </ThemeProvider>
  );
}
