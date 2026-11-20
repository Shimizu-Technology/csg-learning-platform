import { createServer } from '../../web/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
const web = fileURLToPath(new URL('../../web/', import.meta.url))
const target = `http://127.0.0.1:${process.env.QA_API_PORT}`
// Real browsers and simulators can't use Playwright routes, so this serves
// .qa-local/synthetic-<version>.mp4 (or synthetic.mp4) for hosted video blocks.
const syntheticVideo = { name: 'synthetic-video-stream', configureServer(server) {
  server.middlewares.use((request, response, next) => {
    const url = new URL(request.url, 'http://localhost')
    if (/^\/api\/v1\/content_blocks\/\d+\/video_stream$/.test(url.pathname)) {
      const version = url.searchParams.get('version_id') || 'default'
      response.setHeader('Content-Type', 'application/json')
      return response.end(JSON.stringify({ stream_url: `/qa-media.mp4?version=${encodeURIComponent(version)}`, expires_at: new Date(Date.now() + 3600000).toISOString(), video_progress: null }))
    }
    if (url.pathname !== '/qa-media.mp4') return next()
    const named = fileURLToPath(new URL(`../../.qa-local/synthetic-${(url.searchParams.get('version') || '').replace(/[^\w-]/g, '')}.mp4`, import.meta.url))
    const media = readFileSync(existsSync(named) ? named : fileURLToPath(new URL('../../.qa-local/synthetic.mp4', import.meta.url)))
    const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/)
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1
    response.statusCode = range ? 206 : 200
    response.setHeader('Content-Type', 'video/mp4')
    response.setHeader('Accept-Ranges', 'bytes')
    response.setHeader('Content-Length', String(end - start + 1))
    if (range) response.setHeader('Content-Range', `bytes ${start}-${end}/${media.length}`)
    response.end(media.subarray(start, end + 1))
  })
} }
const server = await createServer({
  root: web, envFile: false,
  plugins: [...(process.env.QA_SYNTHETIC_VIDEO === '1' ? [syntheticVideo] : []), ...(process.env.QA_GITHUB_APP === '1' ? [{ name: 'synthetic-github-authorization', configureServer(server) {
    server.middlewares.use('/qa/github-authorize', (request, response) => {
      const state = new URL(request.url, 'http://localhost').searchParams.get('state') || ''
      const href = '/github-app/authorize?' + new URLSearchParams({ state, code: 'synthetic-code' }).toString()
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic GitHub authorization</title><main><h1>GitHub authorization — synthetic provider</h1><p>Local QA only. No real GitHub account or credentials.</p><a style="display:inline-block;padding:16px" href="${href.replaceAll('&', '&amp;')}">Continue as app-learner</a></main></html>`)
    })
  } }] : [])],
  resolve: { alias: { '@clerk/clerk-react': fileURLToPath(new URL('./clerk-stub.tsx', import.meta.url)) }, dedupe: ['react', 'react-dom'] },
  define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_local_qa'), 'import.meta.env.VITE_API_URL': JSON.stringify(''), 'import.meta.env.VITE_PUBLIC_POSTHOG_KEY': JSON.stringify('') },
  server: { host: '127.0.0.1', port: Number(process.env.QA_WEB_PORT), strictPort: true, fs: { allow: [web, fileURLToPath(new URL('./', import.meta.url))] }, proxy: { '/api': { target }, '/cable': { target, ws: true } } },
})
await server.listen()
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await server.close(); process.exit() })
