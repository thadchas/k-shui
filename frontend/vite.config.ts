import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
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
