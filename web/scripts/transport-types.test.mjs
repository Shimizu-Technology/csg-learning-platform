import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transportInterfaces } from './transport-types.mjs';

test('response interfaces and canonical transport declarations are detected', () => {
  assert.deepEqual(transportInterfaces('export interface NewResponse { id: number }', 'web/src/lib/new.ts'), ['web/src/lib/new.ts:NewResponse']);
  assert.deepEqual(transportInterfaces('export interface Course { id: number }', 'web/src/types/api.ts'), ['web/src/types/api.ts:Course']);
  assert.deepEqual(transportInterfaces('interface ButtonProps { label: string }', 'web/src/components/Button.tsx'), []);
  assert.deepEqual(transportInterfaces("export type Course = components['schemas']['Course'];", 'web/src/types/api.ts'), []);
});
