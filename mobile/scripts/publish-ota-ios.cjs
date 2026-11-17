const { execFileSync } = require('node:child_process');
const path = require('node:path');

const mobileDir = path.resolve(__dirname, '..');
const easCli = 'eas-cli@16.28.0';

/** Operator-only: reinstall, compare with the installed iOS build, then publish. */
function publishOta(buildId, message, run = execFileSync) {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(buildId ?? '') || typeof message !== 'string' || !message.trim()) {
    throw new Error('Usage: node scripts/publish-ota-ios.cjs <INSTALLED_IOS_BUILD_ID> "<message and source SHA>"');
  }
  const options = { cwd: mobileDir, stdio: 'inherit' };
  run('npm', ['ci'], options);
  const output = run('npx', [easCli, 'fingerprint:compare', '--build-id', buildId, '--environment', 'production', '--non-interactive', '--json'], {
    ...options, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8',
  });
  let comparison;
  try { comparison = JSON.parse(output); }
  catch { throw new Error('Fingerprint comparison returned invalid JSON; no update was published.'); }
  // CLI 16.28 exits zero on a mismatch. Its JSON result, not the exit code,
  // is the gate. Missing hashes and changed response formats fail closed.
  const buildHash = comparison?.fingerprint1?.hash;
  const localHash = comparison?.fingerprint2?.hash;
  if (typeof buildHash !== 'string' || !/^[\da-f]{40}$/i.test(buildHash) || buildHash !== localHash) {
    throw new Error('Fingerprints differ or are missing; no update was published. Restore matching inputs or install a new native build.');
  }
  run('npx', [easCli, 'update', '--channel', 'production', '--environment', 'production', '--platform', 'ios', '--message', message], options);
}

module.exports = { publishOta };

if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('Expected an installed iOS build ID and one quoted message.');
    publishOta(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
