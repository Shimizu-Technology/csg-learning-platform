import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
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

          // React and the router are needed by every page. Name their chunk so
          // Rollup does not fold the JSX runtime into a lazily used vendor chunk
          // (it used to land in vendor-markdown, forcing every page, including
          // the signed-out landing, to preload the markdown libraries).
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id)) return 'vendor-react'

          if (id.includes('@clerk/')) return 'vendor-clerk'
          if (id.includes('posthog-js')) return 'vendor-analytics'
          if (id.includes('@monaco-editor/')) return 'vendor-editor'
          if (id.includes('@tiptap/')) return 'vendor-richtext'
          if (id.includes('@ruby/') || id.includes('quickjs-emscripten') || id.includes('@jitl/quickjs')) return 'vendor-code-runner'
          if (id.includes('react-markdown') || id.includes('marked') || id.includes('dompurify')) return 'vendor-markdown'
          if (id.includes('lucide-react')) return 'vendor-icons'
        },
      },
    },
  },
})
