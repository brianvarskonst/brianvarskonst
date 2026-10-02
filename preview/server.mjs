import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, '.local');
await mkdir(out, { recursive: true });
const readme = await readFile(resolve(root, 'README.md'), 'utf8');
// Use GitHub's real renderer and sanitizer; this endpoint does not publish anything.
const html = execFileSync('gh', ['api', 'markdown', '--input', '-'], {
  input: JSON.stringify({ text: readme, mode: 'gfm', context: 'brianvarskonst/brianvarskonst' }),
  encoding: 'utf8', maxBuffer: 2_000_000,
});
await writeFile(resolve(out, 'github-rendered-readme.html'), html);

const page = `<!doctype html>
<html lang="en" data-color-mode="auto" data-light-theme="light" data-dark-theme="dark">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brian Schäffner · Local GitHub profile preview</title>
<link rel="stylesheet" href="/node_modules/@primer/css/dist/primer.css">
<link rel="stylesheet" href="/preview/preview.css">
</head><body>
<div class="preview-bar"><span>Local profile preview</span><span>GitHub Markdown · Primer CSS</span></div>
<main class="preview-main"><article class="markdown-body">${html}</article></main>
</body></html>`;
await writeFile(resolve(out, 'preview.html'), page);

const mime = { '.svg': 'image/svg+xml', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = pathname === '/' ? resolve(out, 'preview.html') : resolve(root, `.${pathname}`);
    const publicPath = ['assets', 'preview', 'node_modules/@primer/css/dist'].some(p => target.startsWith(resolve(root, p) + sep));
    if (pathname !== '/' && !publicPath) { res.writeHead(404).end(); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:4173'));
