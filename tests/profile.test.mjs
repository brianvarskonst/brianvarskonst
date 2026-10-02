import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rename, unlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  USERNAME, contributionSource, parseContributionCalendar, validateContributionData,
  fetchContributions, buildingHeight, cityGeometry, escapeXml, renderCity,
  renderHeader, renderOutputs, writeOutputsAtomically, runCli, WIDTH, HEIGHT,
} from '../tools/profile/generate.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const START = Date.parse('2025-09-28T00:00:00Z');

function fixture(length = 370, allZero = false) {
  const days = Array.from({ length }, (_, index) => {
    const count = allZero || index % 9 === 0 ? 0 : index === 5 ? 1000 : index % 7 + 1;
    return { date: new Date(START + index * 86_400_000).toISOString().slice(0, 10), count, level: count === 0 ? 0 : count >= 5 ? 4 : count };
  });
  return { version: 1, username: USERNAME, source: contributionSource(), range: { start: days[0].date, end: days.at(-1).date }, days };
}

function calendarHtml(data = fixture()) {
  const cells = data.days.map((day, index) => {
    const date = new Date(`${day.date}T00:00:00Z`);
    const number = date.getUTCDate();
    const ordinal = number % 100 >= 11 && number % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[number % 10] ?? 'th');
    const label = day.count === 0 ? 'No contributions' : `${day.count.toLocaleString('en-US')} ${day.count === 1 ? 'contribution' : 'contributions'}`;
    const id = `contribution-day-component-${index % 7}-${Math.floor(index / 7)}`;
    return { index, cell: `<td class="ContributionCalendar-day" data-date="${day.date}" id="${id}" data-level="${day.level}"></td>`, tip: `<tool-tip id="tip-${index}" for="${id}">${label} on ${MONTHS[date.getUTCMonth()]} ${number}${ordinal}.</tool-tip>` };
  });
  // The real HTML calendar is ordered by weekday, rather than chronological order.
  cells.sort((a, b) => a.index % 7 - b.index % 7 || a.index - b.index);
  const total = data.days.reduce((sum, day) => sum + day.count, 0);
  return `<h2 id="js-contribution-activity-description">${total.toLocaleString('en-US')} ${total === 1 ? 'contribution' : 'contributions'} in the last year</h2><table>${cells.map(({ cell, tip }) => `${cell}${tip}`).join('\n')}</table>`;
}

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'profile-generator-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('parser reconstructs chronological annual calendar and exact linked counts', () => {
  const data = fixture();
  const actual = parseContributionCalendar(calendarHtml(data));
  assert.deepEqual(actual, data);
  assert.equal(actual.days.length, 370);
  assert.equal(actual.days[5].count, 1000);
  assert.equal(actual.days[7].count, 1);
  assert.equal(actual.days[0].count, 0);
  assert.equal(actual.days.reduce((sum, day) => sum + day.count, 0), data.days.reduce((sum, day) => sum + day.count, 0));
});

test('parser rejects missing, duplicate, unknown, and malformed tooltip links', () => {
  const html = calendarHtml();
  assert.throws(() => parseContributionCalendar(html.replace(/<tool-tip[^>]*>[\s\S]*?<\/tool-tip>/, '')), /Missing tooltip/);
  const tip = html.match(/<tool-tip[^>]*>[\s\S]*?<\/tool-tip>/)[0];
  assert.throws(() => parseContributionCalendar(`${html}${tip}`), /Duplicate tooltip/);
  assert.throws(() => parseContributionCalendar(html.replace('for="contribution-day-component-0-0"', 'for="contribution-day-component-0-999"')), /unknown calendar cell/);
  assert.throws(() => parseContributionCalendar(html.replace('No contributions on September 28th.', 'Several contributions on September 28th.')), /Unrecognized contribution tooltip/);
  assert.throws(() => parseContributionCalendar(html.replace('No contributions on September 28th.', 'No contributions on September 27th.')), /Tooltip date/);
  assert.throws(() => parseContributionCalendar(html.replace('1 contribution on', '1 contributions on')), /Invalid tooltip count/);
  assert.throws(() => parseContributionCalendar(html.replace('1,000 contributions', '1,00 contributions')), /Unrecognized contribution tooltip/);
});

test('parser rejects changed or incomplete cell shapes instead of guessing counts', () => {
  const html = calendarHtml();
  assert.throws(() => parseContributionCalendar('<html>Sign in to continue</html>'), /No contribution calendar/);
  assert.throws(() => parseContributionCalendar(html.replace('data-date="2025-09-28"', '')), /Invalid date/);
  assert.throws(() => parseContributionCalendar(html.replace('data-level="0"', '')), /Invalid calendar cell/);
  assert.throws(() => parseContributionCalendar(html.replace('data-level="0"', 'data-level="5"')), /Invalid calendar cell/);
  assert.throws(() => parseContributionCalendar(html.replace('data-date="2025-09-28"', 'data-date="2025-09-28" data-date="2025-09-29"')), /Duplicate HTML attribute/);
  assert.throws(() => parseContributionCalendar(html.replace('data-date="2025-09-29"', 'data-date="2025-09-28"')), /Duplicate calendar/);
  assert.throws(() => parseContributionCalendar(html.replace('id="contribution-day-component-1-0"', 'id="contribution-day-component-0-0"')), /Duplicate calendar/);
  assert.throws(() => parseContributionCalendar(html.replace('data-level="0"', 'data-level="1"')), /count and level disagree/);
});

test('parser verifies every daily count against GitHub annual total', () => {
  const html = calendarHtml();
  assert.throws(() => parseContributionCalendar(html.replace(/<h2[^>]*>.*?<\/h2>/, '')), /total heading/);
  assert.throws(() => parseContributionCalendar(html.replace(/<h2([^>]*)>.*?<\/h2>/, '<h2$1>9,999 contributions in the last year</h2>')), /sum does not match/);
  assert.throws(() => parseContributionCalendar(html.replace('in the last year', 'during this era')), /Unrecognized contribution total/);
});

test('calendar bounds allow complete final weeks and partial final weeks', () => {
  for (const length of [365, 366, 367, 368, 369, 370, 371, 372]) assert.equal(validateContributionData(fixture(length)).days.length, length);
  assert.throws(() => validateContributionData(fixture(364)), /365–372/);
  assert.throws(() => validateContributionData(fixture(373)), /365–372/);
});

test('validation rejects invalid dates, gaps, wrong metadata, levels, and unsafe counts', () => {
  const mutate = change => { const data = fixture(); change(data); return () => validateContributionData(data); };
  assert.throws(mutate(data => { data.days[1].date = '2025-02-30'; }), /Invalid date/);
  assert.throws(mutate(data => { data.days[1].date = data.days[0].date; }), /duplicate, gap/);
  assert.throws(mutate(data => { [data.days[1], data.days[2]] = [data.days[2], data.days[1]]; }), /out-of-order/);
  assert.throws(mutate(data => { data.range.end = '2026-10-03'; }), /bounds/);
  assert.throws(mutate(data => { data.range.start = '2025-09-29'; }), /Sunday/);
  assert.throws(mutate(data => { data.username = '<script>'; }), /username/);
  assert.throws(mutate(data => { data.source = 'https://example.com/'; }), /source/);
  assert.throws(mutate(data => { data.version = 2; }), /format/);
  for (const count of [-1, 0.1, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(mutate(data => { data.days[1].count = count; }), /count/);
  }
  assert.throws(mutate(data => { data.days[1].level = 5; }), /level/);
  assert.throws(mutate(data => { data.days[1].count = Number.MAX_SAFE_INTEGER; }), /total/);
});

test('height encodes counts monotonically within bounded drawing space', () => {
  assert.equal(buildingHeight(0, 100), 0);
  assert.equal(buildingHeight(100, 100), 108);
  assert.ok(buildingHeight(1, 100) < buildingHeight(10, 100));
  assert.ok(buildingHeight(10, 100) < buildingHeight(100, 100));
  assert.equal(buildingHeight(0, 0), 0);
  assert.throws(() => buildingHeight(10, 5), /height inputs/);
  assert.throws(() => buildingHeight(-1, 5), /height inputs/);
  for (const length of [365, 370, 372]) {
    const geometry = cityGeometry(fixture(length));
    assert.equal(geometry.length, length);
    for (const building of geometry) {
      for (const [x, y] of [...building.roof, ...building.ground, ...building.left, ...building.right]) {
        assert.ok(x >= 48 && x <= WIDTH - 48, `${building.day.date}: x=${x}`);
        assert.ok(y >= 110 && y <= HEIGHT - 50, `${building.day.date}: y=${y}`);
      }
    }
  }
});

test('both themes contain real accessible records and are deterministic self-contained SVGs', () => {
  const data = fixture();
  for (const mode of ['dark', 'light']) {
    const svg = renderCity(data, mode);
    assert.equal(svg, renderCity(structuredClone(data), mode));
    assert.equal([...svg.matchAll(/data-date="/g)].length, 370);
    assert.match(svg, /A year of building/);
    assert.match(svg, /Visible contribution history/);
    assert.match(svg, /anonymized private contributions/);
    assert.match(svg, /2025-09-28 to 2026-10-02/);
    assert.match(svg, /contributions.*active days/);
    assert.match(svg, /<title>2025-10-03: 1000 contributions<\/title>/);
    assert.match(svg, /aria-labelledby="title description"/);
    assert.match(svg, /not productivity or quality/);
    assert.doesNotMatch(svg, /<script|<foreignObject|<animate|<image|(?:href|src)\s*=|@font-face|<!DOCTYPE|<!ENTITY/i);
    assert.match(svg, /width="1200" height="410"/);
    const header = renderHeader(mode);
    assert.equal(header, renderHeader(mode));
    assert.match(header, /Brian Schäffner/);
    assert.match(header, /Technical Leadership · Backend Architecture · Platform Engineering/);
    assert.match(header, /width="1200" height="192"/);
    assert.doesNotMatch(header, /<script|<foreignObject|<animate|<image|(?:href|src)\s*=|@font-face/i);
  }
  assert.notEqual(renderCity(data, 'dark'), renderCity(data, 'light'));
  assert.throws(() => renderCity(data, 'unknown'), /Unknown theme/);
  assert.throws(() => renderHeader('unknown'), /Unknown theme/);
  assert.equal(escapeXml('<tag a="x">&\' '), '&lt;tag a=&quot;x&quot;&gt;&amp;&apos; ');
});

test('zero-contribution calendars render flat plots without NaN or raised buildings', () => {
  const data = fixture(370, true);
  assert.ok(cityGeometry(data).every(building => building.height === 0));
  for (const mode of ['dark', 'light']) {
    const svg = renderCity(data, mode);
    assert.match(svg, /0 contributions/);
    assert.match(svg, /0 active days/);
    assert.doesNotMatch(svg, /NaN|Infinity/);
    assert.equal([...svg.matchAll(/data-count="0"/g)].length, 370);
    assert.doesNotMatch(svg, /opacity="0.35"/);
  }
});

test('public fetch rejects HTTP failures, redirects, and incompatible response shapes', async () => {
  await assert.rejects(fetchContributions(USERNAME, async () => new Response('rate limited', { status: 429 }), async () => {}), /HTTP 429/);
  await assert.rejects(fetchContributions(USERNAME, async () => new Response('{}', { headers: { 'content-type': 'application/json' } })), /content type/);
  await assert.rejects(fetchContributions(USERNAME, async () => new Response('<html>sign in</html>', { headers: { 'content-type': 'text/html' } })), /No contribution calendar/);
  await assert.rejects(fetchContributions(USERNAME, async () => { throw new Error('offline'); }, async () => {}), /offline/);
  const data = await fetchContributions(USERNAME, async (url, options) => {
    assert.equal(url, 'https://github.com/users/brianvarskonst/contributions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(calendarHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  assert.deepEqual(data, fixture());
});

test('public fetch retries transient errors once with a bounded delay', async () => {
  for (const status of [429, 500, 503]) {
    let requests = 0;
    const delays = [];
    const data = await fetchContributions(USERNAME, async () => {
      if (++requests === 1) return new Response('retry', { status, headers: { 'retry-after': '9999' } });
      return new Response(calendarHtml(), { headers: { 'content-type': 'text/html' } });
    }, async delay => delays.push(delay));
    assert.equal(requests, 2);
    assert.deepEqual(delays, [2000]);
    assert.deepEqual(data, fixture());
  }
  let requests = 0;
  await assert.rejects(fetchContributions(USERNAME, async () => {
    requests++;
    return new Response('no access', { status: 403 });
  }, async () => { assert.fail('403 must not retry'); }), /HTTP 403/);
  assert.equal(requests, 1);
  let failures = 0;
  await assert.rejects(fetchContributions(USERNAME, async () => {
    failures++;
    throw new Error('network unavailable');
  }, async () => {}), /network unavailable/);
  assert.equal(failures, 2);
});

test('offline CLI regenerates and checks all cached assets, detecting corruption', async t => {
  const root = await temporaryRoot(t);
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(join(root, 'data/input.json'), JSON.stringify(fixture()));
  assert.match(await runCli(['--from-file', 'data/input.json'], root), /370 days/);
  assert.match(await runCli(['--check'], root), /four deterministic SVG/);
  const original = await readFile(join(root, 'assets/contribution-city-light.svg'), 'utf8');
  await writeFile(join(root, 'assets/contribution-city-light.svg'), `${original}corrupt`);
  await assert.rejects(runCli(['--check'], root), /corrupted/);
  await runCli(['--from-file', 'data/input.json'], root);
  assert.equal(await readFile(join(root, 'assets/contribution-city-light.svg'), 'utf8'), original);
  await assert.rejects(runCli(['--from-file'], root), /requires/);
  await assert.rejects(runCli(['--unknown'], root), /Usage/);
  await assert.rejects(runCli(['--check', '--check'], root), /Usage/);
});

test('fetch, parser, and invalid-file failures leave all existing output bytes unchanged', async t => {
  const root = await temporaryRoot(t);
  const outputs = renderOutputs(fixture());
  await writeOutputsAtomically(outputs, root);
  const assertUnchanged = async () => {
    for (const [file, content] of outputs) assert.equal(await readFile(join(root, file), 'utf8'), content);
  };
  await assert.rejects(runCli([], root, async () => { throw new Error('offline'); }), /offline/);
  await assertUnchanged();
  await assert.rejects(runCli([], root, async () => new Response('<html>changed shape</html>', { headers: { 'content-type': 'text/html' } })), /No contribution/);
  await assertUnchanged();
  await writeFile(join(root, 'invalid.json'), '{ broken');
  await assert.rejects(runCli(['--from-file', 'invalid.json'], root));
  await assertUnchanged();
  const invalidData = fixture();
  invalidData.days[1].count = -1;
  await writeFile(join(root, 'invalid.json'), JSON.stringify(invalidData));
  await assert.rejects(runCli(['--from-file', 'invalid.json'], root), /count/);
  await assertUnchanged();
});

test('transaction stages every output before replacing any file and cleans failed staging', async t => {
  const root = await temporaryRoot(t);
  const original = renderOutputs(fixture());
  const next = renderOutputs(fixture(370, true));
  await writeOutputsAtomically(original, root);
  let writes = 0;
  const io = { readFile, mkdir, rename, unlink, writeFile: async (...args) => {
    if (++writes === 3) throw new Error('disk full');
    return writeFile(...args);
  } };
  await assert.rejects(writeOutputsAtomically(next, root, io), /disk full/);
  for (const [file, content] of original) assert.equal(await readFile(join(root, file), 'utf8'), content);
  assert.ok((await readdir(join(root, 'assets'))).every(file => !file.endsWith('.tmp')));
  assert.ok((await readdir(join(root, 'data'))).every(file => !file.endsWith('.tmp')));
});

test('transaction restores already replaced outputs if a later rename fails', async t => {
  const root = await temporaryRoot(t);
  const original = renderOutputs(fixture());
  await writeOutputsAtomically(original, root);
  let renames = 0;
  const io = { readFile, mkdir, writeFile, unlink, rename: async (...args) => {
    if (++renames === 3) throw new Error('rename failed');
    return rename(...args);
  } };
  await assert.rejects(writeOutputsAtomically(renderOutputs(fixture(370, true)), root, io), /rename failed/);
  for (const [file, content] of original) assert.equal(await readFile(join(root, file), 'utf8'), content);
  assert.ok((await readdir(join(root, 'assets'))).every(file => !file.endsWith('.tmp')));
  assert.ok((await readdir(join(root, 'data'))).every(file => !file.endsWith('.tmp')));
});
