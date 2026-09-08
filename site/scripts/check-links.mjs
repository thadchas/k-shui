import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { siteBase, siteOrigin } from './site-settings.mjs';

const output = fileURLToPath(new URL('../dist/', import.meta.url));
const pages = new Map();
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(full);
    else if (entry.name.endsWith('.html')) {
      const links = [], ids = new Set();
      function visit(node) {
        // Starlight's special 404.html route has a synthetic /404/ canonical.
        // It is not a navigable link or a required asset.
        if (entry.name === '404.html' && node.tagName === 'link' &&
            node.attrs?.some(({ name, value }) => name === 'rel' && value === 'canonical')) return;
        for (const { name, value } of node.attrs || []) {
          if (name === 'id') ids.add(value);
          if (name === 'href' || name === 'src') links.push(value);
          if (name === 'srcset') links.push(...value.split(',').map((part) => part.trim().split(/\s+/)[0]));
        }
        for (const child of node.childNodes || []) visit(child);
      }
      visit(parse(await readFile(full, 'utf8')));
      pages.set(full, { links, ids });
    }
  }
}
await scan(output);
const failures = [];
for (const [file, { links }] of pages) {
  const relative = path.relative(output, file).replaceAll(path.sep, '/');
  const pageUrl = new URL(`${siteBase}${relative.replace(/index\.html$/, '')}`, siteOrigin);
  for (const link of links) {
    if (!link || /^(?:data:|mailto:|tel:|javascript:)/i.test(link)) continue;
    const target = new URL(link.replaceAll('&amp;', '&'), pageUrl);
    if (target.origin !== new URL(siteOrigin).origin) continue;
    if (!target.pathname.startsWith(siteBase)) {
      failures.push(`${relative}: outside base path: ${link}`);
      continue;
    }
    let local = path.join(output, decodeURIComponent(target.pathname.slice(siteBase.length)));
    try {
      if ((await stat(local)).isDirectory()) local = path.join(local, 'index.html');
      await stat(local);
      if (target.hash && pages.has(local) && !pages.get(local).ids.has(decodeURIComponent(target.hash.slice(1)))) {
        failures.push(`${relative}: missing fragment: ${link}`);
      }
    } catch {
      failures.push(`${relative}: missing asset or page: ${link}`);
    }
  }
}
for (const required of ['index.html', 'docs/getting-started/index.html', 'pagefind/pagefind.js']) {
  try { await stat(path.join(output, required)); }
  catch { failures.push(`Missing required output: ${required}`); }
}
if (failures.length) {
  console.error([...new Set(failures)].join('\n'));
  process.exit(1);
}
console.log(`Validated internal pages, fragments, and assets across ${pages.size} HTML pages, plus the search bundle.`);
