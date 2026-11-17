const assert = require('node:assert/strict');
const { test } = require('node:test');
const { publishOta } = require('./publish-ota-ios.cjs');

const buildId = '11111111-2222-4333-8444-555555555555';
const hash = 'a'.repeat(40);
const message = 'Harmless copy fix abc123';

function commands(comparison = { fingerprint1: { hash }, fingerprint2: { hash } }, failAt) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    if (calls.length === failAt) throw new Error('command failed');
    if (args.includes('fingerprint:compare')) return typeof comparison === 'string' ? comparison : JSON.stringify(comparison);
    return '';
  };
  return { calls, run };
}

test('reinstalls before comparing the production environment, and only then publishes iOS', () => {
  const { calls, run } = commands();
  publishOta(buildId, message, run);
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ['npm', 'ci'],
    ['npx', 'eas-cli@16.28.0', 'fingerprint:compare', '--build-id', buildId, '--environment', 'production', '--non-interactive', '--json'],
    ['npx', 'eas-cli@16.28.0', 'update', '--channel', 'production', '--environment', 'production', '--platform', 'ios', '--message', message],
  ]);
  assert.ok(calls.every(call => call.options.cwd.endsWith('/mobile')));
  assert.equal(calls[1].options.encoding, 'utf8');
});

for (const [label, output] of [
  ['different hashes despite CLI success', { fingerprint1: { hash }, fingerprint2: { hash: 'b'.repeat(40) } }],
  ['missing hashes', {}],
  ['empty hashes', { fingerprint1: { hash: '' }, fingerprint2: { hash: '' } }],
  ['malformed hashes', { fingerprint1: { hash: 'match' }, fingerprint2: { hash: 'match' } }],
  ['malformed JSON', 'unexpected output'],
]) {
  test(`refuses publication with ${label}`, () => {
    const { calls, run } = commands(output);
    assert.throws(() => publishOta(buildId, message, run), /no update was published/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => !call.args.includes('update')));
  });
}

for (const failAt of [1, 2]) {
  test(`does not continue after command ${failAt} fails`, () => {
    const { calls, run } = commands(undefined, failAt);
    assert.throws(() => publishOta(buildId, message, run), /command failed/);
    assert.equal(calls.length, failAt);
  });
}

test('rejects incomplete arguments before running any command', () => {
  const { calls, run } = commands();
  assert.throws(() => publishOta('--not-a-build', message, run), /Usage/);
  assert.throws(() => publishOta(buildId, '  ', run), /Usage/);
  assert.equal(calls.length, 0);
});
