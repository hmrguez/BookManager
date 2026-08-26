import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const sqliteWasmPath = fileURLToPath(
  new URL('./node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url),
)

function sqliteWasmAsset(): Plugin {
  return {
    name: 'wovenleaf-sqlite-wasm',
    configureServer(server) {
      server.middlewares.use('/assets/sql-wasm.wasm', async (_request, response, next) => {
        try {
          response.setHeader('Content-Type', 'application/wasm')
          response.end(await readFile(sqliteWasmPath))
        } catch (error) {
          next(error as Error)
        }
      })
    },
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/sql-wasm.wasm',
        source: await readFile(sqliteWasmPath),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), sqliteWasmAsset()],
})
