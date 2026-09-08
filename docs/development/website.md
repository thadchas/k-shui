# Website and documentation

The public project website is hosted at <https://thadchas.github.io/k-shui/>.
The landing page and searchable user guides are built as one static Astro
Starlight site. No application backend is required to serve the website.

## Edit and preview

Use Node.js 24 LTS and npm:

```bash
cd site
npm ci
npm run dev
```

Open the local URL printed by Astro, including the `/k-shui/` base path.
Edit the landing page in `site/index.html` and its images in `site/assets/`.
Edit guides in `docs/`; do not edit generated files in `site/src/content/docs/`,
`site/src/pages/index.html`, or `site/public/`. Restart the development command
after changing source guides or the landing page to regenerate those files.

The content preparation script publishes the root guides explicitly listed in
`site/scripts/site-settings.mjs`, plus Markdown files in `docs/features/`,
`docs/deployment/`, and `docs/development/`. New guides need an initial `# Title`.
Root-level planning and review documents are not automatically published.
The build adds page metadata, section indexes, and source editing links.

Relative Markdown links are translated into website links when their targets
are published guides. Links to other repository files stay on GitHub. Code
samples are not rewritten. Documentation screenshots stay in `docs/images/`.

## Validate and publish

```bash
cd site
npm run build
npm run preview
```

The build verifies generated internal page links, heading anchors, image and
script URLs, and the Pagefind search bundle under the project base path.
Search is indexed during the production build; use the production preview
to check search.

The `website` GitHub Actions workflow builds relevant pull requests. When
website or guide changes reach `main`, it builds and deploys the validated
output through the `github-pages` environment. It also supports manual runs
from the Actions tab; only `main` can deploy. Deployment requires Pages to
use **GitHub Actions** as its source in repository **Settings → Pages**.

If a deployment fails, inspect the website workflow logs. A build or link
validation failure prevents publication. Revert the faulty change through a
pull request, or rerun the workflow after correcting it.

## Custom domain

The default origin and base path are `https://thadchas.github.io` and `/k-shui/`.
For a future custom domain, configure and verify the domain and HTTPS in
GitHub Pages settings, then set `SITE_URL` to its HTTPS origin and `SITE_BASE`
to `/` in the build environment. Run the build and link checks with those
values before deployment. Domain registration is separate from Pages hosting.

See [Astro's GitHub Pages guide](https://docs.astro.build/en/guides/deploy/github/)
and [Starlight documentation](https://starlight.astro.build/).
