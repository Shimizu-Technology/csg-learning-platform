import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('@clerk/')) return 'vendor-clerk'
          if (id.includes('posthog-js')) return 'vendor-analytics'
          if (id.includes('@monaco-editor/')) return 'vendor-editor'
          if (id.includes('@tiptap/')) return 'vendor-richtext'
          if (id.includes('react-markdown') || id.includes('marked') || id.includes('dompurify')) return 'vendor-markdown'
          if (id.includes('lucide-react')) return 'vendor-icons'
        },
      },
    },
  },
})
