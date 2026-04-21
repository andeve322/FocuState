import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  define: {
    global: 'window', // <--- THIS LINE PREVENTS THE WHITE SCREEN CRASH
  },
  worker: {
    format: 'es'
  }
})