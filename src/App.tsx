import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dagre from '@dagrejs/dagre';
import { SmartStepEdge } from '@jalez/react-flow-smart-edge';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
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

const POSITIONS_FILE_URL = '/positions.json';
const AUTO_LAYOUT_CONFIG = {
  rankdir: 'LR',
  nodesep: 120,
  ranksep: 260,
  marginx: 120,
  marginy: 120,
};

type NodePosition = {
  x: number;
  y: number;
};

type PositionsFile = {
  nodes?: Record<string, NodePosition>;
  positions?: Record<string, NodePosition>;
};

type VisibleHandles = NonNullable<GnmiNodeData['visibleHandles']>;

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
    width: node.data.kind === 'service' ? 300 : node.data.kind === 'enum' || node.data.kind === 'oneof' ? 230 : 260,
    height: baseHeight + rowCount * rowHeight + noteHeight,
  };
}

function downloadPositions(nodes: GnmiFlowNode[]) {
  const positions = Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      },
    ]),
  );

  const payload = JSON.stringify({ nodes: positions }, null, 2);
  const blob = new Blob([`${payload}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'positions.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function GnmiMap() {
  const [query, setQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [useSmartRouting, setUseSmartRouting] = useState(true);
  const [flowNodes, setFlowNodes] = useState<GnmiFlowNode[]>(gnmiNodes);
  const [positionsStatus, setPositionsStatus] = useState<'checking' | 'loaded' | 'missing' | 'invalid'>(
    'checking',
  );
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

        return response.json();
      })
      .then((payload: unknown) => {
        if (!isMounted) {
          return;
        }

        if (!payload) {
          setPositionsStatus('missing');
          return;
        }

        const positions = getPositions(payload);

        if (Object.keys(positions).length === 0) {
          setPositionsStatus('invalid');
          return;
        }

        setFlowNodes((nodes) => applyPositions(nodes, positions));
        setPositionsStatus('loaded');
      })
      .catch(() => {
        if (isMounted) {
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
  }, [selectedNodeId]);

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
        const isConnected = Boolean(selectedNeighborhood?.edgeIds.has(edge.id));
        const isDimmed = Boolean(selectedNeighborhood && !selectedNeighborhood.edgeIds.has(edge.id));

        return {
          ...edge,
          ...edgeDefaults,
          type: useSmartRouting ? edge.type : 'smoothstep',
          hidden: !visibleIds.has(edge.source) || !visibleIds.has(edge.target),
          className: [
            edge.className,
            isConnected ? 'edge-connected' : undefined,
            isDimmed ? 'edge-dimmed' : undefined,
          ]
            .filter(Boolean)
            .join(' '),
        };
      }),
    [selectedNeighborhood, useSmartRouting, visibleIds],
  );

  const onNodesChange = (changes: NodeChange<GnmiFlowNode>[]) => {
    setFlowNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as GnmiFlowNode[]);
  };

  const onNodeClick: NodeMouseHandler = (_, node) => {
    setSelectedNodeId(node.id);
  };

  const onNodeDragStart: OnNodeDrag<GnmiFlowNode> = () => {
    setUseSmartRouting(false);
  };

  const onAutoLayoutClick = () => {
    setUseSmartRouting(false);
    runAutoLayout();
  };

  const onPaneClick = () => setSelectedNodeId(null);

  return (
    <main className="app-shell">
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
          snapGrid={[10, 10]}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onNodeDragStart={onNodeDragStart}
          onPaneClick={onPaneClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Controls position="bottom-right" />
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            nodeColor={(node: Node<GnmiNodeData>) => {
              switch (node.data.kind) {
                case 'service':
                  return '#0f766e';
                case 'rpc':
                  return '#2563eb';
                case 'enum':
                  return '#7c3aed';
                case 'extension':
                  return '#c2410c';
                case 'embedded':
                  return '#047857';
                case 'deprecated':
                  return '#9f1239';
                default:
                  return '#475569';
              }
            }}
          />

          <Panel position="top-left" className="intro-panel">
            <p className="eyebrow">OpenConfig proto map</p>
            <h1>gNMI 0.7.0</h1>
            <p>
              Interactive React Flow recreation of the PDF map. Select a node to highlight
              relationships, drag cards to reposition them, or search by message, field, enum,
              doc link, or proto path.
            </p>
            <label className="search-box">
              <span>Search map</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Try SubscribeRequest, Path, Encoding..."
              />
            </label>
            <div className="positions-actions">
              <button type="button" onClick={onAutoLayoutClick}>
                Auto layout
              </button>
              <button type="button" onClick={() => downloadPositions(flowNodes)}>
                Save positions.json
              </button>
              <p>
                {positionsStatus === 'loaded'
                  ? 'Loaded /positions.json for this layout.'
                  : positionsStatus === 'invalid'
                    ? 'Found /positions.json, but no valid node positions.'
                    : positionsStatus === 'checking'
                      ? 'Checking for /positions.json...'
                      : 'No /positions.json found; using built-in layout.'}
              </p>
            </div>
          </Panel>

          <Panel position="top-right" className="legend-panel">
            <h2>Legend</h2>
            <ul>
              <li>
                <span className="legend-dot legend-dot--docs" />
                `docs` opens the OpenConfig specification section.
              </li>
              <li>
                <span className="legend-dot legend-dot--proto" />
                Proto links open the source definition path and line.
              </li>
              <li>
                <span className="legend-dot legend-dot--embedded" />
                Green nodes are embedded protobuf types.
              </li>
              <li>
                <span className="legend-dot legend-dot--extension" />
                Arrows to gNMI extension fields are omitted, matching the PDF.
              </li>
            </ul>
          </Panel>

          <Panel position="bottom-center" className="credit-panel">
            <span>Created from Roman Dodin&apos;s gNMI map.</span>
            <a href={sourceLinks.project} target="_blank" rel="noreferrer">
              Source PDF
            </a>
            <a href={sourceLinks.author} target="_blank" rel="noreferrer">
              Author
            </a>
            <a href={sourceLinks.social} target="_blank" rel="noreferrer">
              Twitter
            </a>
          </Panel>
        </ReactFlow>
      </section>
    </main>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <GnmiMap />
    </ReactFlowProvider>
  );
}

export default App;
