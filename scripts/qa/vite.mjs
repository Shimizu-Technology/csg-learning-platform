import { createServer } from '../../web/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'
const web = fileURLToPath(new URL('../../web/', import.meta.url))
const target = `http://127.0.0.1:${process.env.QA_API_PORT}`
const server = await createServer({
  root: web, envFile: false,
  plugins: process.env.QA_GITHUB_APP === '1' ? [{ name: 'synthetic-github-authorization', configureServer(server) {
    server.middlewares.use('/qa/github-authorize', (request, response) => {
      const state = new URL(request.url, 'http://localhost').searchParams.get('state') || ''
      const href = '/github-app/authorize?' + new URLSearchParams({ state, code: 'synthetic-code' }).toString()
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic GitHub authorization</title><main><h1>GitHub authorization — synthetic provider</h1><p>Local QA only. No real GitHub account or credentials.</p><a style="display:inline-block;padding:16px" href="${href.replaceAll('&', '&amp;')}">Continue as app-learner</a></main></html>`)
    })
  } }] : [],
  resolve: { alias: { '@clerk/clerk-react': fileURLToPath(new URL('./clerk-stub.tsx', import.meta.url)) }, dedupe: ['react', 'react-dom'] },
  define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_local_qa'), 'import.meta.env.VITE_API_URL': JSON.stringify(''), 'import.meta.env.VITE_PUBLIC_POSTHOG_KEY': JSON.stringify('') },
  server: { host: '127.0.0.1', port: Number(process.env.QA_WEB_PORT), strictPort: true, fs: { allow: [web, fileURLToPath(new URL('./', import.meta.url))] }, proxy: { '/api': { target }, '/cable': { target, ws: true } } },
})
await server.listen()
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await server.close(); process.exit() })
