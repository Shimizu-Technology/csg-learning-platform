import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const severityRank = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
}

const minimumSeverity = severityRank.high
const exceptionsPath = process.argv[2]

if (!exceptionsPath) {
  console.error('Usage: node npm-audit.mjs <exceptions.json>')
  process.exit(2)
}

const exceptions = JSON.parse(
  readFileSync(resolve(process.cwd(), exceptionsPath), 'utf8'),
)
const acknowledgedAdvisories = new Map(
  Object.entries(exceptions.advisories || {}),
)

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
