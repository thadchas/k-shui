export const siteOrigin = process.env.SITE_URL || 'https://thadchas.github.io';
export const siteBase = `/${(process.env.SITE_BASE || '/k-shui/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
export const repository = 'https://github.com/thadchas/k-shui';

export const rootGuides = [
  'README.md', 'getting-started.md', 'configuration.md', 'faq.md',
  'api.md', 'architecture.md', 'comparison.md', 'roadmap.md', 'k-shui-agent.md',
];
export const guideDirectories = ['features', 'deployment', 'development'];

export function publishedPath(source) {
  if (source === 'docs/README.md') return 'docs/';
  const relative = source.replace(/^docs\//, '');
  if (source.startsWith('docs/') && (
    rootGuides.includes(relative) ||
    guideDirectories.some((directory) => relative.startsWith(`${directory}/`))
  ) && relative.endsWith('.md')) return `${source.slice(0, -3)}/`;
}
