import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import { siteBase, siteOrigin } from './scripts/site-settings.mjs';
import { repositoryLinks } from './scripts/repository-links.mjs';

export default defineConfig({
  site: siteOrigin,
  base: siteBase,
  trailingSlash: 'always',
  output: 'static',
  markdown: { processor: unified({ remarkPlugins: [repositoryLinks] }) },
  integrations: [
    starlight({
      title: 'k-shui',
      description: 'Open-source, agent-driven Kafka management with scoped investigations and human-reviewed operations.',
      logo: { src: './assets/mark-small.svg' },
      favicon: '/assets/logo.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/thadchas/k-shui' }],
      customCss: ['./src/styles/custom.css'],
      components: { Footer: './src/components/DocsFooter.astro' },
      sidebar: [
        { label: 'Home', link: '/' },
        { label: 'Start here', items: [
          { label: 'Documentation overview', slug: 'docs' },
          { label: 'Getting started', slug: 'docs/getting-started' },
          { label: 'k-shui Agent', slug: 'docs/k-shui-agent' },
          { label: 'Configuration', slug: 'docs/configuration' },
          { label: 'FAQ', slug: 'docs/faq' },
        ] },
        { label: 'Features', items: [{ autogenerate: { directory: 'docs/features' } }] },
        { label: 'Deployment', items: [{ autogenerate: { directory: 'docs/deployment' } }] },
        { label: 'Reference', items: [
          { label: 'REST API', slug: 'docs/api' },
          { label: 'Architecture', slug: 'docs/architecture' },
          { label: 'Comparison', slug: 'docs/comparison' },
          { label: 'Roadmap', slug: 'docs/roadmap' },
        ] },
        { label: 'Contributing', items: [{ autogenerate: { directory: 'docs/development' } }] },
      ],
    }),
  ],
});
