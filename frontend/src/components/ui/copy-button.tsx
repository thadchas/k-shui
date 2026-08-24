import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn, copyToClipboard } from '@/lib/utils';
import { Button, type ButtonProps } from './button';
import { Tooltip } from './tooltip';

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'value'> {
  value: string;
  label?: string;
  tooltip?: string;
}

export function CopyButton({
  value,
  label,
  tooltip = 'Copy',
  variant = 'ghost',
  size = 'icon-sm',
  className,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = useCallback(async () => {
    const ok = await copyToClipboard(value);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <Tooltip content={copied ? 'Copied' : tooltip}>
      <Button
        variant={variant}
        size={label ? 'sm' : size}
        className={cn('text-[var(--muted)] hover:text-[var(--foreground)]', className)}
        onClick={(e) => {
          e.stopPropagation();
          void onCopy();
        }}
        aria-label={tooltip}
        {...props}
      >
        {copied ? <Check className="text-[var(--success)]" /> : <Copy />}
        {label}
      </Button>
    </Tooltip>
  );
}
