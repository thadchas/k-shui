# k-shui Brand Guide

**k-shui** — Kafka Streaming Hub UI. "shui" (水) is Chinese for _water_: the brand is built on
flowing water and converging streams — data currents merging into one hub. The mark is a "K"
whose diagonal arms are flowing wave curves, with fainter stream trails echoing them, set on a
teal gradient tile.

## Logo files

| File                     | Use                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `logo.svg`               | Primary mark, 64×64. App icons, avatars, anywhere the tile fits.                                        |
| `logo-mark-mono.svg`     | Single-color mark (`currentColor`, transparent bg). Inline in docs/UI where it must inherit text color. |
| `logo-wordmark.svg`      | Mark + "k-shui" in dark slate text — for light backgrounds.                                             |
| `logo-wordmark-dark.svg` | Mark + "k-shui" in `#E6EDF7` text — for dark backgrounds.                                               |
| `og-image.png`           | 1200×630 social/OG card.                                                                                |
| `github-banner.png`      | Wide repo social banner (2:1).                                                                          |
| `hero-glow.png`          | Abstract hero background texture (no text, no logo).                                                    |

**Clear space:** keep at least 25% of the tile width empty around the mark.
**Minimum size:** 16×16 px for the mark (the favicon variant simplifies the curves slightly).

## Color palette

| Token                      | Hex                   | Use                                           |
| -------------------------- | --------------------- | --------------------------------------------- |
| Teal (primary, light mode) | `#0D9488`             | Primary actions, links, mark base             |
| Teal (dark-mode accent)    | `#2DD4BF`             | Accents on dark surfaces                      |
| Teal gradient              | `#14B8A6` → `#0D9488` | Logo tile, hero accents                       |
| Sky (accent)               | `#0EA5E9`             | Secondary accent, gradient pairings with teal |
| Slate background           | `#0B1220`             | Dark app/site background                      |
| Slate surface              | `#111A2B`             | Cards, panels on dark                         |
| Light text                 | `#E6EDF7`             | Text on dark backgrounds                      |
| Dark text                  | `#0F172A`             | Text on light backgrounds                     |

## Typography

- **UI / headings:** [Inter](https://rsms.me/inter/) — semibold (600) for the wordmark and headings.
- **Code / data:** [JetBrains Mono](https://www.jetbrains.com/lp/mono/).

## Do / Don't

**Do**

- Use the gradient tile mark on any background — it carries its own contrast.
- Use `logo-mark-mono.svg` when the mark must be a single color (inherit via `currentColor`, ideally teal `#0D9488`).
- Keep the flowing-wave arms intact — they are the water identity.

**Don't**

- **Never use purple** (or magenta/pink) anywhere in the brand. Teal, sky, and slate only.
- Don't recolor the mark's tile or the white K; don't add outlines, shadows-baked-in, or rotate it.
- Don't redraw the K with straight arms — the wave curves are the point.
- Don't set the wordmark in a different typeface or weight.
- Don't place the dark-text wordmark on dark backgrounds (use `logo-wordmark-dark.svg`).
