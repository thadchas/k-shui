import { useState } from 'react';
import { Bookmark, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import type { SavedSearch } from './messageSearch';

export interface SavedSearchesMenuProps {
  searches: SavedSearch[];
  /** Name of the saved search currently loaded, if any. */
  activeId: string | null;
  onSave: (name: string) => void;
  onApply: (search: SavedSearch) => void;
  onDelete: (id: string) => void;
}

/**
 * Save the browser's query configuration under a name and restore it later. Payloads are
 * never part of a saved search — see `sanitizeQueryConfig`.
 */
export function SavedSearchesMenu({
  searches,
  activeId,
  onSave,
  onApply,
  onDelete,
}: SavedSearchesMenuProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const save = () => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    onSave(trimmed);
    setName('');
    setOpen(false);
  };

  const active = searches.find((s) => s.id === activeId) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Saved searches">
          <Bookmark />
          {active ? <span className="max-w-32 truncate">{active.name}</span> : 'Saved searches'}
          {searches.length > 0 ? (
            <Badge variant="secondary" size="sm">
              {searches.length}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="space-y-2 border-b border-[var(--border)] p-3">
          <Label htmlFor="saved-search-name">Save this query</Label>
          <div className="flex gap-2">
            <Input
              id="saved-search-name"
              value={name}
              placeholder="e.g. Failed orders, partition 3"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  save();
                }
              }}
            />
            <Button size="sm" onClick={save} disabled={name.trim() === ''}>
              <Save /> Save
            </Button>
          </div>
          <p className="text-2xs text-[var(--muted)]">
            Stores the query configuration only — filters, encodings, partitions and field columns.
            Message payloads are never saved.
          </p>
        </div>

        <div className="max-h-72 overflow-auto p-1.5">
          {searches.length === 0 ? (
            <p className="px-2 py-3 text-xs text-[var(--muted)]">
              No saved searches for this topic yet.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {searches.map((search) => (
                <li key={search.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
                    onClick={() => {
                      onApply(search);
                      setOpen(false);
                    }}
                  >
                    <span className="block truncate">{search.name}</span>
                    <span className="block truncate text-2xs text-[var(--muted)]">
                      {search.config.mode}
                      {search.config.filter ? ` · ${search.config.filter}` : ''}
                      {search.config.partitions.length > 0
                        ? ` · ${search.config.partitions.length} partition${
                            search.config.partitions.length === 1 ? '' : 's'
                          }`
                        : ''}
                    </span>
                  </button>
                  <Tooltip content="Delete saved search">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete saved search ${search.name}`}
                      onClick={() => onDelete(search.id)}
                    >
                      <Trash2 />
                    </Button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
