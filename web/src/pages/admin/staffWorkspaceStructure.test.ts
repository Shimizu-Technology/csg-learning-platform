// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('keeps the split staff JSX readable within 160 columns', () => {
  const root = new URL('./', import.meta.url)
  const files = ['CohortDetail.tsx', 'CohortWorkspace.tsx', 'StudentWorkspace.tsx']
  for (const folder of ['cohortSettings', 'cohortWorkspace', 'studentWorkspace']) {
    files.push(
      ...readdirSync(new URL(`${folder}/`, root))
        .filter((name) => name.endsWith('.tsx'))
        .map((name) => `${folder}/${name}`),
    )
  }
  const violations = files.flatMap((file) =>
    readFileSync(fileURLToPath(new URL(file, root)), 'utf8')
      .split('\n')
      .flatMap((line, index) => (line.length > 160 ? [`${file}:${index + 1} (${line.length} columns)`] : [])),
  )
  expect(violations).toEqual([])
})
