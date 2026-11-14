import { createServer } from '../../web/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'
const web = fileURLToPath(new URL('../../web/', import.meta.url))
const target = `http://127.0.0.1:${process.env.QA_API_PORT}`
const server = await createServer({
  root: web, envFile: false,
  resolve: { alias: { '@clerk/clerk-react': fileURLToPath(new URL('./clerk-stub.tsx', import.meta.url)) }, dedupe: ['react', 'react-dom'] },
  define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_local_qa'), 'import.meta.env.VITE_API_URL': JSON.stringify(''), 'import.meta.env.VITE_PUBLIC_POSTHOG_KEY': JSON.stringify('') },
  server: { host: '127.0.0.1', port: Number(process.env.QA_WEB_PORT), strictPort: true, fs: { allow: [web, fileURLToPath(new URL('./', import.meta.url))] }, proxy: { '/api': { target }, '/cable': { target, ws: true } } },
})
await server.listen()
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await server.close(); process.exit() })
