import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Monaco ships language services for TypeScript, CSS and HTML that pull in
 * multi-megabyte web workers. k-shui only edits JSON, SQL, protobuf and YAML,
 * so those services are resolved to an empty module. If Monaco ever moves the
 * files the pattern simply stops matching and the services come back.
 */
const MONACO_EMPTY = '\0kshui-monaco-empty';

const monacoTrimUnusedLanguageServices = {
  name: 'kshui:monaco-trim',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    if (!importer || !importer.includes('monaco-editor')) return null;
    return /languages\/features\/(typescript|css|html)\/register\.js$/.test(source)
      ? MONACO_EMPTY
      : null;
  },
  load(id: string) {
    return id === MONACO_EMPTY ? 'export default {};' : null;
  },
};

/**
 * `emptyOutDir` wipes backend/k_shui/static on every build, including the tracked
 * .gitkeep that keeps the directory present in a fresh clone (the Python package
 * needs it to exist). Put it back once the bundle is written.
 */
const keepStaticDirTracked = {
  name: 'kshui:keep-gitkeep',
  closeBundle() {
    const keep = path.resolve(import.meta.dirname, '../backend/k_shui/static/.gitkeep');
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
  },
};

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), monacoTrimUnusedLanguageServices, keepStaticDirTracked],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8090', changeOrigin: true },
      '/healthz': { target: 'http://localhost:8090', changeOrigin: true },
      '/readyz': { target: 'http://localhost:8090', changeOrigin: true },
      '/metrics': { target: 'http://localhost:8090', changeOrigin: true },
    },
  },
  build: {
    outDir: '../backend/k_shui/static',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // Vite 8 bundles with Rolldown, where `rollupOptions.output.manualChunks` is
    // deprecated, so the monaco/flow/charts/vendor split is expressed as Rolldown
    // code-splitting groups instead. Highest `priority` claims a module first and
    // removes it from every lower group; anything left in node_modules ends up in
    // `vendor`. Groups also pull in their transitive dependencies (Rolldown's
    // `includeDependenciesRecursively` default), which is what keeps the chunk graph
    // a DAG: `flow` claims the d3 packages @xyflow/system needs before `charts` is
    // considered, so `flow` never has to import `charts`.
    //
    // Whenever these groups change, re-check that the emitted chunks still form a DAG
    // — a cycle between two chunks throws "Cannot access 'X' before initialization" at
    // runtime, with a blank page and no build-time warning.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react',
              priority: 60,
              // react-is is a recharts peer dependency; it belongs with the React
              // family so neither `charts` nor `vendor` ends up owning a copy.
              test: /node_modules[\\/](react|react-dom|react-is|scheduler)[\\/]/,
            },
            {
              name: 'monaco',
              priority: 50,
              test: /node_modules[\\/](monaco-editor|@monaco-editor[\\/]react)[\\/]/,
            },
            // NOTE: every @xyflow/* package must land in the same chunk, and `flow`
            // must outrank `charts` so that the d3-drag/d3-zoom/d3-selection tree
            // @xyflow/system pulls in is owned here rather than shared across chunks.
            {
              name: 'flow',
              priority: 40,
              test: /node_modules[\\/](@xyflow[\\/][^\\/]+|dagre|graphlib)[\\/]/,
            },
            {
              name: 'charts',
              priority: 30,
              test: /node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+)[\\/]/,
            },
            {
              name: 'router-query',
              priority: 20,
              test: /node_modules[\\/](react-router|@tanstack[\\/][^\\/]+)[\\/]/,
            },
            { name: 'vendor', priority: 10, test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
