import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), monacoTrimUnusedLanguageServices],
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
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id);
          const pkg = match?.[1];
          if (!pkg) return undefined;
          if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'react';
          if (pkg === 'monaco-editor' || pkg === '@monaco-editor/react') return 'monaco';
          if (pkg === '@xyflow/react' || pkg === 'dagre' || pkg === 'graphlib') return 'flow';
          if (pkg === 'recharts' || pkg === 'victory-vendor' || pkg.startsWith('d3-'))
            return 'charts';
          if (pkg === 'react-router' || pkg.startsWith('@tanstack/')) return 'router-query';
          return 'vendor';
        },
      },
    },
  },
});
