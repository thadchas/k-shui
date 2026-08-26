import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
import { Workflow } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import type { FlinkJobDetailFull, FlinkVertexDetail } from '@/api/types';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { flinkStateTone, ratioPct, shortVertexName } from '../flinkLib';
import { VertexPanel } from './VertexPanel';

const TONE_COLOR: Record<string, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  muted: 'var(--muted)',
};

const WIDTH = 264;
const HEIGHT = 96;

type VertexNodeData = {
  vertex: FlinkVertexDetail;
  selected: boolean;
};

type VertexFlowNode = Node<VertexNodeData, 'vertex'>;

function VertexNodeImpl({ data }: NodeProps<VertexFlowNode>) {
  const { vertex, selected } = data;
  const color = TONE_COLOR[flinkStateTone(vertex.status)];
  const busy = ratioPct(vertex.metrics?.accumulatedBusyTime, vertex.duration);
  const bp = ratioPct(vertex.metrics?.accumulatedBackpressuredTime, vertex.duration);

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-[var(--radius-card)] border bg-[var(--surface)] p-3 shadow-[var(--shadow-card)]',
        selected
          ? 'border-[var(--primary)] ring-2 ring-[color-mix(in_srgb,var(--primary)_35%,transparent)]'
          : 'border-[var(--border)] hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))]',
      )}
      style={{ width: WIDTH, height: HEIGHT }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1.5 !border-0 !bg-[var(--muted)]"
      />
      <div className="flex items-start gap-2">
        <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: color }} />
        <p
          className="line-clamp-2 min-w-0 text-2xs font-semibold leading-4 text-[var(--foreground)]"
          title={vertex.name}
        >
          {shortVertexName(vertex.name, 70)}
        </p>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
        <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 font-mono">
          ×{vertex.parallelism}
        </span>
        <span style={{ color }}>{vertex.status.toLowerCase()}</span>
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-[var(--muted)]">
        <span>in {formatCompact(vertex.metrics?.readRecords)}</span>
        <span>out {formatCompact(vertex.metrics?.writeRecords)}</span>
      </div>
      <div className="flex gap-1">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <span
            className="block h-full rounded-full bg-[var(--primary)]"
            style={{ width: `${busy ?? 0}%` }}
            title={`busy ${(busy ?? 0).toFixed(1)}%`}
          />
        </span>
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
          <span
            className="block h-full rounded-full bg-[var(--danger)]"
            style={{ width: `${bp ?? 0}%` }}
            title={`backpressure ${(bp ?? 0).toFixed(1)}%`}
          />
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-1.5 !border-0 !bg-[var(--muted)]"
      />
    </div>
  );
}

const VertexNode = memo(VertexNodeImpl);
VertexNode.displayName = 'VertexNode';

const nodeTypes: NodeTypes = { vertex: VertexNode };

function buildGraph(job: FlinkJobDetailFull, selectedId: string | null) {
  const vertices = job.vertices ?? [];
  const byId = new Map(vertices.map((v) => [v.id, v]));
  const planNodes = job.plan?.nodes ?? [];

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 140, marginx: 20, marginy: 20 });
  for (const v of vertices) g.setNode(v.id, { width: WIDTH, height: HEIGHT });

  const edges: Edge[] = [];
  for (const pn of planNodes) {
    for (const input of pn.inputs ?? []) {
      if (!byId.has(input.id) || !byId.has(pn.id)) continue;
      g.setEdge(input.id, pn.id);
      const ship = input.shipStrategy ?? input.ship_strategy ?? '';
      edges.push({
        id: `${input.id}->${pn.id}`,
        source: input.id,
        target: pn.id,
        type: 'smoothstep',
        animated: byId.get(input.id)?.status === 'RUNNING',
        label: ship || undefined,
        labelStyle: { fontSize: 10, fill: 'var(--muted)' },
        labelBgStyle: { fill: 'var(--surface)' },
        labelBgPadding: [4, 2],
        style: { stroke: 'var(--muted)', strokeWidth: 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: 'var(--muted)',
        },
      });
    }
  }
  dagre.layout(g);

  const nodes: VertexFlowNode[] = vertices.map((v) => {
    const pos = g.node(v.id) as { x: number; y: number } | undefined;
    return {
      id: v.id,
      type: 'vertex',
      position: { x: (pos?.x ?? 0) - WIDTH / 2, y: (pos?.y ?? 0) - HEIGHT / 2 },
      data: { vertex: v, selected: selectedId === v.id },
      width: WIDTH,
      height: HEIGHT,
    };
  });

  return { nodes, edges };
}

function GraphInner({
  job,
  selectedId,
  onSelect,
}: {
  job: FlinkJobDetailFull;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const laid = useMemo(() => buildGraph(job, selectedId), [job, selectedId]);
  const [nodes, setNodes, onNodesChange] = useNodesState<VertexFlowNode>(laid.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(laid.edges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [laid, setNodes, setEdges]);

  useEffect(() => {
    const t = setTimeout(() => void fitView({ padding: 0.2, duration: 200 }), 60);
    return () => clearTimeout(t);
  }, [fitView, laid.nodes.length]);

  const handleClick = useCallback(
    (_e: React.MouseEvent, node: VertexFlowNode) => onSelect(node.id),
    [onSelect],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={handleClick}
      onPaneClick={() => onSelect(null)}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={2}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border)" />
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap
        pannable
        zoomable
        position="bottom-left"
        maskColor="color-mix(in srgb, var(--background) 70%, transparent)"
        className="!rounded-[var(--radius-control)] !border !border-[var(--border)] !bg-[var(--surface)]"
        nodeColor={(n) =>
          TONE_COLOR[flinkStateTone((n as VertexFlowNode).data?.vertex?.status)] ?? 'var(--muted)'
        }
      />
    </ReactFlow>
  );
}

export interface JobGraphTabProps {
  cluster: string;
  flinkCluster: string;
  job: FlinkJobDetailFull | undefined;
}

export function JobGraphTab({ cluster, flinkCluster, job }: JobGraphTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!job || (job.vertices?.length ?? 0) === 0) {
    return (
      <Card>
        <EmptyState
          icon={Workflow}
          title="No job graph"
          description="This job does not expose an execution plan yet."
        />
      </Card>
    );
  }

  const selected = job.vertices.find((v) => v.id === selectedId) ?? null;
  const description = job.plan?.nodes?.find((n) => n.id === selectedId)?.description ?? null;

  return (
    <>
      <div className="h-[calc(100vh-360px)] min-h-[420px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface-2)]">
        <ReactFlowProvider>
          <GraphInner job={job} selectedId={selectedId} onSelect={setSelectedId} />
        </ReactFlowProvider>
      </div>
      <p className="mt-2 text-2xs text-[var(--muted)]">
        Click a vertex for subtasks, backpressure and watermarks. Edge labels show the ship
        strategy.
      </p>
      <VertexPanel
        cluster={cluster}
        flinkCluster={flinkCluster}
        jid={job.jid}
        vertex={selected}
        description={description}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </>
  );
}
