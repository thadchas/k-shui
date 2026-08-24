# k-shui Design System — "Current"

Modern SaaS aesthetic in the spirit of Linear / Vercel / Resend / Stripe dashboards.
**Not purple.** Brand is **ocean teal** on neutral **slate** surfaces, with restrained
semantic colors. Dense-but-airy data UI: tables, stat tiles, charts, drawers.

## Tokens (Tailwind v4 `@theme` in `src/styles/globals.css`, CSS variables switch on `.dark`)

| token | light | dark | use |
|---|---|---|---|
| `--background` | `#F8FAFC` (slate-50) | `#0B1220` | page |
| `--surface` | `#FFFFFF` | `#111A2B` | cards, sidebar |
| `--surface-2` | `#F1F5F9` | `#172238` | table header, hover rows, inputs |
| `--border` | `#E2E8F0` | `#22304A` | 1px hairlines |
| `--foreground` | `#0F172A` | `#E6EDF7` | primary text |
| `--muted` | `#64748B` | `#8B9BB4` | secondary text |
| `--primary` | `#0D9488` (teal-600) | `#2DD4BF` (teal-400) | actions, links, active nav, focus ring |
| `--primary-foreground` | `#FFFFFF` | `#062A27` | text on primary |
| `--accent` | `#0EA5E9` (sky-500) | `#38BDF8` | secondary highlights, chart series 2 |
| `--success` | `#059669` | `#34D399` | healthy/running |
| `--warning` | `#D97706` | `#FBBF24` | degraded/lag |
| `--danger` | `#E11D48` | `#FB7185` | failed/offline |
| `--info` | `#2563EB` | `#60A5FA` | informational |
| radius | `--radius: 10px` (cards 12px, inputs/buttons 8px, pills full) | | |
| shadow | `0 1px 2px rgb(15 23 42 / .06), 0 1px 3px rgb(15 23 42 / .08)`; dark: subtle inset border instead of shadow | | |

Chart palette (ordered, colorblind-safe, never purple): `#14B8A6 #0EA5E9 #F59E0B #F43F5E #22C55E #6366F1→NO use #3B82F6 #A3E635 #F97316 #06B6D4 #EAB308`.

Typography: **Inter Variable** (UI, via `@fontsource-variable/inter`), **JetBrains Mono Variable** (code, ids, offsets, JSON).
Scale: 12/13/14 (body 14px/20px), 16 semibold section titles, 20/24 page titles, 28–32 hero numbers (tabular-nums).

## Layout
- **AppShell**: left sidebar 248px (collapsible to 64px icon rail; persisted in localStorage) with cluster switcher at top, grouped nav (Cluster · Streaming · Governance · Observability · Admin), bottom: theme toggle, user, version.
- **Topbar** 56px: breadcrumbs, global search / command palette (⌘K), alerts bell with count, refresh interval selector (off/5s/30s/1m), time-range picker where relevant.
- **Content**: max-width 1600px, padding 24px, page header (title + description + primary actions right), then content. Tabs use underline style.
- Cards: `surface` bg, 1px `border`, radius 12, padding 20. Stat tile: label (muted, 12px uppercase tracking-wide), value (28px semibold tabular), delta/sparkline, status dot.
- Tables (`DataTable`, TanStack Table): sticky header, 40px rows, zebra-less, hover `surface-2`, right-aligned numerics in mono, column sort, column visibility, global filter, server pagination, row click → detail, row actions in kebab. Virtualized when > 200 rows.
- Status pill: dot + text (`online/running`=success, `degraded/paused/lagging`=warning, `offline/failed`=danger, `unknown`=muted).
- Drawers (right, 520px) for quick detail/edit; Dialogs for confirmations (destructive = danger button + type-to-confirm name).
- Forms: react-hook-form + zod; labels above inputs; helper text; inline errors; key/value editor for configs; JSON/SQL editors via Monaco (`@monaco-editor/react`), lazy-loaded.
- Charts: Recharts, 1.5px lines, gradient area fill 12% opacity, minimal grid (dashed border color), tooltips in surface card, legend inline top-right. Units formatted (B/s, KB/s, msg/s, ms).
- Lineage: React Flow (`@xyflow/react`) with custom node cards per type (icon, label, namespace pill, status dot), smooth-step edges, minimap, controls, dagre auto-layout, click → side panel.
- Motion: 150ms ease-out transitions; skeleton loaders (`animate-pulse`), no spinners on page loads.
- Empty states: icon in soft primary circle, title, description, primary CTA.
- Accessibility: WCAG AA contrast, focus-visible rings (`primary` 2px offset), Radix primitives for a11y, keyboard-navigable tables.
- Icons: `lucide-react` 16px inline / 20px nav.

## Components (`src/components/ui`, shadcn-style API, built on Radix)
button (variants: default, secondary, outline, ghost, destructive, link; sizes sm/md/lg/icon), input, textarea, select, combobox, checkbox, switch, radio-group, label, form, badge, status-pill, tooltip, popover, dropdown-menu, context-menu, dialog, alert-dialog, sheet(drawer), tabs, card, stat-card, table, data-table, pagination, skeleton, separator, scroll-area, command (⌘K), toast (sonner), breadcrumb, kbd, code-block, json-viewer, key-value-editor, time-range-picker, refresh-picker, copy-button, empty-state, error-state, page-header, resizable panels.
