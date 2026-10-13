import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const API = process.env.VITE_API_PROXY || 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      // Browser spans (VITE_OTEL_ENABLED=true) go to the local collector's OTLP/HTTP port.
      '/otlp': { target: process.env.VITE_OTLP_PROXY || 'http://localhost:4318', rewrite: (p) => p.replace(/^\/otlp/, '') },
    },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    // Full-app renders in parallel workers routinely take several seconds on CI runners.
    testTimeout: 20_000,
  },
});
