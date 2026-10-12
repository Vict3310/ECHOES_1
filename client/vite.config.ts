import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  //
  // The deployment keeps one env file, at the repository root, next to the
  // server's own settings. Vite would otherwise only look inside `client/`, and
  // every `VITE_` value read from there would be undefined in the browser — the
  // client-side payment keys among them. Only `VITE_`-prefixed names are exposed
  // to the bundle, so the server's secrets stay server-side.
  //
  envDir: path.resolve(projectRoot, '..'),
  server: {
    port: 5173,
    // The curated dataset lives at the repository root so that the client can
    // render an explicitly-labelled offline sample if the API is unreachable.
    fs: { allow: [path.resolve(projectRoot, '..')] },
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          leaflet: ['leaflet'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
