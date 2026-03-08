import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  envDir: path.resolve(__dirname, ".."),
  envPrefix: ["VITE_", "CONVEX_"],
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@novnc/novnc')) return 'vnc'
            if (id.includes('reactflow')) return 'workflow-editor'
            if (id.includes('convex')) return 'convex'
            if (id.includes('@radix-ui')) return 'radix'
            return 'vendor'
          }

          if (id.includes('src/components/VncViewer') || id.includes('src/tabs/vnc')) {
            return 'vnc'
          }

          if (id.includes('src/tabs/workflows/WorkflowFlowEditor')) {
            return 'workflow-editor'
          }

          if (id.includes('src/components/LogsViewer')) {
            return 'logs-viewer'
          }

          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
