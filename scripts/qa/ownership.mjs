import { spawnSync } from 'node:child_process'

export function checkedLifecycle(session, action, identifier, run = spawnSync) {
  const args = [action, '--session', session, 'browser-tab', identifier]
  if (action === 'claim') args.push('--reason', 'Bundled Chromium student workspace UI QA')
  const result = run('dev-lifecycle', args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    const diagnostic = [result.error?.message, result.signal, result.stdout, result.stderr].filter(Boolean).join('\n')
    throw new Error(`dev-lifecycle ${action} failed for ${identifier}: ${diagnostic || `exit ${result.status}`}`)
  }
}
