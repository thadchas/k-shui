import { Suspense, lazy, useMemo } from 'react';
import { useThemeStore, resolveTheme } from '@/stores/theme';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const MonacoEditor = lazy(async () => {
  const mod = await import('@monaco-editor/react');
  return { default: mod.default };
});

export type EditorLanguage = 'json' | 'sql' | 'yaml' | 'plaintext' | 'protobuf' | 'javascript';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: EditorLanguage;
  height?: number | string;
  readOnly?: boolean;
  className?: string;
  /** Compact chrome: no minimap, no line numbers, tight padding. */
  minimal?: boolean;
  placeholder?: string;
}

export function CodeEditor({
  value,
  onChange,
  language = 'json',
  height = 280,
  readOnly = false,
  className,
  minimal = true,
}: CodeEditorProps) {
  const mode = useThemeStore((s) => s.mode);
  const theme = resolveTheme(mode) === 'dark' ? 'vs-dark' : 'vs';

  const options = useMemo(
    () => ({
      readOnly,
      minimap: { enabled: !minimal },
      lineNumbers: (minimal ? 'off' : 'on') as 'off' | 'on',
      fontSize: 13,
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      fontLigatures: false,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      renderLineHighlight: (minimal ? 'none' : 'line') as 'none' | 'line',
      folding: !minimal,
      glyphMargin: false,
      lineDecorationsWidth: minimal ? 4 : 10,
      lineNumbersMinChars: minimal ? 0 : 3,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      padding: { top: 8, bottom: 8 },
      wordWrap: 'on' as const,
    }),
    [readOnly, minimal],
  );

  const heightStyle = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)]',
        className,
      )}
      style={{ height: heightStyle }}
    >
      <Suspense fallback={<Skeleton className="size-full rounded-none" />}>
        <MonacoEditor
          value={value}
          language={language}
          theme={theme}
          height="100%"
          onChange={(v) => onChange?.(v ?? '')}
          options={options}
          loading={<Skeleton className="size-full rounded-none" />}
        />
      </Suspense>
    </div>
  );
}
