import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { guideDirectories, repository, rootGuides, siteBase, siteOrigin } from './site-settings.mjs';

const site = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(site, '..');
const generated = path.join(site, 'src/content/docs/docs');
await rm(path.join(site, 'src/content/docs'), { recursive: true, force: true });
await mkdir(generated, { recursive: true });

async function publish(relative) {
  const content = await readFile(path.join(root, 'docs', relative), 'utf8');
  const heading = content.match(/^# (.+)\r?\n/);
  if (!heading) throw new Error(`docs/${relative} needs an initial H1 title`);
  const metadata = {
    title: heading[1],
    editUrl: `${repository}/edit/main/docs/${relative}`,
  };
  const target = path.join(generated, relative === 'README.md' ? 'index.md' : relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `---\n${Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${content.slice(heading[0].length)}`);
  return heading[1];
}

for (const file of rootGuides) await publish(file);
for (const directory of guideDirectories) {
  const files = (await readdir(path.join(root, 'docs', directory))).filter((file) => file.endsWith('.md')).sort();
  const links = [];
  for (const file of files) links.push(`- [${await publish(`${directory}/${file}`)}](${file})`);
  const title = { features: 'Features', deployment: 'Deployment', development: 'Development' }[directory];
  await writeFile(path.join(generated, directory, 'index.md'), `---\ntitle: ${title}\neditUrl: false\nsidebar:\n  order: 0\n---\n\n${links.join('\n')}\n`);
}

await mkdir(path.join(site, 'src/pages'), { recursive: true });
const home = await readFile(path.join(site, 'index.html'), 'utf8');
await writeFile(path.join(site, 'src/pages/index.html'), home.replace('</head>', `<link rel="canonical" href="${new URL(siteBase, siteOrigin).href}">\n</head>`));
await rm(path.join(site, 'public'), { recursive: true, force: true });
await mkdir(path.join(site, 'public'), { recursive: true });
await cp(path.join(site, 'assets'), path.join(site, 'public/assets'), { recursive: true });
await cp(path.join(root, 'docs/images'), path.join(site, 'public/docs/images'), { recursive: true });
await cp(path.join(root, 'docs/brand'), path.join(site, 'public/docs/brand'), { recursive: true });
await writeFile(path.join(site, 'public/.nojekyll'), '');
console.log('Prepared landing page, user guides, and assets from repository sources.');
