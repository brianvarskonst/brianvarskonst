#!/usr/bin/env node
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const USERNAME = 'brianvarskonst';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const WIDTH = 1200;
export const HEIGHT = 500;
const DAY_MS = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const OUTPUTS = ['data/contributions.json', 'assets/contribution-city-dark.svg', 'assets/contribution-city-light.svg', 'assets/header-dark.svg', 'assets/header-light.svg'];
const THEMES = {
  dark: { background: '#0d1117', text: '#f0f6fc', muted: '#919ca9', line: '#263340', ground: '#18232d', groundEdge: '#263644', accent: '#55c6c1', roof: ['#367d82', '#449f9e', '#55bdb4', '#76dbca'], left: ['#204952', '#28666a', '#337c79', '#41988e'], right: ['#2a5e67', '#328181', '#409d96', '#58b8aa'], window: '#a2ede0' },
  light: { background: '#ffffff', text: '#202b36', muted: '#576674', line: '#dce5eb', ground: '#edf2f5', groundEdge: '#d2dde4', accent: '#087f7c', roof: ['#81b6ba', '#60a9a8', '#3d9992', '#21877c'], left: ['#4e808a', '#3b7b80', '#2b726e', '#1d655e'], right: ['#63959e', '#4b9395', '#36877e', '#27796d'], window: '#c4e5dd' },
};

function fail(message) { throw new Error(message); }

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

function decodeHtml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    if (code.startsWith('#')) {
      const numeric = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 0x10ffff) fail('Invalid HTML entity.');
      return String.fromCodePoint(numeric);
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[code.toLowerCase()] ?? entity;
  });
}

function attributes(tag) {
  const result = new Map();
  for (const match of tag.matchAll(/\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1].toLowerCase();
    if (result.has(name)) fail(`Duplicate HTML attribute: ${name}.`);
    result.set(name, decodeHtml(match[2] ?? match[3]));
  }
  return result;
}

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`Invalid date: ${value}.`);
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) fail(`Invalid date: ${value}.`);
  return milliseconds;
}

function validUsername(username) {
  if (typeof username !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username) || username.includes('--')) fail('Invalid GitHub username.');
}

export function contributionSource(username = USERNAME) {
  validUsername(username);
  return `https://github.com/users/${username}/contributions`;
}

export function validateContributionData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) fail('Unsupported contribution data format.');
  validUsername(data.username);
  if (data.source !== contributionSource(data.username)) fail('Contribution source does not match the username.');
  if (!Array.isArray(data.days) || data.days.length < 365 || data.days.length > 372) fail('Expected a full annual calendar of 365–372 days.');
  if (!data.range || typeof data.range !== 'object') fail('Missing calendar range.');
  const start = dateValue(data.range.start);
  const end = dateValue(data.range.end);
  if (new Date(start).getUTCDay() !== 0) fail('The contribution calendar must begin on Sunday.');
  if (end - start !== (data.days.length - 1) * DAY_MS) fail('Calendar bounds do not match the number of days.');
  let total = 0;
  for (let index = 0; index < data.days.length; index++) {
    const day = data.days[index];
    if (!day || typeof day !== 'object' || Array.isArray(day)) fail(`Invalid day at index ${index}.`);
    if (dateValue(day.date) !== start + index * DAY_MS) fail(`Calendar has a duplicate, gap, or out-of-order date at ${day.date}.`);
    if (!Number.isSafeInteger(day.count) || day.count < 0) fail(`Invalid contribution count at ${day.date}.`);
    if (!Number.isInteger(day.level) || day.level < 0 || day.level > 4) fail(`Invalid contribution level at ${day.date}.`);
    if ((day.count === 0) !== (day.level === 0)) fail(`Contribution count and level disagree at ${day.date}.`);
    total += day.count;
    if (!Number.isSafeInteger(total)) fail('Contribution total exceeds the safe integer range.');
  }
  return data;
}

function parseTooltip(body, date) {
  const label = decodeHtml(body.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const match = /^(No contributions|([1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+) (contribution|contributions)) on ([A-Z][a-z]+) (\d{1,2})(st|nd|rd|th)\.$/.exec(label);
  if (!match) fail(`Unrecognized contribution tooltip at ${date}: ${label}.`);
  const count = match[1] === 'No contributions' ? 0 : Number(match[2].replaceAll(',', ''));
  if (!Number.isSafeInteger(count) || (count === 1 ? match[3] !== 'contribution' : count > 1 && match[3] !== 'contributions')) fail(`Invalid tooltip count at ${date}.`);
  const parsedDate = new Date(dateValue(date));
  const day = parsedDate.getUTCDate();
  const ordinal = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th');
  if (match[4] !== MONTHS[parsedDate.getUTCMonth()] || Number(match[5]) !== day || match[6] !== ordinal) fail(`Tooltip date does not match calendar cell ${date}.`);
  return count;
}

export function parseContributionCalendar(html, username = USERNAME) {
  validUsername(username);
  if (typeof html !== 'string' || html.length > 2_000_000) fail('Invalid or oversized calendar response.');
  const cells = new Map();
  const dates = new Set();
  for (const match of html.matchAll(/<td\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (!attrs.has('data-date') && !attrs.get('class')?.split(/\s+/).includes('ContributionCalendar-day')) continue;
    const date = attrs.get('data-date');
    dateValue(date);
    const id = attrs.get('id');
    const level = attrs.get('data-level');
    if (!id || !/^contribution-day-component-\d+-\d+$/.test(id) || !/^[0-4]$/.test(level ?? '')) fail(`Invalid calendar cell at ${date}.`);
    if (cells.has(id) || dates.has(date)) fail(`Duplicate calendar cell at ${date}.`);
    cells.set(id, { date, level: Number(level) });
    dates.add(date);
  }
  if (cells.size === 0) fail('No contribution calendar cells found.');
  const counts = new Map();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip\s*>/gi)) {
    const attrs = attributes(`<tool-tip ${match[1]}>`);
    const target = attrs.get('for');
    if (!target?.startsWith('contribution-day-component-')) continue;
    if (!cells.has(target)) fail(`Tooltip references an unknown calendar cell: ${target}.`);
    if (counts.has(target)) fail(`Duplicate tooltip for ${target}.`);
    counts.set(target, parseTooltip(match[2], cells.get(target).date));
  }
  const days = [...cells.entries()].map(([id, cell]) => {
    if (!counts.has(id)) fail(`Missing tooltip for ${cell.date}.`);
    return { date: cell.date, count: counts.get(id), level: cell.level };
  }).sort((left, right) => left.date.localeCompare(right.date, 'en'));
  const data = validateContributionData({ version: 1, username, range: { start: days[0].date, end: days.at(-1).date }, source: contributionSource(username), days });
  const summaries = [...html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2\s*>/gi)]
    .filter(match => attributes(`<h2 ${match[1]}>`).get('id') === 'js-contribution-activity-description');
  if (summaries.length !== 1) fail('Missing or duplicate contribution total heading.');
  const summary = decodeHtml(summaries[0][2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const totalMatch = /^(0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+) (contribution|contributions) in the last year$/.exec(summary);
  if (!totalMatch) fail('Unrecognized contribution total heading.');
  const total = Number(totalMatch[1].replaceAll(',', ''));
  if (!Number.isSafeInteger(total) || (total === 1 ? totalMatch[2] !== 'contribution' : totalMatch[2] !== 'contributions')) fail('Invalid contribution total heading.');
  if (total !== data.days.reduce((sum, day) => sum + day.count, 0)) fail('Calendar contribution sum does not match the GitHub total.');
  return data;
}

export async function fetchContributions(username = USERNAME, fetchImpl = globalThis.fetch, sleepImpl = milliseconds => new Promise(resolveSleep => setTimeout(resolveSleep, milliseconds))) {
  const source = contributionSource(username);
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetchImpl(source, { headers: { Accept: 'text/html', 'User-Agent': 'brianvarskonst-profile-generator' }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
    } catch (error) {
      if (attempt === 1) throw error;
      await sleepImpl(600);
      continue;
    }
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 2000) : 600;
      try { await response.body?.cancel(); } catch { /* A failed response body is already being discarded. */ }
      await sleepImpl(delay);
      continue;
    }
    break;
  }
  if (!response.ok) fail(`GitHub contribution request failed: HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) fail('GitHub returned an unexpected content type.');
  const data = parseContributionCalendar(await response.text(), username);
  if (dateValue(data.range.end) > Date.now() + DAY_MS) fail('GitHub returned a contribution calendar ending in the future.');
  return data;
}

export function buildingHeight(count, maximum) {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(maximum) || maximum < count) fail('Invalid height inputs.');
  return count === 0 ? 0 : Number((18 + 90 * Math.sqrt(count / maximum)).toFixed(2));
}

function point(x, y) { return [Number(x.toFixed(2)), Number(y.toFixed(2))]; }
function pointsToString(points) { return points.map(pair => pair.join(',')).join(' '); }

export function cityGeometry(data) {
  validateContributionData(data);
  const maximum = Math.max(...data.days.map(day => day.count));
  return data.days.map((day, index) => {
    const week = Math.floor(index / 7);
    const weekday = index % 7;
    const x = 154 + week * 18 - weekday * 12;
    const y = 245 + week * 1.5 + weekday * 8.4;
    const height = buildingHeight(day.count, maximum);
    const ground = [point(x, y), point(x + 15.2, y + 1.5), point(x + 5, y + 8.1), point(x - 10.2, y + 6.6)];
    const roof = ground.map(([px, py]) => point(px, py - height));
    const left = [roof[3], roof[2], ground[2], ground[3]];
    const right = [roof[2], roof[1], ground[1], ground[2]];
    for (const [px, py] of [...ground, ...roof, ...left, ...right]) {
      if (px < 48 || px > WIDTH - 48 || py < 120 || py > HEIGHT - 100) fail(`City geometry exceeds the drawing bounds at ${day.date}.`);
    }
    return { day, week, weekday, height, ground, roof, left, right };
  });
}

function svgStart(height, title, description, theme) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title description">\n<title id="title">${escapeXml(title)}</title>\n<desc id="description">${escapeXml(description)}</desc>\n<rect width="${WIDTH}" height="${height}" rx="12" fill="${theme.background}"/>\n`;
}

export function renderCity(data, mode) {
  validateContributionData(data);
  const theme = THEMES[mode];
  if (!theme) fail(`Unknown theme: ${mode}.`);
  const geometry = cityGeometry(data);
  const total = data.days.reduce((sum, day) => sum + day.count, 0);
  const active = data.days.filter(day => day.count > 0).length;
  const formattedTotal = total.toLocaleString('en-US');
  const description = `${data.username}'s visible GitHub contribution calendar, ${data.range.start} to ${data.range.end}: ${formattedTotal} contributions across ${active} active days. The public calendar can include anonymized private contributions when the profile owner enables them. Each plot represents one date; building height follows its contribution count, and empty plots represent zero contributions. Colors follow GitHub's daily activity levels. This records contribution activity, not productivity or quality.`;
  let svg = svgStart(HEIGHT, `A year of building — ${data.username}`, description, theme);
  svg += `<g font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">\n<rect x="48" y="44" width="4" height="30" rx="2" fill="${theme.accent}"/>\n<text x="68" y="68" fill="${theme.text}" font-size="30" font-weight="600">A year of building</text>\n<text x="68" y="94" fill="${theme.muted}" font-size="15">Visible contribution history · ${escapeXml(data.username)}</text>\n`;
  svg += '<g stroke-linejoin="round">\n';
  // Ground first, then buildings from the back row to the front row for correct occlusion.
  for (const { ground } of geometry) svg += `<polygon points="${pointsToString(ground)}" fill="${theme.ground}" stroke="${theme.groundEdge}" stroke-width="0.55"/>\n`;
  for (const building of [...geometry].sort((a, b) => a.weekday - b.weekday || a.week - b.week)) {
    const { day, height, roof, left, right, ground } = building;
    svg += `<g data-date="${day.date}" data-count="${day.count}"><title>${day.date}: ${day.count} ${day.count === 1 ? 'contribution' : 'contributions'}</title>`;
    if (height === 0) {
      svg += `<polygon points="${pointsToString(ground)}" fill="${theme.ground}" stroke="${theme.groundEdge}" stroke-width="0.55"/>`;
    } else {
      const level = day.level - 1;
      svg += `<polygon points="${pointsToString(left)}" fill="${theme.left[level]}"/><polygon points="${pointsToString(right)}" fill="${theme.right[level]}"/><polygon points="${pointsToString(roof)}" fill="${theme.roof[level]}"/>`;
      for (let floor = 14; floor < height - 9; floor += 18) {
        svg += `<path d="M${pointsToString([point(ground[3][0] + 1.7, ground[3][1] - floor), point(ground[2][0] - 1.6, ground[2][1] - floor)]).replace(' ', 'L')}" fill="none" stroke="${theme.window}" stroke-width="0.75" opacity="0.35"/>`;
      }
    }
    svg += '</g>\n';
  }
  svg += '</g>\n';
  for (const { day, week } of geometry.filter(({ day }) => day.date.endsWith('-01'))) {
    const month = MONTHS[new Date(dateValue(day.date)).getUTCMonth()].slice(0, 3);
    svg += `<text x="${154 + week * 18}" y="417" fill="${theme.muted}" font-size="12" text-anchor="middle">${month}</text>\n`;
  }
  svg += `<path d="M48 438H1152" stroke="${theme.line}"/>\n<text x="48" y="468" fill="${theme.text}" font-size="16" font-weight="500">${formattedTotal} contributions<tspan fill="${theme.muted}" font-weight="400"> · ${active} active days</tspan></text>\n<text x="1152" y="468" fill="${theme.muted}" font-size="14" text-anchor="end">${data.range.start} — ${data.range.end}</text>\n</g>\n</svg>\n`;
  return svg;
}

export function renderHeader(mode) {
  const theme = THEMES[mode];
  if (!theme) fail(`Unknown theme: ${mode}.`);
  let svg = svgStart(192, 'Brian Schäffner', 'Technical Leadership · Backend Architecture · Platform Engineering. An original three-layer architectural stack accompanies the name.', theme);
  svg += `<g font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">\n<rect x="48" y="47" width="4" height="96" rx="2" fill="${theme.accent}"/>\n<text x="70" y="94" fill="${theme.text}" font-size="56" font-weight="600" letter-spacing="-1.5">Brian Schäffner</text>\n<text x="72" y="135" fill="${theme.muted}" font-size="20">Technical Leadership · Backend Architecture · Platform Engineering</text>\n</g>\n<g stroke="${theme.accent}" stroke-width="1.5" stroke-linejoin="round">\n`;
  for (const offset of [42, 21, 0]) {
    svg += `<path d="M1030 ${43 + offset}L1118 ${71 + offset}L1067 ${94 + offset}L979 ${66 + offset}Z" fill="${theme.ground}"/><path d="M979 ${66 + offset}V${75 + offset}L1067 ${103 + offset}L1118 ${80 + offset}V${71 + offset}M1067 ${94 + offset}V${103 + offset}" fill="none" opacity="0.5"/>\n`;
  }
  return `${svg}</g>\n</svg>\n`;
}

export function renderOutputs(data) {
  validateContributionData(data);
  return new Map([
    [OUTPUTS[0], `${JSON.stringify(data, null, 2)}\n`],
    [OUTPUTS[1], renderCity(data, 'dark')],
    [OUTPUTS[2], renderCity(data, 'light')],
    [OUTPUTS[3], renderHeader('dark')],
    [OUTPUTS[4], renderHeader('light')],
  ]);
}

export async function writeOutputsAtomically(outputs, root = ROOT, io = { readFile, writeFile, mkdir, rename, unlink }) {
  const transaction = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const prepared = [];
  const committed = [];
  try {
    // Stage every validated output before replacing any existing file.
    for (const [relative, content] of outputs) {
      if (!OUTPUTS.includes(relative)) fail(`Unexpected output path: ${relative}.`);
      const destination = resolve(root, relative);
      await io.mkdir(dirname(destination), { recursive: true });
      let previous;
      try { previous = await io.readFile(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const temporary = `${destination}.${transaction}.tmp`;
      prepared.push({ destination, temporary, previous });
      await io.writeFile(temporary, content, { flag: 'wx' });
    }
    for (const entry of prepared) {
      await io.rename(entry.temporary, entry.destination);
      committed.push(entry);
    }
  } catch (error) {
    const restorationErrors = [];
    for (const entry of committed.reverse()) {
      try {
        if (entry.previous === undefined) await io.unlink(entry.destination);
        else {
          await io.writeFile(entry.temporary, entry.previous);
          await io.rename(entry.temporary, entry.destination);
        }
      } catch (restorationError) { restorationErrors.push(restorationError); }
    }
    if (restorationErrors.length) throw new AggregateError([error, ...restorationErrors], 'Output write failed and rollback was incomplete.');
    throw error;
  } finally {
    await Promise.all(prepared.map(async ({ temporary }) => {
      try { await io.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }));
  }
}

export async function runCli(args = process.argv.slice(2), root = ROOT, fetchImpl = globalThis.fetch) {
  const check = args.includes('--check');
  const fromIndex = args.indexOf('--from-file');
  const fromFile = fromIndex >= 0 ? args[fromIndex + 1] : null;
  const allowed = new Set(check ? ['--check'] : []);
  if (fromIndex >= 0) {
    if (!fromFile || fromFile.startsWith('--')) fail('--from-file requires a JSON path.');
    allowed.add('--from-file');
    allowed.add(fromFile);
  }
  if (args.some(argument => !allowed.has(argument)) || args.filter(argument => argument === '--check').length > 1 || args.filter(argument => argument === '--from-file').length > 1) fail('Usage: node tools/profile/generate.mjs [--from-file data/contributions.json] [--check]');
  const data = check || fromFile
    ? validateContributionData(JSON.parse(await readFile(resolve(root, fromFile ?? OUTPUTS[0]), 'utf8')))
    : await fetchContributions(USERNAME, fetchImpl);
  if (data.username !== USERNAME) fail(`Expected contribution data for ${USERNAME}.`);
  const outputs = renderOutputs(data);
  if (check) {
    for (const [relative, expected] of outputs) {
      const actual = await readFile(resolve(root, relative), 'utf8');
      if (actual !== expected) fail(`Cached output is missing, corrupted, or out of date: ${relative}.`);
    }
    return `Verified ${data.days.length} calendar days and all four deterministic SVG assets.`;
  }
  await writeOutputsAtomically(outputs, root);
  return `Generated ${data.days.length} days, ${data.days.reduce((sum, day) => sum + day.count, 0).toLocaleString('en-US')} contributions, ${data.range.start} to ${data.range.end}.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().then(message => console.log(message)).catch(error => {
    console.error(`Profile generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
