import { defineConfig } from '../../web/node_modules/@playwright/test/index.mjs'
import { existsSync, readFileSync } from 'node:fs'
const stateFile = new URL('../../.qa-local/state.json', import.meta.url)
if (!existsSync(stateFile)) throw new Error('QA harness state is missing; run scripts/qa/run start first')
const state = JSON.parse(readFileSync(stateFile, 'utf8'))
export default defineConfig({
  testDir: '.', testMatch: 'smoke.spec.ts', workers: 1,
  outputDir: '../../.qa-local/test-results', reporter: [['list'], ['json', { outputFile: '../../.qa-local/results.json' }]],
  use: { baseURL: `http://127.0.0.1:${state.web_port}`, trace: 'retain-on-failure' },
  projects: [1280, 390].map(width => ({ name: `chromium-${width}`, use: { browserName: 'chromium', viewport: { width, height: 844 } } })),
})
