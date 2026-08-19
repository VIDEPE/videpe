import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  base: '/videpe/',
  plugins: [tailwindcss(), react(), svgr()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // @niivue/dicom-loader's dcm2niix dependency ships a WASM binary + ES module worker that
  // Vite's pre-bundler mishandles by default — exclude it and build workers as ES modules.
  optimizeDeps: {
    exclude: ['@niivue/dcm2niix'],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    server: {
      deps: {
        inline: ['convex-hull'],
      },
    },
  },
});
