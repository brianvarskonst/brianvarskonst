import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, validateContributionData } from '../tools/profile/generate.mjs';

export function updateCaption(readme, data) {
  validateContributionData(data);
  const start = '<!-- contribution-summary:start -->';
  const end = '<!-- contribution-summary:end -->';
  if (readme.split(start).length !== 2 || readme.split(end).length !== 2 || readme.indexOf(end) < readme.indexOf(start)) {
    throw new Error('README must contain exactly one ordered contribution summary block');
  }
  const total = data.days.reduce((sum, day) => sum + day.count, 0).toLocaleString('en-US');
  const active = data.days.filter(day => day.count > 0).length;
  const content = `${start}\n**${total} contributions** · **${active} active days**<br />\nVisible calendar: ${data.range.start} — ${data.range.end}.\n${end}`;
  return readme.slice(0, readme.indexOf(start)) + content + readme.slice(readme.indexOf(end) + end.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error('Usage: node scripts/update-caption.mjs [--check]');
  const file = resolve(ROOT, 'README.md');
  const readme = await readFile(file, 'utf8');
  const data = JSON.parse(await readFile(resolve(ROOT, 'data/contributions.json'), 'utf8'));
  const updated = updateCaption(readme, data);
  if (args[0] === '--check') {
    if (updated !== readme) throw new Error('Contribution summary does not match the validated calendar');
    console.log('Contribution summary matches validated calendar.');
  } else if (updated !== readme) {
    await writeFile(file, updated);
    console.log('Updated contribution summary; existing description preserved.');
  }
}
