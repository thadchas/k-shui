import path from 'node:path';
import { guideDirectories, publishedPath, repository, siteBase } from './site-settings.mjs';

// Transform parsed Markdown links, never code samples or prose containing paths.
export function repositoryLinks() {
  return (tree, file) => {
    const marker = '/src/content/docs/';
    const generated = String(file.path).split(marker)[1];
    if (!generated) return;
    const source = generated === 'docs/index.md' ? 'docs/README.md' : generated;
    function visit(node) {
      if (node.type === 'code' && node.lang === 'mermaid') {
        const escaped = node.value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        node.type = 'html';
        node.value = `<pre data-mermaid-source><code>${escaped}</code></pre>`;
      }
      if (['link', 'image', 'definition'].includes(node.type) && node.url &&
          !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(node.url)) {
        const boundary = node.url.search(/[?#]/);
        const relative = boundary < 0 ? node.url : node.url.slice(0, boundary);
        const suffix = boundary < 0 ? '' : node.url.slice(boundary);
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(source), decodeURI(relative)));
        const published = publishedPath(target);
        if (published) node.url = `${siteBase}${published}${suffix}`;
        else if (guideDirectories.some((directory) => target.replace(/\/$/, '') === `docs/${directory}`)) {
          node.url = `${siteBase}${target.replace(/\/$/, '')}/${suffix}`;
        } else if (/^docs\/(images|brand)\//.test(target)) {
          node.url = `${siteBase}${target}${suffix}`;
        } else {
          node.url = `${repository}/${relative.endsWith('/') ? 'tree' : 'blob'}/main/${target}${suffix}`;
        }
      }
      for (const child of node.children || []) visit(child);
    }
    visit(tree);
  };
}
