import { Plus, Trash2 } from 'lucide-react';
import type { SchemaReference } from '@/api/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface SchemaReferencesEditorProps {
  value: SchemaReference[];
  onChange: (references: SchemaReference[]) => void;
  subjectOptions?: string[];
  disabled?: boolean;
}

/** Editor for the `references` array sent with a schema registration. */
export function SchemaReferencesEditor({
  value,
  onChange,
  subjectOptions,
  disabled,
}: SchemaReferencesEditorProps) {
  const update = (index: number, patch: Partial<SchemaReference>) =>
    onChange(value.map((ref, i) => (i === index ? { ...ref, ...patch } : ref)));

  return (
    <div className="space-y-2">
      {subjectOptions?.length ? (
        <datalist id="schema-reference-subjects">
          {subjectOptions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}

      {value.length === 0 ? (
        <p className="text-2xs text-[var(--muted)]">
          No references. Add one to reuse a type defined in another subject (Avro named types,
          protobuf imports, JSON <span className="font-mono">$ref</span>).
        </p>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_88px_32px] gap-2 text-2xs uppercase tracking-wide text-[var(--muted)]">
            <span>Name</span>
            <span>Subject</span>
            <span>Version</span>
            <span className="sr-only">Remove</span>
          </div>
          {value.map((ref, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_88px_32px] items-center gap-2">
              <Input
                mono
                disabled={disabled}
                value={ref.name}
                placeholder="com.example.Address"
                aria-label={`Reference ${index + 1} name`}
                onChange={(e) => update(index, { name: e.target.value })}
              />
              <Input
                mono
                disabled={disabled}
                list={subjectOptions?.length ? 'schema-reference-subjects' : undefined}
                value={ref.subject}
                placeholder="address-value"
                aria-label={`Reference ${index + 1} subject`}
                onChange={(e) => update(index, { subject: e.target.value })}
              />
              <Input
                mono
                type="number"
                min={1}
                disabled={disabled}
                value={ref.version}
                aria-label={`Reference ${index + 1} version`}
                onChange={(e) => update(index, { version: Number(e.target.value) })}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={`Remove reference ${index + 1}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...value, { name: '', subject: '', version: 1 }])}
      >
        <Plus /> Add reference
      </Button>
    </div>
  );
}
