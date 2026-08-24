import { Toaster as SonnerToaster, toast } from 'sonner';
import { useThemeStore, resolveTheme } from '@/stores/theme';

export { toast };

export function Toaster() {
  const mode = useThemeStore((s) => s.mode);
  return (
    <SonnerToaster
      theme={mode === 'system' ? 'system' : resolveTheme(mode)}
      position="bottom-right"
      closeButton
      richColors={false}
      toastOptions={{
        classNames: {
          toast:
            'group !rounded-[var(--radius-card)] !border !border-[var(--border)] !bg-[var(--surface)] !text-[var(--foreground)] !shadow-[var(--shadow-pop)] !font-sans !text-sm',
          description: '!text-[var(--muted)] !text-xs',
          actionButton: '!bg-[var(--primary)] !text-[var(--primary-foreground)] !rounded-[6px]',
          cancelButton: '!bg-[var(--surface-2)] !text-[var(--muted)] !rounded-[6px]',
          success: '[&_[data-icon]]:!text-[var(--success)]',
          error: '[&_[data-icon]]:!text-[var(--danger)]',
          warning: '[&_[data-icon]]:!text-[var(--warning)]',
          info: '[&_[data-icon]]:!text-[var(--info)]',
        },
      }}
    />
  );
}

/** Consistent error toast for ApiError / unknown throwables. */
export function toastError(title: string, error: unknown) {
  const description =
    error && typeof error === 'object' && 'message' in error
      ? String((error as Error).message)
      : String(error ?? '');
  toast.error(title, { description });
}
