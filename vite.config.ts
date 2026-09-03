import { defineConfig } from 'vite';

export default defineConfig({
  // Serve index.html from project root
  root: '.',

  build: {
    outDir: 'dist',
    target: 'es2020',
    rollupOptions: {
      input: 'index.html',
    },
  },

  // ELK is a large UMD bundle loaded as a classic script tag.
  // We keep it external to avoid Vite trying to bundle 1.6 MB of worker code.
  optimizeDeps: {
    exclude: ['elk.js'],
  },

  server: {
    open: true,
  },
});
