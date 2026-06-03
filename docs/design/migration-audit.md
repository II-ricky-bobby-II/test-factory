# Test Factory Design Migration Audit

Audit date: 2026-06-02.

Source basis: the saved Behance design packet and the normalized web specifications in this folder.

## Summary

The existing repo design system described Test Factory as a rugged QA control room with dark grid paper, folder tabs, red cutout shadows, forest-green status labels, mono metadata, and old reference boards. That direction conflicts with the supplied Behance packet and the current product goal. The migration replaces those documents and token surfaces with an editorial QA product system based on PP Migra/Gilroy-style typography, off-white/black/taupe/clay color fields, visible construction grids, asymmetric evidence collages, and quiet functional UI.

## Audit Table

| File or design area | Conflict found | Required change | Migration status |
|---|---|---|---|
| `docs/design/README.md` | Required QA control-room styling | Replace with Test Factory source-of-truth read order and Behance-inspired non-negotiables | Updated |
| `docs/design/01-visual-direction.md` | Retro western QA interface, dashboard/page personality, old visual traits | Replace with Test Factory editorial visual thesis, story signals, imagery, motifs | Updated |
| `docs/design/02-design-tokens.md` | Old palette: charcoal, blacktop, fieldGreen, brandRed, brandOrange, brandGreen, paperWarm | Replace with Behance-inspired canonical tokens and deprecated mapping | Updated |
| `docs/design/03-typography.md` | Archivo Black/Anton display, Inter UI, mono metadata as brand carrier | Replace with PP Migra-style display, Gilroy-style sans, Microsoft Himalaya accent rules | Updated |
| `docs/design/04-layout-and-surfaces.md` | Dark grid app shell, folder tabs, green grid, paper report cards | Replace with 12/8/4 column editorial grid, CSS grid rules, Test Factory surface system | Updated |
| `docs/design/05-components.md` | Folder tabs, pill red buttons, QA run/report/diff components | Replace with header/nav, editorial buttons, evidence cards, forms, run reports, integration settings, empty/error states | Updated |
| `docs/design/06-qa-product-patterns.md` | QA-specific product pattern doc used old control-room language | Replace with homepage, saved checks, run detail, evidence editorial, project setup, integrations, PR automation, report handoff, empty/error specs | Replaced by `06-page-and-product-patterns.md` |
| `docs/design/07-ai-agent-rules.md` | Required old QA visual choices and western copy constraints | Replace with Test Factory implementation rules | Updated |
| `docs/design/agent-implementation-prompt.md` | Prompt instructed agents to build Test Factory control-room UI | Replace with Test Factory editorial migration/build prompt | Updated |
| `docs/design/tokens.css` | Old CSS variables, old font imports, rounded cards, red cutout utility | Replace with canonical Test Factory CSS variables, grid utilities, type utilities, buttons, states | Updated |
| `docs/design/tailwind.extend.js` | Old Tailwind extension values and cutout shadow | Replace with Test Factory color, font, spacing, radius, shadow, grid extension | Updated |
| `docs/design/design-tokens.json` | No machine-readable editorial token file existed in design folder | Add canonical Test Factory token JSON | Added |
| `docs/design/references/README.md` | Instructed agents to inspect old QA reference images | Mark old reference images deprecated and define needed Test Factory references | Updated |
| `docs/design/references/*.jpeg`, `*.png` | Old dark-grid, paper-report, green-grid, UI-board visual targets | Keep as historical files only; do not use as current Test Factory targets | Deprecated |
| `src/client/src/styles.css` | Runtime CSS encoded old fonts, old palette, red cutout shadows, rounded card defaults | Map runtime styling to Test Factory tokens while preserving QA product behavior | Updated |
| `tests/App.test.tsx` | CSS token test expected old Test Factory palette | Update token assertion to canonical editorial palette and no generic blue | Updated |
| Runtime QA copy in `src/client/src/App.tsx` and `src/client/index.html` | Product strings say Test Factory, Dashboard, Runs, Reports, etc. | Preserve because they are actual product behavior | Preserved intentionally |
| `README.md` product docs | Test Factory product documentation, not design-system docs | Preserve because it documents the QA app product and is already modified outside this migration | Preserved intentionally |

## Unresolved Assets

- Licensed PP Migra and Gilroy font files are not present in the repo. Fallback stacks are specified.
- Fresh Test Factory product screenshots and evidence captures should be added as durable reference assets when specific source states matter.
- Deprecated historical images remain on disk. They are explicitly marked non-normative.
