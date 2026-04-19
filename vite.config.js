import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'window', // <--- THIS LINE PREVENTS THE WHITE SCREEN CRASH
  },
  worker: {
    format: 'es'
  }
})