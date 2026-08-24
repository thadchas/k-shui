import { cn } from '@/lib/utils';

/** k-shui logo mark — gradient teal tile with the flowing-wave K (see docs/brand/). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-hidden="true"
      className={cn('size-7 shrink-0', className)}
    >
      <defs>
        <linearGradient id="ks-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14B8A6" />
          <stop offset="1" stopColor="#0D9488" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7" fill="url(#ks-mark)" />
      <g fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round">
        <path d="M9.75 7.75 V24.25" />
        <path d="M22.75 7.5 C17.25 9.5 18.25 13 10.75 15.25" />
        <path d="M10.75 16.75 C18.25 19 17.25 22.5 22.75 24.5" />
      </g>
    </svg>
  );
}
