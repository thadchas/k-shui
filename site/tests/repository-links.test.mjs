import assert from 'node:assert/strict';
import test from 'node:test';
import { repositoryLinks } from '../scripts/repository-links.mjs';
import { repository, siteBase } from '../scripts/site-settings.mjs';

function transform(node, source = 'docs/features/topics.md') {
  const tree = { type: 'root', children: [node] };
  repositoryLinks()(tree, { path: `/checkout/site/src/content/docs/${source}` });
  return tree.children[0];
}

test('nested guide links preserve heading fragments and resolve under the Pages base', () => {
  assert.equal(transform({ type: 'link', url: '../deployment/docker.md#configuration' }).url,
    `${siteBase}docs/deployment/docker/#configuration`);
  assert.equal(transform({ type: 'link', url: '../README.md' }).url, `${siteBase}docs/`);
  assert.equal(transform({ type: 'link', url: 'features/' }, 'docs/index.md').url,
    `${siteBase}docs/features/`);
});

test('images and reference definitions resolve from the original repository source', () => {
  assert.equal(transform({ type: 'image', url: '../images/topics.png' }).url,
    `${siteBase}docs/images/topics.png`);
  assert.equal(transform({ type: 'definition', url: '../getting-started.md' }).url,
    `${siteBase}docs/getting-started/`);
});

test('repository-only documents remain GitHub links; external links and code are unchanged', () => {
  assert.equal(transform({ type: 'link', url: '../../ARCHITECTURE.md#clusters' }).url,
    `${repository}/blob/main/ARCHITECTURE.md#clusters`);
  assert.equal(transform({ type: 'link', url: '../product-improvement-plan.md' }).url,
    `${repository}/blob/main/docs/product-improvement-plan.md`);
  for (const url of ['https://example.com/docs.md', '#local-heading', 'mailto:example@example.com']) {
    assert.equal(transform({ type: 'link', url }).url, url);
  }
  const code = { type: 'code', lang: 'bash', value: 'cat ../deployment/docker.md' };
  assert.deepEqual(transform({ ...code }), code);
});

test('Mermaid source is safely escaped and remains readable without JavaScript', () => {
  const result = transform({ type: 'code', lang: 'mermaid', value: 'A["<example> & more"]' });
  assert.equal(result.type, 'html');
  assert.match(result.value, /&lt;example&gt; &amp; more/);
  assert.match(result.value, /data-mermaid-source/);
});
