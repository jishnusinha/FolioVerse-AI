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
      // Documentation site (`pnpm --filter @folioverse/docs dev`), served under /docs like in the web image.
      '^/docs(/|$)': { target: process.env.VITE_DOCS_PROXY || 'http://localhost:4321' },
    },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@xyflow')) return 'vendor-xyflow';
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'vendor-recharts';
          if (id.includes('node_modules/@tiptap') || id.includes('node_modules/prosemirror')) return 'vendor-tiptap';
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'vendor-motion';
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
          if (id.includes('node_modules/@radix-ui')) return 'vendor-radix';
          if (id.includes('node_modules/@tanstack')) return 'vendor-query';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
    // Full-app renders in parallel workers routinely take several seconds on CI runners.
    testTimeout: 20_000,
    // Every worker builds its own jsdom + full app graph; one per core starves the machine and times out.
    maxWorkers: '50%',
  },
});
