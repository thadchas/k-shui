import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ConfirmDestructiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** When set, the user must type this exact string to enable the action. */
  confirmText?: string;
  /** When set, renders a checkbox with this label that must be ticked to enable the action. */
  acknowledgeLabel?: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  /** Extra caller-side validity gate (e.g. a form inside `children` is invalid). */
  disabled?: boolean;
  /** Shown as the confirm button's tooltip while `disabled` is true. */
  disabledReason?: string;
  children?: React.ReactNode;
}

export function ConfirmDestructiveDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  acknowledgeLabel,
  confirmLabel = 'Delete',
  onConfirm,
  loading,
  disabled,
  disabledReason,
  children,
}: ConfirmDestructiveDialogProps) {
  const [typed, setTyped] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) {
      setTyped('');
      setAcknowledged(false);
    }
  }, [open]);

  const canConfirm =
    !disabled && (!confirmText || typed === confirmText) && (!acknowledgeLabel || acknowledged);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]">
              <AlertTriangle className="size-4 text-[var(--danger)]" />
            </span>
            <div className="space-y-1">
              <DialogTitle>{title}</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </div>
          </div>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {children}
          {confirmText ? (
            <div className="space-y-1.5">
              <Label htmlFor="confirm-input">
                Type <span className="font-mono text-[var(--foreground)]">{confirmText}</span> to
                confirm
              </Label>
              <Input
                id="confirm-input"
                mono
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmText}
              />
            </div>
          ) : null}
          {acknowledgeLabel ? (
            <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--foreground)]">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                className="mt-0.5"
              />
              <span>{acknowledgeLabel}</span>
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {/* Cancel stays enabled while the request runs so the user can abandon the intent. */}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm || loading}
            title={disabled && disabledReason ? disabledReason : undefined}
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
