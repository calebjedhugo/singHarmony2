import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // The three resound-harmony subpath imports load together (one
          // Promise.all in rekey.js); one chunk gzips better than three.
          if (id.includes('resound-harmony')) return 'harmony';
        },
      },
    },
  },
});
