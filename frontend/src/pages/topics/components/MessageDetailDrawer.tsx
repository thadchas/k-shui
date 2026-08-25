import { useState } from 'react';
import type { Message } from '@/api/types';
import { formatBytes } from '@/lib/format';
import { Crosshair } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { JsonViewer } from '@/components/ui/json-viewer';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { SegmentedList, SegmentedTrigger, Tabs } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  formatMessageTimestamp,
  isTombstone,
  keyFilterValue,
  type TimestampFormat,
} from './messageUtils';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="truncate font-mono text-[13px] tabular-nums">{value}</p>
    </div>
  );
}

export interface MessageDetailDrawerProps {
  message: Message | null;
  onOpenChange: (open: boolean) => void;
  timestampFormat?: TimestampFormat;
  /** Offered when set: scope the browser's filter to this record's exact key. */
  onFollowKey?: (key: string) => void;
}

export function MessageDetailDrawer({
  message,
  onOpenChange,
  timestampFormat = 'local',
  onFollowKey,
}: MessageDetailDrawerProps) {
  const [view, setView] = useState<'parsed' | 'raw'>('parsed');
  if (!message) return null;

  const headerEntries = Object.entries(message.headers ?? {});
  const rawKey =
    message.keyRaw ?? (typeof message.key === 'string' ? message.key : JSON.stringify(message.key));
  const rawValue =
    message.valueRaw ??
    (typeof message.value === 'string' ? message.value : JSON.stringify(message.value, null, 2));
  const tombstone = isTombstone(message);

  return (
    <Sheet open={Boolean(message)} onOpenChange={onOpenChange}>
      <SheetContent size="md" className="sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Partition {message.partition} · offset {message.offset}
            {tombstone ? (
              <Badge variant="warning" size="sm">
                tombstone
              </Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>
            {formatMessageTimestamp(message.timestamp, timestampFormat)}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Partition" value={message.partition} />
            <Field label="Offset" value={message.offset} />
            <Field label="Size" value={formatBytes(message.sizeBytes)} />
            <Field label="Timestamp type" value={message.timestampType ?? '—'} />
            <Field label="Key format" value={message.keyFormat ?? '—'} />
            <Field label="Value format" value={message.valueFormat ?? '—'} />
          </div>

          {message.keySchemaId || message.valueSchemaId ? (
            <div className="flex flex-wrap gap-2">
              {message.keySchemaId ? (
                <Badge variant="accent">key schema #{message.keySchemaId}</Badge>
              ) : null}
              {message.valueSchemaId ? (
                <Badge variant="accent">value schema #{message.valueSchemaId}</Badge>
              ) : null}
            </div>
          ) : null}

          <Tabs value={view} onValueChange={(v) => setView(v as 'parsed' | 'raw')}>
            <SegmentedList>
              <SegmentedTrigger value="parsed">Parsed</SegmentedTrigger>
              <SegmentedTrigger value="raw">Raw</SegmentedTrigger>
            </SegmentedList>
          </Tabs>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Key
              </h3>
              <div className="flex items-center gap-1">
                {onFollowKey && message.key !== null && message.key !== undefined ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onFollowKey(keyFilterValue(message.key));
                      onOpenChange(false);
                    }}
                  >
                    <Crosshair /> Follow key
                  </Button>
                ) : null}
                <CopyButton value={rawKey ?? ''} />
              </div>
            </div>
            {message.key === null || message.key === undefined ? (
              <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                null key
              </p>
            ) : view === 'raw' ? (
              <pre className="max-h-48 overflow-auto rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-[13px] break-all whitespace-pre-wrap">
                {rawKey}
              </pre>
            ) : (
              <JsonViewer value={message.key} maxHeight={200} defaultExpandedDepth={2} />
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Value
              </h3>
              <CopyButton value={rawValue ?? ''} />
            </div>
            {tombstone ? (
              <p className="rounded-[var(--radius-control)] border border-dashed border-[color-mix(in_srgb,var(--warning)_50%,transparent)] px-3 py-2 text-xs text-[var(--muted)]">
                Null value — this is a <strong>tombstone</strong>. On a compacted topic it marks the
                key for deletion once compaction runs.
              </p>
            ) : view === 'raw' ? (
              <pre className="max-h-96 overflow-auto rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] p-3 font-mono text-[13px] break-all whitespace-pre-wrap">
                {rawValue}
              </pre>
            ) : (
              <JsonViewer value={message.value} maxHeight={400} defaultExpandedDepth={3} />
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Headers ({headerEntries.length})
            </h3>
            {headerEntries.length === 0 ? (
              <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
                No headers
              </p>
            ) : (
              <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Key</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {headerEntries.map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell className="font-mono text-[13px] break-all">{k}</TableCell>
                        <TableCell className="font-mono text-[13px] break-all">{v}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
