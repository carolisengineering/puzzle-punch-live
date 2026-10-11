import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFileName, csvLine, CSV_HEADER } from '../../scripts/export-core.mjs';

test('runFileName keeps the helper\'s naming, tagged live', () => {
  assert.equal(runFileName('2026-10-10 120000', 'AbC123xyz'), 'delve-run 2026-10-10 120000 live-AbC123.json');
});

test('runFileName strips path and control characters from a hostile stamp', () => {
  const name = runFileName('../../etc/passwd\n' + 'x'.repeat(200), 'u/../1');
  assert.ok(!name.includes('/') && !name.includes('\\') && !name.includes('\n'));
  assert.ok(name.startsWith('delve-run ') && name.endsWith('.json'));
  assert.ok(name.length <= 'delve-run '.length + 40 + ' live-'.length + 6 + '.json'.length);
});

test('runFileName never produces an empty stamp', () => {
  assert.equal(runFileName('////', ''), 'delve-run unstamped live-anon.json');
});

test('csvLine quotes commas, quotes and newlines', () => {
  assert.equal(csvLine(['a', 'hit, "hard"', 'two\nlines', null, 12.5]), 'a,"hit, ""hard""","two\nlines",,12.5');
});

test('CSV_HEADER lists the spec\'s columns', () => {
  assert.deepEqual(CSV_HEADER, ['exportedAt', 'uid6', 'stamp', 'game', 'level', 'result', 'endReason',
    'durationSec', 'score', 'kind', 'rawBytes', 'file']);
});
