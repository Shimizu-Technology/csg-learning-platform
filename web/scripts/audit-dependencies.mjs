import { spawnSync } from 'node:child_process'

const severityRank = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
}

const minimumSeverity = severityRank.high

// This app is a client-rendered Vite SPA and does not use React Router's
// unstable RSC APIs. GHSA-qwww-vcr4-c8h2 explicitly affects only those APIs,
// and its patched 8.3.0 release is not yet available from npm. Keep this
// exception narrow so every other high/critical advisory still fails CI.
const acknowledgedAdvisories = new Map([
  [
    'https://github.com/advisories/GHSA-qwww-vcr4-c8h2',
    'Not applicable: the web client does not enable React Server Components.',
  ],
])

const audit = spawnSync('npm', ['audit', '--audit-level=high', '--json'], {
  encoding: 'utf8',
})

if (!audit.stdout) {
  process.stderr.write(audit.stderr || 'npm audit returned no report.\n')
  process.exit(audit.status || 1)
}

let report
try {
  report = JSON.parse(audit.stdout)
} catch {
  process.stderr.write(audit.stdout)
  process.stderr.write(audit.stderr)
  process.exit(audit.status || 1)
}

const vulnerabilities = report.vulnerabilities || {}

function unacknowledgedPaths(name, visited = new Set()) {
  if (visited.has(name)) return []

  const vulnerability = vulnerabilities[name]
  if (!vulnerability) return []
  if ((severityRank[vulnerability.severity] ?? 0) < minimumSeverity) return []

  const nextVisited = new Set(visited)
  nextVisited.add(name)

  return vulnerability.via.flatMap((via) => {
    if (typeof via === 'string') {
      return unacknowledgedPaths(via, nextVisited)
    }

    if ((severityRank[via.severity] ?? 0) < minimumSeverity) return []
    if (acknowledgedAdvisories.has(via.url)) return []
    return [`${name}: ${via.title} (${via.url})`]
  })
}

const failures = Object.keys(vulnerabilities).flatMap((name) =>
  unacknowledgedPaths(name),
)

if (failures.length > 0) {
  console.error('Unacknowledged high or critical npm audit findings:')
  for (const failure of new Set(failures)) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

for (const [url, reason] of acknowledgedAdvisories) {
  const present = Object.values(vulnerabilities).some((vulnerability) =>
    vulnerability.via.some(
      (via) => typeof via !== 'string' && via.url === url,
    ),
  )

  if (present) {
    console.warn(`Acknowledged npm advisory: ${url}`)
    console.warn(`Reason: ${reason}`)
  }
}

console.log('No unacknowledged high or critical npm audit findings.')
