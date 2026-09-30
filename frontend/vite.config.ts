import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

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

function getVendorChunk(id: string): string | undefined {
  const packageName = getPackageName(id)

  if (!packageName) return undefined
  if (packageName === '@novnc/novnc') return 'vnc'
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
  if (['react', 'react-dom', 'scheduler'].includes(packageName)) {
    return 'react-core'
  }
  if (['class-variance-authority', 'clsx', 'sonner', 'tailwind-merge'].includes(packageName)) {
    return 'ui-utils'
  }

  return undefined
}

export default defineConfig({
  envDir: path.resolve(rootDir, '..'),
  envPrefix: ['VITE_', 'DISABLE_AUTH'],
  plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
  test: {
    environment: 'happy-dom',
    include: ['../tests/ui/**/*.test.tsx'],
    restoreMocks: true,
    clearMocks: true,
  },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              debugName: 'vendor-packages',
              name: (id) => getVendorChunk(id) ?? 'vendor',
              test: (id) => getVendorChunk(id) !== undefined,
            },
          ],
        },
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
