import { defineConfig } from '../../web/node_modules/@playwright/test/index.mjs'
import { readFileSync } from 'node:fs'
const state = JSON.parse(readFileSync(new URL('../../.qa-local/state.json', import.meta.url), 'utf8'))
export default defineConfig({
  testDir: '.', testMatch: 'smoke.spec.ts', workers: 1,
  outputDir: '../../.qa-local/test-results', reporter: [['list'], ['json', { outputFile: '../../.qa-local/results.json' }]],
  use: { baseURL: `http://127.0.0.1:${state.web_port}`, trace: 'retain-on-failure' },
  projects: [1280, 390].map(width => ({ name: `chromium-${width}`, use: { browserName: 'chromium', viewport: { width, height: 844 } } })),
})
