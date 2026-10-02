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
  const active = data.days.filter(day => day.count > 0).length;
  const peak = data.days.reduce((best, day) => !best || day.count > best.count ? day : best, null);
  assert.equal(output, `Original description\n<!-- contribution-summary:start -->\n**${total} contributions** · **${active} active days**<br />\nVisible calendar: ${data.range.start} — ${data.range.end}.<br />\nPeak: ${peak.date} · ${peak.count.toLocaleString('en-US')} contributions.\n<!-- contribution-summary:end -->\nOriginal project links`);
  assert.equal(updateCaption(output, data), output);
});
test('An empty calendar has a readable summary without inventing a peak', () => {
  const empty = structuredClone(data);
  for (const day of empty.days) { day.count = 0; day.level = 0; }
  const output = updateCaption(readme, empty);
  assert.equal(output, `Original description\n<!-- contribution-summary:start -->\n**0 contributions** · **0 active days**<br />\nVisible calendar: ${empty.range.start} — ${empty.range.end}.<br />\nNo active days in this calendar.\n<!-- contribution-summary:end -->\nOriginal project links`);
  assert.doesNotMatch(output, /Peak:/);
  assert.equal(updateCaption(output, empty), output);
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
