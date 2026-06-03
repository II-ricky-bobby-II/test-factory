# The Local Cafe Migration Audit

Audit date: 2026-06-02.

Source basis: the normalized The Local Cafe branding pack in `/Users/blake/Downloads/the-local-cafe-branding-docs`.

## Summary

The existing repo design system described Test Factory as a rugged QA control room with dark grid paper, folder tabs, red cutout shadows, forest-green status labels, mono metadata, and old reference boards. That direction conflicts with The Local Cafe brand. The migration replaces those documents and token surfaces with an editorial cafe system based on Himalayan hospitality, Sikkim-to-Delhi origin storytelling, warm photography, PP Migra/Gilroy-style typography, off-white/black/taupe/clay color fields, visible construction grids, asymmetric collages, and quiet functional UI.

## Audit Table

| File or design area | Conflict found | Required change | Migration status |
|---|---|---|---|
| `docs/design/README.md` | Declared Test Factory as source of truth and required QA control-room styling | Replace with The Local Cafe source-of-truth read order and non-negotiables | Updated |
| `docs/design/01-visual-direction.md` | Retro western QA interface, dashboard/page personality, old visual traits | Replace with Local Cafe editorial visual thesis, story signals, imagery, motifs | Updated |
| `docs/design/02-design-tokens.md` | Old palette: charcoal, blacktop, fieldGreen, brandRed, brandOrange, brandGreen, paperWarm | Replace with Local Cafe canonical tokens and deprecated mapping | Updated |
| `docs/design/03-typography.md` | Archivo Black/Anton display, Inter UI, mono metadata as brand carrier | Replace with PP Migra-style display, Gilroy-style sans, Microsoft Himalaya accent rules | Updated |
| `docs/design/04-layout-and-surfaces.md` | Dark grid app shell, folder tabs, green grid, paper report cards | Replace with 12/8/4 column editorial grid, CSS grid rules, Local Cafe surface system | Updated |
| `docs/design/05-components.md` | Folder tabs, pill red buttons, QA run/report/diff components | Replace with header/nav, editorial buttons, cards, menu, forms, cart, checkout, reservation, account states | Updated |
| `docs/design/06-qa-product-patterns.md` | QA-specific product pattern doc is not a cafe page spec | Replace with home, menu, item detail, culture/journal, about, reservation, location, ordering, checkout, account, empty/error specs | Replaced by `06-page-and-product-patterns.md` |
| `docs/design/07-ai-agent-rules.md` | Required old QA visual choices and western copy constraints | Replace with Local Cafe implementation rules and runtime product caveat | Updated |
| `docs/design/agent-implementation-prompt.md` | Prompt instructed agents to build Test Factory control-room UI | Replace with Local Cafe migration/build prompt | Updated |
| `docs/design/tokens.css` | Old CSS variables, old font imports, rounded cards, red cutout utility | Replace with canonical Local Cafe CSS variables, grid utilities, type utilities, buttons, states | Updated |
| `docs/design/tailwind.extend.js` | Old Tailwind extension values and cutout shadow | Replace with Local Cafe color, font, spacing, radius, shadow, grid extension | Updated |
| `docs/design/design-tokens.json` | No machine-readable Local Cafe token file existed in design folder | Add canonical Local Cafe token JSON | Added |
| `docs/design/references/README.md` | Instructed agents to inspect old QA reference images | Mark old reference images deprecated and define needed Local Cafe references | Updated |
| `docs/design/references/*.jpeg`, `*.png` | Old dark-grid, paper-report, green-grid, UI-board visual targets | Keep as historical files only; do not use as Local Cafe targets | Deprecated |
| `src/client/src/styles.css` | Runtime CSS encoded old fonts, old palette, red cutout shadows, rounded card defaults | Map runtime styling to Local Cafe tokens while preserving QA product behavior | Updated |
| `tests/App.test.tsx` | CSS token test expected old Test Factory palette | Update token assertion to Local Cafe canonical palette and no generic blue | Updated |
| Runtime QA copy in `src/client/src/App.tsx` and `src/client/index.html` | Product strings still say Test Factory, Dashboard, Runs, Reports, etc. | Preserve because they are actual QA product behavior, not cafe design documentation; Local Cafe token styling applies without renaming business workflows | Preserved intentionally |
| `README.md` product docs | Test Factory product documentation, not design-system docs | Preserve because it documents the QA app product and is already modified outside this migration | Preserved intentionally |

## Unresolved Assets

- Licensed PP Migra and Gilroy font files are not present in the repo. Fallback stacks are specified.
- Local Cafe photography and cloud mark assets are not present in the repo. Reference categories and asset requirements are documented.
- Deprecated historical images remain on disk. They are explicitly marked non-normative.
