import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

function getPackageName(id: string): string | null {
  const normalizedId = id.replace(/\\/g, '/')
  const packagePath = normalizedId.split('/node_modules/')[1]

  if (!packagePath) return null

  if (packagePath.startsWith('@')) {
    const [scope, name] = packagePath.split('/')
    return scope && name ? `${scope}/${name}` : null
  }

  const [name] = packagePath.split('/')
  return name || null
}

function getManualChunk(id: string): string | undefined {
  const packageName = getPackageName(id)

  if (!packageName) return undefined
  if (packageName === '@novnc/novnc') return 'vnc'
  if (
    packageName === 'reactflow' ||
    packageName.startsWith('@reactflow/') ||
    packageName.startsWith('d3-') ||
    packageName === 'zustand'
  ) {
    return 'workflow-editor'
  }
  if (packageName === 'convex') return 'convex'
  if (packageName.startsWith('@radix-ui/') || packageName.startsWith('@floating-ui/')) return 'radix'
  if (
    packageName.startsWith('@clerk/') ||
    ['cookie', 'detect-node-es', 'set-cookie-parser', 'swr', 'use-sync-external-store'].includes(packageName)
  ) {
    return 'react-core'
  }
  if (
    packageName.startsWith('@codemirror/') ||
    packageName.startsWith('@lezer/') ||
    packageName === '@marijn/find-cluster-break' ||
    packageName === 'crelt' ||
    packageName === 'w3c-keyname'
  ) {
    return 'codemirror'
  }
  if (packageName === 'lucide-react') return 'icons'
  if (['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler'].includes(packageName)) {
    return 'react-core'
  }
  if (packageName === 'react-resizable-panels') return 'layout'
  if (['class-variance-authority', 'clsx', 'sonner', 'tailwind-merge', 'tailwindcss-animate'].includes(packageName)) {
    return 'ui-utils'
  }

  return undefined
}

export default defineConfig({
  envDir: path.resolve(rootDir, '..'),
  envPrefix: ['VITE_'],
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: getManualChunk,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
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
