const assert = require('node:assert/strict');
const test = require('node:test');
const queryString = require('query-string');

test('Expo query-string can call the patched CommonJS decoder', () => {
  assert.deepEqual({...queryString.parse('student=Jos%C3%A9&tab=messages')}, {student: 'José', tab: 'messages'});
  assert.deepEqual({...queryString.parse('tag=one&tag=two&flag')}, {tag: ['one', 'two'], flag: null});
  assert.equal(queryString.parse('value=%broken%20value').value, '%broken value');
  assert.equal(queryString.parse('value=%F0%9F%91%8B%ZZ').value, '👋%ZZ');
});

test('malformed repeated escapes preserve valid output without quadratic rescanning', {timeout: 2000}, () => {
  const input = '%41'.repeat(100000) + '%ZZ';
  assert.equal(queryString.parse(`value=${input}`).value, 'A'.repeat(100000) + '%ZZ');
});
