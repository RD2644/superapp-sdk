import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Use this repo's SDK build so the demo can use unreleased APIs.
    // Run `npm run build:dist` in the repo root first.
    alias: {
      '@grabjs/superapp-sdk': fileURLToPath(new URL('../../dist/index.esm.js', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['../..'] },
  },
})
