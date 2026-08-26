import { memo, useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import dagre from 'dagre';
import {
  ArrowUpRight as ArrowUpRightIcon,
  Cable,
  Database,
  FileCode2,
  FileJson,
  GitBranch as GitBranchIcon,
  Layers,
  Send,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useLineageGraphFull } from '@/api/hooks/lineage';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import '@xyflow/react/dist/style.css';
import type { LineageEdge, LineageNodeFull } from '@/api/types';
import { cn } from '@/lib/utils';
import { statusTone, type StatusTone } from '@/components/ui/status-pill';

/* ------------------------------ node taxonomy ----------------------------- */

export interface LineageTypeStyle {
  label: string;
  icon: LucideIcon;
  color: string;
}

/** Chart-palette colours only — never purple (DESIGN.md). */
export const LINEAGE_TYPES: Record<string, LineageTypeStyle> = {
  topic: { label: 'Topic', icon: Layers, color: '#14B8A6' },
  connector: { label: 'Connector', icon: Cable, color: '#0EA5E9' },
  flinkJob: { label: 'Flink job', icon: Workflow, color: '#F59E0B' },
  ksqlQuery: { label: 'ksqlDB query', icon: Zap, color: '#22C55E' },
  consumerGroup: { label: 'Consumer group', icon: Users, color: '#3B82F6' },
  producer: { label: 'Producer', icon: Send, color: '#F97316' },
  dataset: { label: 'Dataset', icon: Database, color: '#06B6D4' },
  job: { label: 'Job', icon: FileCode2, color: '#A3E635' },
  schema: { label: 'Schema', icon: FileJson, color: '#EAB308' },
};

export function lineageTypeStyle(type: string): LineageTypeStyle {
  return LINEAGE_TYPES[type] ?? { label: type, icon: Database, color: '#64748B' };
}

const TONE_DOT: Record<StatusTone, string> = {
  success: 'bg-[var(--success)]',
  warning: 'bg-[var(--warning)]',
  danger: 'bg-[var(--danger)]',
  info: 'bg-[var(--info)]',
  muted: 'bg-[var(--muted)]',
};

/* -------------------------------- node card ------------------------------- */

type LineageNodeData = {
  node: LineageNodeFull;
  focused: boolean;
  selected: boolean;
  compact: boolean;
};

type LineageFlowNode = Node<LineageNodeData, 'lineage'>;

const NODE_WIDTH = 232;
const NODE_HEIGHT = 68;
const COMPACT_WIDTH = 196;
const COMPACT_HEIGHT = 56;

function LineageNodeCardImpl({ data }: NodeProps<LineageFlowNode>) {
  const { node, focused, selected, compact } = data;
  const style = lineageTypeStyle(node.type);
  const Icon = style.icon;
  const tone = statusTone(node.status);

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-[var(--radius-card)] border bg-[var(--surface)] px-3 shadow-[var(--shadow-card)] transition-colors',
        compact ? 'h-14 w-[196px]' : 'h-[68px] w-[232px]',
        selected || focused
          ? 'border-[var(--primary)] ring-2 ring-[color-mix(in_srgb,var(--primary)_35%,transparent)]'
          : 'border-[var(--border)] hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-[var(--muted)]"
      />
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-[8px]"
        style={{ background: `color-mix(in srgb, ${style.color} 16%, transparent)` }}
      >
        <Icon className="size-4" style={{ color: style.color }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-xs font-semibold text-[var(--foreground)]" title={node.label}>
            {node.label}
          </p>
          {node.status ? (
            <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span
            className="truncate rounded-full px-1.5 text-[10px] font-medium leading-4"
            style={{
              background: `color-mix(in srgb, ${style.color} 14%, transparent)`,
              color: style.color,
            }}
          >
            {style.label}
          </span>
          {!compact && node.namespace ? (
            <span className="truncate text-[10px] text-[var(--muted)]" title={node.namespace}>
              {node.namespace}
            </span>
          ) : null}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-1.5 !border-0 !bg-[var(--muted)]"
      />
    </div>
  );
}

export const LineageNodeCard = memo(LineageNodeCardImpl);
LineageNodeCard.displayName = 'LineageNodeCard';

const nodeTypes: NodeTypes = { lineage: LineageNodeCard };

/* --------------------------------- layout --------------------------------- */

const ACTIVE = /^(running|stable|active|online|up)$/i;

export function layoutLineage(
  nodes: LineageNodeFull[],
  edges: LineageEdge[],
  options: { focus?: string | null; selected?: string | null; compact?: boolean } = {},
): { nodes: LineageFlowNode[]; edges: Edge[] } {
  const compact = options.compact ?? false;
  const width = compact ? COMPACT_WIDTH : NODE_WIDTH;
  const height = compact ? COMPACT_HEIGHT : NODE_HEIGHT;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    nodesep: compact ? 24 : 36,
    ranksep: compact ? 80 : 130,
    marginx: 16,
    marginy: 16,
  });

  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, { width, height });
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  for (const e of valid) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const byId = new Map(nodes.map((n) => [n.id, n]));

  const flowNodes: LineageFlowNode[] = nodes.map((n) => {
    const pos = g.node(n.id) as { x: number; y: number } | undefined;
    return {
      id: n.id,
      type: 'lineage',
      position: { x: (pos?.x ?? 0) - width / 2, y: (pos?.y ?? 0) - height / 2 },
      data: {
        node: n,
        focused: options.focus === n.id,
        selected: options.selected === n.id,
        compact,
      },
      draggable: true,
      width,
      height,
    };
  });

  const flowEdges: Edge[] = valid.map((e) => {
    const source = byId.get(e.source);
    const active = ACTIVE.test(source?.status ?? '') || source?.type === 'topic';
    const color =
      e.kind === 'transforms' ? '#F59E0B' : e.kind === 'consumes' ? '#0EA5E9' : 'var(--muted)';
    const shipStrategy =
      typeof e.meta?.shipStrategy === 'string' ? (e.meta.shipStrategy as string) : null;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: active,
      label: shipStrategy ?? undefined,
      labelStyle: { fontSize: 10, fill: 'var(--muted)' },
      labelBgStyle: { fill: 'var(--surface)' },
      style: { stroke: color, strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

/* --------------------------------- canvas --------------------------------- */

export interface LineageGraphCanvasProps {
  nodes: LineageNodeFull[];
  edges: LineageEdge[];
  focus?: string | null;
  selectedId?: string | null;
  onSelect?: (node: LineageNodeFull | null) => void;
  className?: string;
  compact?: boolean;
  showMiniMap?: boolean;
  showControls?: boolean;
  fitViewKey?: string;
}

function LineageGraphInner({
  nodes,
  edges,
  focus,
  selectedId,
  onSelect,
  className,
  compact = false,
  showMiniMap = true,
  showControls = true,
  fitViewKey,
}: LineageGraphCanvasProps) {
  const laid = useMemo(
    () => layoutLineage(nodes, edges, { focus, selected: selectedId, compact }),
    [nodes, edges, focus, selectedId, compact],
  );

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<LineageFlowNode>(laid.nodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>(laid.edges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setFlowNodes(laid.nodes);
    setFlowEdges(laid.edges);
  }, [laid, setFlowNodes, setFlowEdges]);

  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.15, duration: 250 }), 60);
    return () => clearTimeout(t);
  }, [fitView, fitViewKey, laid.nodes.length]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: LineageFlowNode) => onSelect?.(node.data.node),
    [onSelect],
  );

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      onPaneClick={() => onSelect?.(null)}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.15}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      elementsSelectable
      className={className}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border)" />
      {showControls ? <Controls showInteractive={false} position="bottom-right" /> : null}
      {showMiniMap ? (
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          maskColor="color-mix(in srgb, var(--background) 70%, transparent)"
          className="!rounded-[var(--radius-control)] !border !border-[var(--border)] !bg-[var(--surface)]"
          nodeColor={(n) =>
            lineageTypeStyle((n as LineageFlowNode).data?.node?.type ?? 'dataset').color
          }
        />
      ) : null}
    </ReactFlow>
  );
}

/** Full lineage canvas. Wrap-free: the provider is included. */
export function LineageGraphCanvas(props: LineageGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <LineageGraphInner {...props} />
    </ReactFlowProvider>
  );
}

/* -------------------------------- mini graph ------------------------------ */

export interface LineageMiniGraphProps {
  nodes: LineageNodeFull[];
  edges: LineageEdge[];
  focus?: string | null;
  height?: number;
  className?: string;
  onSelect?: (node: LineageNodeFull | null) => void;
}

/** Embedded, read-mostly lineage preview (topic detail page, side panels). */
export function LineageMiniGraph({
  nodes,
  edges,
  focus,
  height = 320,
  className,
  onSelect,
}: LineageMiniGraphProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)]',
        className,
      )}
      style={{ height }}
    >
      <LineageGraphCanvas
        nodes={nodes}
        edges={edges}
        focus={focus}
        onSelect={onSelect}
        compact
        showMiniMap={false}
        showControls={false}
      />
    </div>
  );
}

/* --------------------------- topic lineage preview ------------------------ */

/**
 * Self-contained lineage preview for a single topic — used by the topic detail
 * page's "Lineage" tab. Fetches a shallow, topic-focused graph.
 */
export function LineageTopicPreview({
  cluster,
  topic,
  depth = 2,
  height = 340,
}: {
  cluster: string;
  topic: string;
  depth?: number;
  height?: number;
}) {
  const focus = `topic:${cluster}:${topic}`;
  const { data, isLoading, error, refetch } = useLineageGraphFull(cluster, { focus, depth });
  const navigate = useNavigate();

  const lineagePath = `/c/${cluster}/lineage?focus=${encodeURIComponent(focus)}`;

  if (isLoading) return <Skeleton style={{ height }} className="w-full" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} compact />;

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];

  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={GitBranchIcon}
        title="No lineage for this topic"
        description="Nothing produces to or consumes from this topic according to Marquez, Connect, Flink, ksqlDB or consumer groups."
        action={
          <Button asChild variant="outline">
            <Link to={lineagePath}>Open lineage canvas</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">
          {nodes.length} connected nodes · {edges.length} edges (depth {depth})
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to={lineagePath}>
            Open lineage canvas <ArrowUpRightIcon className="size-3.5" />
          </Link>
        </Button>
      </div>
      <LineageMiniGraph
        nodes={nodes}
        edges={edges}
        focus={focus}
        height={height}
        onSelect={(node) => {
          if (node && node.id !== focus) {
            void navigate(`/c/${cluster}/lineage?focus=${encodeURIComponent(node.id)}`);
          }
        }}
      />
    </div>
  );
}
