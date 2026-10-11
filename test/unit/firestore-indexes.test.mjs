import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8'));

test('firebase.json deploys firestore.indexes.json', () => {
  assert.equal(read('firebase.json').firestore.indexes, 'firestore.indexes.json');
});

test('runs.log is exempt from single-field indexing', () => {
  const o = read('firestore.indexes.json').fieldOverrides
    .find(f => f.collectionGroup === 'runs' && f.fieldPath === 'log');
  assert.ok(o, 'no override for runs.log');
  assert.deepEqual(o.indexes, []);
});

/* The export filters and sorts on updatedAt; the emulator ignores index settings, so only this
   test would catch an exemption that breaks it. */
test('updatedAt keeps its default index', () => {
  const fields = read('firestore.indexes.json').fieldOverrides.map(f => f.fieldPath);
  assert.ok(!fields.includes('updatedAt'));
});
