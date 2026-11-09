import { defineConfig, type Plugin } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import path from 'node:path'

/**
 * Uploaded documents are parsed in the browser only (src/lib/document-text.ts). The server
 * builds would otherwise still load pdf.js and mammoth from the dead import() branches, which
 * exhausts the default heap, so they are kept external outside the client environment.
 */
function clientOnlyDocumentParsers(): Plugin {
  const parsers = new Set(['unpdf', 'mammoth'])
  return {
    name: 'client-only-document-parsers',
    enforce: 'pre',
    applyToEnvironment: environment => environment.name !== 'client',
    resolveId: id => (parsers.has(id) ? { id, external: true } : null),
  }
}

export default defineConfig({
  base: '/workbench/',
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    clientOnlyDocumentParsers(),
    tanstackStart(),
    nitro({ baseURL: '/workbench' }),
    react(),
    tailwindcss(),
  ],
})
