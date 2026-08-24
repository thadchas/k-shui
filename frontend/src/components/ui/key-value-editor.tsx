import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Input } from './input';

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface KeyValueEditorProps {
  value: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  className?: string;
  disabled?: boolean;
  mono?: boolean;
  keySuggestions?: string[];
}

export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = 'name',
  valuePlaceholder = 'value',
  addLabel = 'Add entry',
  className,
  disabled,
  mono = true,
  keySuggestions,
}: KeyValueEditorProps) {
  const listId = React.useId();

  const update = (index: number, patch: Partial<KeyValuePair>) => {
    onChange(value.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)));
  };

  return (
    <div className={cn('space-y-2', className)}>
      {keySuggestions?.length ? (
        <datalist id={listId}>
          {keySuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}

      {value.length === 0 ? (
        <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--border)] px-3 py-3 text-center text-xs text-[var(--muted)]">
          No entries
        </p>
      ) : null}

      {value.map((pair, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={pair.key}
            onChange={(e) => update(index, { key: e.target.value })}
            placeholder={keyPlaceholder}
            mono={mono}
            disabled={disabled}
            list={keySuggestions?.length ? listId : undefined}
            className="flex-1"
            aria-label={`${keyPlaceholder} ${index + 1}`}
          />
          <Input
            value={pair.value}
            onChange={(e) => update(index, { value: e.target.value })}
            placeholder={valuePlaceholder}
            mono={mono}
            disabled={disabled}
            className="flex-1"
            aria-label={`${valuePlaceholder} ${index + 1}`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            aria-label="Remove entry"
            className="text-[var(--muted)] hover:text-[var(--danger)]"
          >
            <Trash2 />
          </Button>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...value, { key: '', value: '' }])}
      >
        <Plus /> {addLabel}
      </Button>
    </div>
  );
}

export function pairsToRecord(pairs: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const k = key.trim();
    if (k) out[k] = value;
  }
  return out;
}

export function recordToPairs(record: Record<string, string> | undefined | null): KeyValuePair[] {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => ({ key, value: String(value ?? '') }));
}
