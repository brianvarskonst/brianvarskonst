import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { updateCaption } from './update-caption.mjs';

const data = JSON.parse(await readFile(new URL('../data/contributions.json', import.meta.url), 'utf8'));
const readme = 'Original description\n<!-- contribution-summary:start -->old<!-- contribution-summary:end -->\nOriginal project links';
test('Updates only the marked summary and preserves surrounding profile text', () => {
  const output = updateCaption(readme, data);
  assert.ok(output.startsWith('Original description\n'));
  assert.ok(output.endsWith('\nOriginal project links'));
  const total = data.days.reduce((sum, day) => sum + day.count, 0).toLocaleString('en-US');
  assert.ok(output.includes(`**${total} contributions**`));
  assert.ok(output.includes(`${data.range.start} — ${data.range.end}`));
  assert.equal(updateCaption(output, data), output);
});
test('Rejects missing, duplicate or reversed markers', () => {
  for (const text of ['No markers', readme + readme, '<!-- contribution-summary:end --><!-- contribution-summary:start -->']) {
    assert.throws(() => updateCaption(text, data), /exactly one ordered/);
  }
});
test('Rejects invalid counts before updating the profile', () => {
  const corrupt = structuredClone(data);
  corrupt.days[0].count = -1;
  assert.throws(() => updateCaption(readme, corrupt));
});
