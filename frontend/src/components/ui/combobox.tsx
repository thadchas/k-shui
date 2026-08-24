import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './command';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface ComboboxOption {
  label: string;
  value: string;
  description?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  clearable?: boolean;
  onSearchChange?: (search: string) => void;
  loading?: boolean;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results',
  className,
  contentClassName,
  disabled,
  clearable = false,
  onSearchChange,
  loading,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between font-normal',
            !selected && 'text-[var(--muted)]',
            className,
          )}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <span className="flex items-center gap-1">
            {clearable && selected ? (
              <X
                className="size-3.5 text-[var(--muted)] hover:text-[var(--foreground)]"
                onClick={(e) => {
                  e.stopPropagation();
                  onValueChange(null);
                }}
              />
            ) : null}
            <ChevronsUpDown className="size-3.5 shrink-0 text-[var(--muted)]" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[var(--radix-popover-trigger-width)] p-0', contentClassName)}
        align="start"
      >
        <Command shouldFilter={!onSearchChange}>
          <CommandInput placeholder={searchPlaceholder} onValueChange={onSearchChange} />
          <CommandList>
            {loading ? (
              <div className="py-6 text-center text-xs text-[var(--muted)]">Loading…</div>
            ) : (
              <>
                <CommandEmpty>{emptyText}</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.label}
                      disabled={option.disabled}
                      onSelect={() => {
                        onValueChange(option.value === value && clearable ? null : option.value);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'text-[var(--primary)]!',
                          option.value === value ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.description ? (
                        <span className="shrink-0 text-2xs text-[var(--muted)]">
                          {option.description}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export interface MultiComboboxProps
  extends Omit<ComboboxProps, 'value' | 'onValueChange' | 'clearable'> {
  values: string[];
  onValuesChange: (values: string[]) => void;
  summary?: (values: string[]) => string;
}

export function MultiCombobox({
  options,
  values,
  onValuesChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No results',
  className,
  contentClassName,
  disabled,
  summary,
}: MultiComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const label =
    values.length === 0
      ? placeholder
      : summary
        ? summary(values)
        : values.length === 1
          ? (options.find((o) => o.value === values[0])?.label ?? values[0])
          : `${values.length} selected`;

  const toggle = (v: string) =>
    onValuesChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'justify-between font-normal',
            values.length === 0 && 'text-[var(--muted)]',
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-[var(--muted)]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-56 p-0', contentClassName)} align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.label}
                  onSelect={() => toggle(option.value)}
                >
                  <Check
                    className={cn(
                      'text-[var(--primary)]!',
                      values.includes(option.value) ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {values.length > 0 ? (
            <div className="border-t border-[var(--border)] p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => onValuesChange([])}
              >
                Clear selection
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
