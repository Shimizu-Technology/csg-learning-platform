import openapiTS, { astToString } from 'openapi-typescript';
import { readFile, writeFile } from 'node:fs/promises';
const schema = new URL('../../docs/openapi.json', import.meta.url);
const output = astToString(await openapiTS(schema));
const targets = ['../src/types/api.generated.ts', '../../mobile/src/lib/api.generated.ts'];
for (const target of targets) {
  const url = new URL(target, import.meta.url);
  if (process.argv.includes('--check')) {
    if (await readFile(url, 'utf8').catch(() => '') !== output) {
      console.error(`Stale API types: ${url.pathname}. Run npm run api:generate in web/.`);
      process.exitCode = 1;
    }
  } else {
    await writeFile(url, output);
  }
}
