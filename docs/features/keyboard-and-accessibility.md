# Keyboard, URLs & accessibility

## What it does

k-shui is meant to be driven from the keyboard during an incident, shared as
links in a chat, and usable with a screen reader or on a phone.

## Keyboard shortcuts

| Keys              | Action                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| `⌘K` / `Ctrl+K`   | Command palette — jump to topics, consumer groups, clusters, pages, tasks  |
| `?`               | Show the shortcuts dialog                                                  |
| `/`               | Focus the search box of the table on the current page                      |
| `⌘Enter`          | Run the current fetch / query (message browser, ksqlDB, Flink SQL, PromQL) |
| `Enter` / `Space` | Open the focused table row                                                 |
| `Esc`             | Close dialogs, drawers, and the palette                                    |

Shortcuts are ignored while typing in inputs, text areas, and code editors.

## Shareable URLs

Every list page keeps its state in the query string — search, sort, page,
page size, filters, the active tab — so a URL pasted into an incident channel
opens the same view (for example
`/c/prod/consumers?q=orders&sort=totalLag&order=desc`). Typing does not spam
browser history (the URL is replaced, not pushed). Message-browser tabs and
lineage focus/depth are in the URL as well.

## Tables

- Identity cells are real links: `⌘`/middle-click opens a topic, group,
  broker, connector, schema, or Flink job in a new tab.
- Rows are focusable (`Tab`) and activate with `Enter`/`Space`; sortable
  headers expose `aria-sort`; the row count is announced through a polite
  live region; every table has a screen-reader caption.

## Layout & motion

- Below the `md` breakpoint the sidebar becomes a drawer behind the menu
  button; the topbar keeps only the last breadcrumb.
- A _skip to content_ link is the first focusable element.
- `prefers-reduced-motion` disables the loading shimmer, spinners, and
  transitions.
- Light/dark/system theme, persisted per browser.

## Safety affordances that help the keyboard user

- Typed confirmations (`confirmText`) and acknowledgement checkboxes keep
  destructive actions from being triggered by an accidental `Enter`.
- Editors (connector config, schemas, SQL) block navigation with a _Discard
  unsaved changes?_ prompt while dirty.
