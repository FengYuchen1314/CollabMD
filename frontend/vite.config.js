import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 30051,
    proxy: {
      '/api': 'http://localhost:30052',
      '/ws': {
        target: 'ws://localhost:30052',
        ws: true
      }
    }
  }
})
