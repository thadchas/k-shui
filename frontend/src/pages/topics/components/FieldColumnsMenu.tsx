import { useState } from 'react';
import { Columns3, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { parseFieldPath } from './messageSearch';

export interface FieldColumnsMenuProps {
  /** Dot paths currently promoted to table columns. */
  columns: string[];
  onChange: (columns: string[]) => void;
  /** Paths discovered in the loaded messages, offered as one-click adds. */
  suggestions: string[];
}

/** Promote JSON payload fields to table columns so values are readable without opening a row. */
export function FieldColumnsMenu({ columns, onChange, suggestions }: FieldColumnsMenuProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const add = (path: string) => {
    const trimmed = path.trim();
    if (trimmed === '' || parseFieldPath(trimmed).length === 0) return;
    if (columns.includes(trimmed)) return;
    onChange([...columns, trimmed]);
  };

  const remove = (path: string) => onChange(columns.filter((c) => c !== path));

  const unused = suggestions.filter((s) => !columns.includes(s)).slice(0, 12);
  const draftInvalid = draft.trim() !== '' && parseFieldPath(draft).length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="JSON field columns">
          <Columns3 /> Field columns
          {columns.length > 0 ? (
            <Badge variant="info" size="sm">
              {columns.length}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="field-column-path">Add a JSON field path</Label>
            <div className="flex gap-2">
              <Input
                id="field-column-path"
                mono
                value={draft}
                invalid={draftInvalid}
                placeholder="order.items[0].sku"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    add(draft);
                    setDraft('');
                  }
                }}
              />
              <Button
                size="sm"
                disabled={draft.trim() === '' || draftInvalid}
                onClick={() => {
                  add(draft);
                  setDraft('');
                }}
              >
                <Plus /> Add
              </Button>
            </div>
            <p className="text-2xs text-[var(--muted)]">
              Dot paths into the decoded value, e.g. <code>order.status</code> or{' '}
              <code>items[0].sku</code>. Missing fields render as —.
            </p>
          </div>

          {columns.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Shown as columns
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {columns.map((path) => (
                  <li key={path}>
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] py-0.5 pr-1 pl-2 font-mono text-2xs">
                      {path}
                      <button
                        type="button"
                        className="rounded-full p-0.5 hover:bg-[var(--surface)]"
                        aria-label={`Remove column ${path}`}
                        onClick={() => remove(path)}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {unused.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Found in the loaded messages
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {unused.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 font-mono text-2xs text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                      onClick={() => add(path)}
                    >
                      <Plus className="size-3" />
                      {path}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
