import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import { useThemeStore, resolveTheme } from '@/stores/theme';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Monaco is bundled locally (never fetched from a CDN) so the UI works behind a
 * strict CSP and in air-gapped deployments. Everything below — the editor core,
 * the JSON language service and the web workers — is imported dynamically so it
 * stays in its own lazily loaded chunk (see `manualChunks` in vite.config.ts).
 */

export type EditorLanguage =
  'json' | 'sql' | 'yaml' | 'plaintext' | 'protobuf' | 'javascript' | 'properties';

/** ksqlDB / Kafka SQL keywords surfaced as completions on the `sql` language. */
const KSQL_KEYWORDS = [
  'CREATE STREAM',
  'CREATE TABLE',
  'CREATE STREAM AS SELECT',
  'CREATE TABLE AS SELECT',
  'CREATE OR REPLACE',
  'INSERT INTO',
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'PARTITION BY',
  'HAVING',
  'WINDOW TUMBLING',
  'WINDOW HOPPING',
  'WINDOW SESSION',
  'EMIT CHANGES',
  'EMIT FINAL',
  'JOIN',
  'LEFT JOIN',
  'FULL OUTER JOIN',
  'INNER JOIN',
  'WITHIN',
  'ON',
  'AS',
  'WITH',
  'KAFKA_TOPIC',
  'VALUE_FORMAT',
  'KEY_FORMAT',
  'PARTITIONS',
  'REPLICAS',
  'TIMESTAMP',
  'AVRO',
  'JSON',
  'JSON_SR',
  'PROTOBUF',
  'KAFKA',
  'DELIMITED',
  'SHOW STREAMS',
  'SHOW TABLES',
  'SHOW QUERIES',
  'SHOW TOPICS',
  'SHOW PROPERTIES',
  'SHOW CONNECTORS',
  'DESCRIBE',
  'DESCRIBE EXTENDED',
  'EXPLAIN',
  'PRINT',
  'TERMINATE',
  'DROP STREAM',
  'DROP TABLE',
  'SET',
  'UNSET',
  'RUN SCRIPT',
  'LIMIT',
  'CAST',
  'STRUCT',
  'ARRAY',
  'MAP',
  'ROWTIME',
  'ROWKEY',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COLLECT_LIST',
  'COLLECT_SET',
  'TOPK',
  'LATEST_BY_OFFSET',
  'EARLIEST_BY_OFFSET',
];

let extrasRegistered = false;

function registerExtras(monaco: typeof Monaco) {
  if (extrasRegistered) return;
  extrasRegistered = true;

  monaco.editor.defineTheme('kshui-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#FFFFFF',
      'editorGutter.background': '#FFFFFF',
      'editor.lineHighlightBackground': '#F1F5F9',
      'editorLineNumber.foreground': '#94A3B8',
      'editorLineNumber.activeForeground': '#0F172A',
    },
  });
  monaco.editor.defineTheme('kshui-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#111A2B',
      'editorGutter.background': '#111A2B',
      'editor.lineHighlightBackground': '#172238',
      'editorLineNumber.foreground': '#5A6B85',
      'editorLineNumber.activeForeground': '#E6EDF7',
    },
  });

  /* Java-properties style highlighting for connector configs. */
  monaco.languages.register({ id: 'properties' });
  monaco.languages.setMonarchTokensProvider('properties', {
    tokenizer: {
      root: [
        [/^[#!].*$/, 'comment'],
        [/^[\w.\-$]+(?=\s*[=:])/, 'key'],
        [/[=:]/, 'delimiter'],
        [/.*$/, 'string'],
      ],
    },
  });

  monaco.languages.registerCompletionItemProvider('sql', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: KSQL_KEYWORDS.map((keyword) => ({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          range,
        })),
      };
    },
  });
}

const MonacoEditor = lazy(async () => {
  const [reactMonaco, monaco] = await Promise.all([
    import('@monaco-editor/react'),
    /* The local monaco build: editor core, every basic language (sql, protobuf,
       yaml, …) and the JSON language service. */
    import('monaco-editor'),
  ]);

  /* Workers are bundled by Vite (`?worker`) — never loaded from a CDN. */
  const [editorWorker, jsonWorker] = await Promise.all([
    import('monaco-editor/editor/editor.worker.js?worker'),
    import('monaco-editor/languages/features/json/json.worker.js?worker'),
  ]);

  (self as unknown as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      return label === 'json' ? new jsonWorker.default() : new editorWorker.default();
    },
  };

  /* Point @monaco-editor/react at the local instance instead of the CDN. */
  reactMonaco.loader.config({ monaco: monaco as unknown as typeof Monaco });
  registerExtras(monaco as unknown as typeof Monaco);

  return { default: reactMonaco.default };
});

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
  /** Fired on ⌘/Ctrl+Enter — used by the ksqlDB editor to run a statement. */
  onSubmit?: () => void;
  ariaLabel?: string;
}

export function CodeEditor({
  value,
  onChange,
  language = 'json',
  height = 280,
  readOnly = false,
  className,
  minimal = true,
  onSubmit,
  ariaLabel,
}: CodeEditorProps) {
  const mode = useThemeStore((s) => s.mode);
  const theme = resolveTheme(mode) === 'dark' ? 'kshui-dark' : 'kshui-light';
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

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
      ariaLabel,
    }),
    [readOnly, minimal, ariaLabel],
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
          onMount={(editor, monaco) => {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
              submitRef.current?.(),
            );
          }}
          loading={<Skeleton className="size-full rounded-none" />}
        />
      </Suspense>
    </div>
  );
}
