import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dagre from '@dagrejs/dagre';
import { SmartStepEdge } from '@jalez/react-flow-smart-edge';
import { parse, stringify } from 'yaml';
import {
  Box,
  Button,
  CssBaseline,
  FormControlLabel,
  Link,
  Paper,
  Switch,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from '@mui/material';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
} from '@xyflow/react';
import { GnmiNode } from './components/GnmiNode';
import {
  gnmiEdges,
  gnmiNodes,
  HEADER_SOURCE_HANDLE,
  HEADER_TARGET_HANDLE,
  sourceLinks,
  type GnmiNode as GnmiFlowNode,
  type GnmiNodeData,
} from './data/gnmi070';

const nodeTypes = {
  gnmi: GnmiNode,
};

const edgeTypes = {
  smart: SmartStepEdge,
};

const edgeDefaults = {
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
  },
};

function getEdgeColor(className: string | undefined, isSelected: boolean, isConnected: boolean) {
  if (isSelected) {
    return 'var(--ctp-mauve)';
  }

  if (isConnected) {
    return 'var(--ctp-peach)';
  }

  if (className?.includes('edge-service')) {
    return 'var(--ctp-teal)';
  }

  if (className?.includes('edge-rpc')) {
    return 'var(--ctp-blue)';
  }

  if (className?.includes('edge-oneof')) {
    return 'var(--ctp-mauve)';
  }

  if (className?.includes('edge-deprecated')) {
    return 'var(--ctp-red)';
  }

  return 'var(--ctp-overlay0)';
}

const POSITIONS_FILE_URL = '/services/gnmi/0.7.0/pos.yaml';
const AUTO_LAYOUT_CONFIG = {
  rankdir: 'LR',
  nodesep: 120,
  ranksep: 260,
  marginx: 120,
  marginy: 120,
};

type ThemeMode = 'light' | 'dark';

const catppuccin = {
  light: {
    base: '#eff1f5',
    mantle: '#e6e9ef',
    crust: '#dce0e8',
    surface0: '#ccd0da',
    surface1: '#bcc0cc',
    surface2: '#acb0be',
    overlay0: '#9ca0b0',
    overlay1: '#8c8fa1',
    text: '#4c4f69',
    subtext1: '#5c5f77',
    blue: '#1e66f5',
    lavender: '#7287fd',
    teal: '#179299',
    green: '#40a02b',
    mauve: '#8839ef',
    peach: '#fe640b',
    red: '#d20f39',
  },
  dark: {
    base: '#1e1e2e',
    mantle: '#181825',
    crust: '#11111b',
    surface0: '#313244',
    surface1: '#45475a',
    surface2: '#585b70',
    overlay0: '#6c7086',
    overlay1: '#7f849c',
    text: '#cdd6f4',
    subtext1: '#bac2de',
    blue: '#89b4fa',
    lavender: '#b4befe',
    teal: '#94e2d5',
    green: '#a6e3a1',
    mauve: '#cba6f7',
    peach: '#fab387',
    red: '#f38ba8',
  },
} as const;

type NodePosition = {
  x: number;
  y: number;
};

type PositionsFile = {
  nodes?: Record<string, NodePosition>;
  positions?: Record<string, NodePosition>;
};

type VisibleHandles = NonNullable<GnmiNodeData['visibleHandles']>;

function getSystemTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function createCatppuccinTheme(mode: ThemeMode) {
  const palette = catppuccin[mode];

  return createTheme({
    palette: {
      mode,
      primary: {
        main: palette.teal,
      },
      secondary: {
        main: palette.blue,
      },
      error: {
        main: palette.red,
      },
      warning: {
        main: palette.peach,
      },
      success: {
        main: palette.green,
      },
      text: {
        primary: palette.text,
        secondary: palette.subtext1,
      },
      background: {
        default: palette.base,
        paper: palette.mantle,
      },
      divider: palette.surface0,
    },
    shape: {
      borderRadius: 4,
    },
    typography: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h1: {
        fontWeight: 800,
        letterSpacing: '-0.04em',
      },
      button: {
        fontWeight: 800,
        textTransform: 'none',
      },
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            boxShadow: 'none',
          },
        },
      },
    },
  });
}

function matchesQuery(node: Node<GnmiNodeData>, query: string) {
  const haystack = [
    node.data.title,
    node.data.subtitle,
    node.data.kind,
    node.data.packageName,
    node.data.codePath,
    ...(node.data.fields?.map((field) => field.signature) ?? []),
    ...(node.data.values ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

function isPosition(value: unknown): value is NodePosition {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as NodePosition).x === 'number' &&
    typeof (value as NodePosition).y === 'number'
  );
}

function getPositions(payload: unknown): Record<string, NodePosition> {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }

  const maybeFile = payload as PositionsFile;
  const candidate = maybeFile.nodes ?? maybeFile.positions ?? payload;

  if (typeof candidate !== 'object' || candidate === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(candidate).filter((entry): entry is [string, NodePosition] => isPosition(entry[1])),
  );
}

function getPositionsYaml(nodes: GnmiFlowNode[]) {
  const positions = Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      },
    ]),
  );

  return stringify({ nodes: positions });
}

function applyPositions(nodes: GnmiFlowNode[], positions: Record<string, NodePosition>) {
  return nodes.map((node) => ({
    ...node,
    position: positions[node.id] ?? node.position,
  }));
}

function createVisibleHandleMap() {
  const handlesByNode = new Map<string, Required<VisibleHandles>>();

  const getHandles = (nodeId: string) => {
    const existing = handlesByNode.get(nodeId);

    if (existing) {
      return existing;
    }

    const handles = {
      headerSource: false,
      headerTarget: false,
      fieldSources: [],
      fieldTargets: [],
    };

    handlesByNode.set(nodeId, handles);
    return handles;
  };

  gnmiEdges.forEach((edge) => {
    const sourceHandles = getHandles(edge.source);
    const targetHandles = getHandles(edge.target);

    if (edge.sourceHandle === HEADER_SOURCE_HANDLE) {
      sourceHandles.headerSource = true;
    } else if (edge.sourceHandle) {
      sourceHandles.fieldSources.push(edge.sourceHandle);
    }

    if (edge.targetHandle === HEADER_TARGET_HANDLE) {
      targetHandles.headerTarget = true;
    } else if (edge.targetHandle) {
      targetHandles.fieldTargets.push(edge.targetHandle);
    }
  });

  return handlesByNode;
}

function estimatedNodeSize(node: Node<GnmiNodeData>) {
  const rowCount = Math.max(node.data.fields?.length ?? 0, node.data.values?.length ?? 0);
  const baseHeight = 112;
  const rowHeight = 36;
  const noteHeight = node.data.note ? 44 : 0;

  return {
    width: node.data.kind === 'service' ? 300 : node.data.kind === 'enum' || node.data.kind === 'oneof' ? 240 : 260,
    height: baseHeight + rowCount * rowHeight + noteHeight,
  };
}

type GnmiMapProps = {
  themeMode: ThemeMode;
  onThemeToggle: () => void;
};

function GnmiMap({ themeMode, onThemeToggle }: GnmiMapProps) {
  const [query, setQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [useSmartRouting, setUseSmartRouting] = useState(false);
  const [flowNodes, setFlowNodes] = useState<GnmiFlowNode[]>(gnmiNodes);
  const [positionsStatus, setPositionsStatus] = useState<'checking' | 'loaded' | 'missing' | 'invalid'>(
    'checking',
  );
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const nodesInitialized = useNodesInitialized();
  const { fitView, getNodes } = useReactFlow();
  const hasAutoLayoutRun = useRef(false);
  const visibleHandleMap = useMemo(() => createVisibleHandleMap(), []);

  const runAutoLayout = useCallback(() => {
    const measuredNodes = getNodes() as GnmiFlowNode[];
    const nodesForLayout = measuredNodes.length > 0 ? measuredNodes : flowNodes;
    const graph = new dagre.graphlib.Graph({ multigraph: true });

    graph.setGraph(AUTO_LAYOUT_CONFIG);
    graph.setDefaultEdgeLabel(() => ({}));

    nodesForLayout.forEach((node) => {
      const estimate = estimatedNodeSize(node);

      graph.setNode(node.id, {
        width: node.measured?.width ?? node.width ?? estimate.width,
        height: node.measured?.height ?? node.height ?? estimate.height,
      });
    });

    gnmiEdges.forEach((edge) => {
      graph.setEdge(edge.source, edge.target, {}, edge.id);
    });

    dagre.layout(graph);

    setFlowNodes((currentNodes) =>
      currentNodes.map((node) => {
        const layoutNode = graph.node(node.id);
        const measuredNode = nodesForLayout.find((candidate) => candidate.id === node.id);
        const estimate = estimatedNodeSize(node);
        const width = measuredNode?.measured?.width ?? measuredNode?.width ?? estimate.width;
        const height = measuredNode?.measured?.height ?? measuredNode?.height ?? estimate.height;

        if (!layoutNode) {
          return node;
        }

        return {
          ...node,
          position: {
            x: Math.round(layoutNode.x - width / 2),
            y: Math.round(layoutNode.y - height / 2),
          },
        };
      }),
    );

    window.requestAnimationFrame(() => fitView({ duration: 300, padding: 0.12 }));
  }, [fitView, flowNodes, getNodes]);

  useEffect(() => {
    let isMounted = true;

    fetch(POSITIONS_FILE_URL, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        return response.text();
      })
      .then((payload: string | null) => {
        if (!isMounted) {
          return;
        }

        if (!payload) {
          setUseSmartRouting(true);
          setPositionsStatus('missing');
          return;
        }

        const positions = getPositions(parse(payload));

        if (Object.keys(positions).length === 0) {
          setUseSmartRouting(true);
          setPositionsStatus('invalid');
          return;
        }

        setFlowNodes((nodes) => applyPositions(nodes, positions));
        setUseSmartRouting(false);
        setPositionsStatus('loaded');
      })
      .catch(() => {
        if (isMounted) {
          setUseSmartRouting(true);
          setPositionsStatus('missing');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (
      !nodesInitialized ||
      positionsStatus === 'checking' ||
      positionsStatus === 'loaded' ||
      hasAutoLayoutRun.current
    ) {
      return;
    }

    hasAutoLayoutRun.current = true;
    runAutoLayout();
  }, [nodesInitialized, positionsStatus, runAutoLayout]);

  const visibleIds = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return new Set(gnmiNodes.map((node) => node.id));
    }

    const directMatches = new Set(
      gnmiNodes.filter((node) => matchesQuery(node, normalized)).map((node) => node.id),
    );

    gnmiEdges.forEach((edge) => {
      if (directMatches.has(edge.source)) {
        directMatches.add(edge.target);
      }
      if (directMatches.has(edge.target)) {
        directMatches.add(edge.source);
      }
    });

    return directMatches;
  }, [query]);

  const selectedNeighborhood = useMemo(() => {
    if (selectedEdgeId) {
      const selectedEdge = gnmiEdges.find((edge) => edge.id === selectedEdgeId);

      if (!selectedEdge) {
        return null;
      }

      return {
        nodeIds: new Set([selectedEdge.source, selectedEdge.target]),
        edgeIds: new Set([selectedEdge.id]),
      };
    }

    if (!selectedNodeId) {
      return null;
    }

    const nodeIds = new Set([selectedNodeId]);
    const edgeIds = new Set<string>();

    gnmiEdges.forEach((edge) => {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        nodeIds.add(edge.source);
        nodeIds.add(edge.target);
        edgeIds.add(edge.id);
      }
    });

    return { nodeIds, edgeIds };
  }, [selectedEdgeId, selectedNodeId]);

  const nodes = useMemo(
    () =>
      flowNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          visibleHandles: visibleHandleMap.get(node.id),
        },
        hidden: !visibleIds.has(node.id),
        className:
          selectedNeighborhood && !selectedNeighborhood.nodeIds.has(node.id)
            ? 'is-dimmed'
            : undefined,
        selected: selectedNodeId === node.id,
      })),
    [flowNodes, selectedNeighborhood, selectedNodeId, visibleHandleMap, visibleIds],
  );

  const edges = useMemo(
    () =>
      gnmiEdges.map((edge) => {
        const isSelectedEdge = edge.id === selectedEdgeId;
        const isConnected = Boolean(selectedNeighborhood?.edgeIds.has(edge.id));
        const isDimmed = Boolean(selectedNeighborhood && !selectedNeighborhood.edgeIds.has(edge.id));
        const edgeColor = getEdgeColor(edge.className, isSelectedEdge, isConnected);

        return {
          ...edge,
          ...edgeDefaults,
          markerEnd: {
            ...edgeDefaults.markerEnd,
            color: edgeColor,
          },
          type: useSmartRouting && !isSelectedEdge ? edge.type : 'smoothstep',
          selected: isSelectedEdge,
          style: isSelectedEdge
            ? { stroke: edgeColor, strokeWidth: 5 }
            : isConnected
              ? { stroke: edgeColor, strokeWidth: 4 }
              : undefined,
          hidden: !visibleIds.has(edge.source) || !visibleIds.has(edge.target),
          className: [
            edge.className,
            isConnected ? 'edge-connected' : undefined,
            isSelectedEdge ? 'edge-selected' : undefined,
            isDimmed ? 'edge-dimmed' : undefined,
          ]
            .filter(Boolean)
            .join(' '),
        };
      }),
    [selectedEdgeId, selectedNeighborhood, useSmartRouting, visibleIds],
  );

  const onNodesChange = (changes: NodeChange<GnmiFlowNode>[]) => {
    setFlowNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as GnmiFlowNode[]);
  };

  const onNodeClick: NodeMouseHandler = (_, node) => {
    setSelectedEdgeId(null);
    setSelectedNodeId(node.id);
  };

  const onEdgeClick: EdgeMouseHandler = (_, edge) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  };

  const onNodeDragStart: OnNodeDrag<GnmiFlowNode> = () => {
    setUseSmartRouting(false);
  };

  const copyPositions = async () => {
    try {
      await navigator.clipboard.writeText(getPositionsYaml(flowNodes));
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 1800);
    } catch {
      setCopyStatus('failed');
      window.setTimeout(() => setCopyStatus('idle'), 2400);
    }
  };

  const onPaneClick = () => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  return (
    <main className="app-shell" data-theme={themeMode}>
      <Paper component="header" className="top-bar" elevation={0} square>
        <Box>
          <Typography
            component="p"
            variant="overline"
            color="text.secondary"
            sx={{ display: 'block', fontWeight: 700, lineHeight: 1.2 }}
          >
            OpenConfig proto map
          </Typography>
          <Typography component="h1" variant="h4">
            service gNMI 0.7.0
          </Typography>
        </Box>
        <TextField
          className="top-bar__search"
          label="Search map"
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try SubscribeRequest, Path, Encoding..."
          fullWidth
        />
        <Button
          className="top-bar__button"
          type="button"
          variant="contained"
          color="primary"
          onClick={copyPositions}
        >
          {copyStatus === 'copied'
            ? 'Copied'
            : copyStatus === 'failed'
              ? 'Copy failed'
              : 'Copy positions'}
        </Button>
        <FormControlLabel
          className="top-bar__theme-toggle"
          control={<Switch checked={themeMode === 'dark'} onChange={onThemeToggle} color="primary" />}
          label={themeMode === 'dark' ? 'Mocha' : 'Latte'}
        />
      </Paper>
      <section className="map-card" aria-label="gNMI 0.7.0 React Flow map">
        <ReactFlow
          nodes={nodes}
          edges={edges as Edge[]}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.18}
          maxZoom={1.7}
          snapToGrid
          snapGrid={[20, 20]}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onNodeDragStart={onNodeDragStart}
          onPaneClick={onPaneClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Controls position="bottom-right" />

          <Panel position="bottom-center" className="credit-panel">
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                Created from Roman Dodin&apos;s gNMI map.
              </Typography>
              <Link href={sourceLinks.project} target="_blank" rel="noreferrer" underline="hover">
                Source PDF
              </Link>
              <Link href={sourceLinks.author} target="_blank" rel="noreferrer" underline="hover">
                Author
              </Link>
              <Link href={sourceLinks.social} target="_blank" rel="noreferrer" underline="hover">
                Twitter
              </Link>
            </Box>
          </Panel>
        </ReactFlow>
      </section>
    </main>
  );
}

function App() {
  const userSelectedTheme = useRef(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getSystemTheme());
  const muiTheme = useMemo(() => createCatppuccinTheme(themeMode), [themeMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (!userSelectedTheme.current) {
        setThemeMode(event.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  const toggleTheme = () => {
    userSelectedTheme.current = true;
    setThemeMode((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <ReactFlowProvider>
        <GnmiMap themeMode={themeMode} onThemeToggle={toggleTheme} />
      </ReactFlowProvider>
    </ThemeProvider>
  );
}

export default App;
