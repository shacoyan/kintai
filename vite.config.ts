import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          // React コア (react / react-dom / scheduler) を 1 つの chunk に集約。
          // scheduler を入れないと vendor -> react-vendor -> vendor の循環が発生し、
          // production minify 後に undefined import で white screen を引き起こす。
          if (id.includes('react-router')) return 'router-vendor';
          if (
            id.includes('/react-dom/') ||
            id.includes('/react/') ||
            id.includes('/scheduler/') ||
            id.includes('/react-is/')
          ) {
            return 'react-vendor';
          }
          if (id.includes('@supabase')) return 'supabase-vendor';
          if (id.includes('@dnd-kit')) return 'dnd-vendor';
          if (id.includes('date-fns')) return 'date-vendor';
          if (id.includes('lucide-react')) return 'icons-vendor';
          return 'vendor';
        },
      },
    },
  },
});
