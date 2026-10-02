import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = execFileSync('git', ['show', 'e8110ab02ff4262ad1707078f6506039bf190178:README.md'], { cwd: root, encoding: 'utf8' });
const readme = await readFile(resolve(root, 'README.md'), 'utf8');
let narrative = readme;
for (const block of ['profile-header', 'contribution-city']) {
  narrative = narrative.replace(new RegExp(`<!-- ${block}:start -->[\\s\\S]*?<!-- ${block}:end -->\\n\\n`), '');
}
const oldIcons = baseline.match(/<p>\n  <img src="https:\/\/skillicons\.dev[^]*?<\/p>/)?.[0];
assert.ok(oldIcons, 'Original technology icon block must exist');
narrative = narrative.replace(/<!-- technology-icons:start -->[\s\S]*?<!-- technology-icons:end -->/, oldIcons);
assert.equal(narrative, baseline, 'Original profile description, tables, links and principles are preserved exactly');

const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const colorScheme of ['light', 'dark']) {
    for (const [device, width, height] of [['desktop', 1280, 1160], ['mobile', 390, 1000], ['small-mobile', 320, 900]]) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const failures = [];
      page.on('pageerror', e => failures.push(e.message));
      await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
      await page.locator('picture img').evaluateAll(imgs => Promise.all(imgs.map(img => img.decode())));
      const result = await page.evaluate(() => ({
        images: [...document.querySelectorAll('picture img')].map(i => {
          const source = [...i.parentElement.querySelectorAll('source')].find(s => matchMedia(s.media).matches);
          return { src: i.currentSrc, loaded: i.complete && i.naturalWidth > 0, alt: i.alt, source: source?.srcset, canonical: source?.getAttribute('data-canonical-src') };
        }),
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        overflow: document.documentElement.scrollWidth > innerWidth,
        headings: [...document.querySelectorAll('article h1, article h2, article h3')].map(h => h.textContent),
        tables: document.querySelectorAll('article table').length,
      }));
      assert.equal(result.images.length, 3);
      assert.ok(result.images.every(i => i.loaded && i.alt.length > 5));
      assert.ok(result.images[0].src.endsWith(`header-${colorScheme}.svg`));
      assert.ok(result.images[1].src.endsWith(`contribution-city-${colorScheme}.svg`));
      assert.equal(result.images[2].src, result.images[2].source);
      const icons = new URL(result.images[2].canonical);
      assert.equal(icons.searchParams.get('theme'), colorScheme);
      assert.equal(icons.searchParams.get('i').split(',').length, 25, 'GitHub must retain every technology icon in srcset');
      assert.equal(result.overflow, false, 'Profile must not overflow horizontally');
      assert.equal(result.bodyBackground, colorScheme === 'dark' ? 'rgb(13, 17, 23)' : 'rgb(255, 255, 255)', 'Primer must use the requested page theme');
      assert.equal(result.tables, 2);
      assert.ok(result.headings.includes('Technical Leadership & Platform Engineering'));
      assert.equal(failures.length, 0);
      await page.screenshot({ path: resolve(root, `.local/profile-${colorScheme}-${device}.png`), fullPage: false });
      checks.push({ colorScheme, device, width, ...result, errors: failures });
      await context.close();
    }
  }
  const page = await browser.newPage();
  for (const file of ['header-dark.svg', 'header-light.svg', 'contribution-city-dark.svg', 'contribution-city-light.svg']) {
    await page.goto(`http://127.0.0.1:4173/assets/${file}`);
    const bounds = await page.evaluate(() => {
      const svg = document.querySelector('svg');
      const box = svg.viewBox.baseVal;
      const clipped = [...svg.querySelectorAll('text, polygon, polyline, line, path')].filter(el => {
        const b = el.getBBox();
        return b.x < box.x - 1 || b.y < box.y - 1 || b.x + b.width > box.width + 1 || b.y + b.height > box.height + 1;
      }).map(el => { const b = el.getBBox(); return { tag: el.tagName, text: el.textContent.slice(0, 80), bounds: { x: b.x, y: b.y, width: b.width, height: b.height } }; });
      return { width: box.width, height: box.height, clipped, unsafe: svg.querySelectorAll('script, foreignObject, animate, animateTransform, image').length };
    });
    assert.deepEqual(bounds.clipped, [], `${file}: geometry and labels must stay inside viewBox`);
    assert.equal(bounds.unsafe, 0);
    checks.push({ file, ...bounds });
  }
} finally { await browser.close(); }
await writeFile(resolve(root, '.local/browser-checks.json'), JSON.stringify({ originalDescriptionPreserved: true, checks }, null, 2) + '\n');
console.log(`Passed: exact description preservation; 6 desktop/mobile theme checks; 4 SVG geometry checks. Screenshots: ${root}/.local/`);
