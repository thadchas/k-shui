import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DashboardPanelSpec } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PANEL_TYPES, PANEL_UNITS, panelGeometry } from '../panelUtils';

export interface PanelEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: DashboardPanelSpec | null;
  /** Metric names offered as PromQL autocomplete hints. */
  suggestions?: string[];
  onSave: (panel: DashboardPanelSpec) => void;
}

const BLANK: DashboardPanelSpec = {
  id: '',
  title: '',
  type: 'timeseries',
  unit: 'short',
  queries: [{ expr: '', legend: '' }],
};

export function PanelEditor({ open, onOpenChange, panel, suggestions, onSave }: PanelEditorProps) {
  const [draft, setDraft] = useState<DashboardPanelSpec>(BLANK);

  useEffect(() => {
    if (!open) return;
    const base = panel ?? BLANK;
    const geo = panelGeometry(base);
    setDraft({
      ...base,
      queries: base.queries?.length
        ? base.queries.map((q) => ({ ...q }))
        : [{ expr: '', legend: '' }],
      w: base.w ?? geo.w,
      h: base.h ?? geo.h,
    });
  }, [open, panel]);

  const setQuery = (index: number, patch: Partial<{ expr: string; legend: string }>) =>
    setDraft((d) => ({
      ...d,
      queries: d.queries.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    }));

  const valid = draft.title.trim().length > 0 && draft.queries.some((q) => q.expr.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{panel ? 'Edit panel' : 'Add panel'}</DialogTitle>
          <DialogDescription>
            Panels are evaluated server-side against Prometheus with the dashboard time range.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="panel-title">Title</Label>
              <Input
                id="panel-title"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Bytes in / sec"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="panel-type">Visualization</Label>
              <SimpleSelect
                value={String(draft.type)}
                onValueChange={(v) => setDraft((d) => ({ ...d, type: v }))}
                options={PANEL_TYPES}
                aria-label="Panel type"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="panel-unit">Unit</Label>
              <SimpleSelect
                value={draft.unit || 'short'}
                onValueChange={(v) => setDraft((d) => ({ ...d, unit: v }))}
                options={PANEL_UNITS}
                aria-label="Panel unit"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="panel-w">Width (of 12)</Label>
              <Input
                id="panel-w"
                type="number"
                min={1}
                max={12}
                value={draft.w ?? 6}
                onChange={(e) => setDraft((d) => ({ ...d, w: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="panel-h">Height (px)</Label>
              <Input
                id="panel-h"
                type="number"
                min={80}
                step={20}
                value={draft.h ?? 260}
                onChange={(e) => setDraft((d) => ({ ...d, h: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Queries</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setDraft((d) => ({ ...d, queries: [...d.queries, { expr: '', legend: '' }] }))
                }
              >
                <Plus /> Add query
              </Button>
            </div>

            {draft.queries.map((q, i) => (
              <div
                key={i}
                className="space-y-2 rounded-[var(--radius-control)] border border-[var(--border)] p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Query {String.fromCharCode(65 + i)}
                  </span>
                  {draft.queries.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove query"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          queries: d.queries.filter((_, j) => j !== i),
                        }))
                      }
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  value={q.expr}
                  onChange={(e) => setQuery(i, { expr: e.target.value })}
                  placeholder="sum(rate(kafka_server_brokertopicmetrics_bytesin_total[5m]))"
                  rows={3}
                  className="font-mono text-xs"
                />
                {suggestions && suggestions.length > 0 ? (
                  <Combobox
                    className="w-full"
                    options={suggestions.slice(0, 800).map((s) => ({ label: s, value: s }))}
                    value={null}
                    onValueChange={(v) =>
                      v && setQuery(i, { expr: `${q.expr}${q.expr ? '' : ''}${v}` })
                    }
                    placeholder="Insert metric name…"
                    searchPlaceholder="Search metric catalog…"
                    emptyText="No metrics"
                  />
                ) : null}
                <Input
                  value={q.legend ?? ''}
                  onChange={(e) => setQuery(i, { legend: e.target.value })}
                  placeholder="Legend (supports {{label}})"
                  className="h-8 font-mono text-xs"
                />
              </div>
            ))}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              onSave({
                ...draft,
                title: draft.title.trim(),
                queries: draft.queries.filter((q) => q.expr.trim()),
              })
            }
          >
            {panel ? 'Save panel' : 'Add panel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
