import { useEffect, useState } from 'react';
import { Camera, OctagonX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

export type SavepointMode = 'trigger' | 'stop';

export interface SavepointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SavepointMode;
  jobName: string;
  defaultDirectory?: string;
  loading?: boolean;
  onSubmit: (values: { targetDirectory: string | null; drain: boolean }) => void;
}

export function SavepointDialog({
  open,
  onOpenChange,
  mode,
  jobName,
  defaultDirectory = '',
  loading,
  onSubmit,
}: SavepointDialogProps) {
  const [directory, setDirectory] = useState(defaultDirectory);
  const [drain, setDrain] = useState(false);
  const [drainAcknowledged, setDrainAcknowledged] = useState(false);

  useEffect(() => {
    if (open) {
      setDirectory(defaultDirectory);
      setDrain(false);
      setDrainAcknowledged(false);
    }
  }, [open, defaultDirectory]);

  const stopping = mode === 'stop';
  const canSubmit = !stopping || !drain || drainAcknowledged;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stopping ? <OctagonX className="size-4" /> : <Camera className="size-4" />}
            {stopping ? 'Stop with savepoint' : 'Trigger savepoint'}
          </DialogTitle>
          <DialogDescription>
            {stopping
              ? 'Takes a final savepoint and then stops the job gracefully.'
              : 'Takes a savepoint while the job keeps running.'}{' '}
            <span className="font-mono">{jobName}</span>
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="savepoint-dir">Target directory</Label>
            <Input
              id="savepoint-dir"
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              placeholder="s3://bucket/savepoints or file:///flink-data/savepoints"
              className="font-mono"
              autoFocus
            />
            <p className="text-2xs text-[var(--muted)]">
              Leave empty to use the cluster default (
              <span className="font-mono">state.savepoints.dir</span>).
            </p>
          </div>

          {stopping ? (
            <label className="flex items-start gap-2.5">
              <Checkbox
                checked={drain}
                onCheckedChange={(v) => {
                  setDrain(v === true);
                  if (v !== true) setDrainAcknowledged(false);
                }}
              />
              <span className="space-y-0.5">
                <span className="block text-xs font-medium text-[var(--foreground)]">
                  Drain (advance watermark to MAX_WATERMARK)
                </span>
                <span className="block text-2xs text-[var(--muted)]">
                  Flushes all pending windows. Use only when the job is being retired — the
                  savepoint cannot be used to resume normal processing afterwards.
                </span>
              </span>
            </label>
          ) : null}

          {stopping && drain ? (
            <label className="flex items-start gap-2.5 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2">
              <Checkbox
                checked={drainAcknowledged}
                onCheckedChange={(v) => setDrainAcknowledged(v === true)}
                aria-label="Acknowledge drain consequences"
              />
              <span className="text-xs text-[var(--foreground)]">
                I understand a drained savepoint cannot resume normal processing
              </span>
            </label>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={loading}
            disabled={!canSubmit}
            variant={stopping ? 'destructive' : 'default'}
            onClick={() => onSubmit({ targetDirectory: directory.trim() || null, drain })}
          >
            {stopping ? 'Stop job' : 'Trigger savepoint'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
