import { Checkbox } from '@/components/ui/checkbox';

export interface InternalTopicAckProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** Extra explicit acknowledgement shown before mutating an internal Kafka topic. */
export function InternalTopicAck({ checked, onCheckedChange }: InternalTopicAckProps) {
  return (
    <label className="flex items-start gap-2 rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-xs">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-label="I understand this is an internal Kafka topic"
      />
      <span>
        <span className="font-medium text-[var(--danger)]">
          I understand this is an internal Kafka topic.
        </span>{' '}
        <span className="text-[var(--muted)]">
          Changing it can break consumer offsets, transactions or the cluster itself.
        </span>
      </span>
    </label>
  );
}

export function isCompacted(cleanupPolicy: string | null | undefined): boolean {
  return (cleanupPolicy ?? '').toLowerCase().includes('compact');
}
