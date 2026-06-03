# Test Factory Design System

This folder is the source of truth for Test Factory website and web-app design direction.

The system translates the supplied Behance branding packet into Test Factory's product domain: an editorial QA lab for preview deployments. It uses large PP Migra-style serif typography, tiny widely tracked Gilroy-style labels, off-white and black fields, taupe and clay accents, visible construction grids, asymmetric evidence collages, and quiet functional UI.

## Required Read Order

1. `migration-audit.md`
2. `01-visual-direction.md`
3. `02-design-tokens.md`
4. `03-typography.md`
5. `04-layout-and-surfaces.md`
6. `05-components.md`
7. `06-page-and-product-patterns.md`
8. `07-ai-agent-rules.md`
9. `tokens.css`
10. `design-tokens.json`
11. `tailwind.extend.js`
12. `deprecated-references.md`
13. `quality-assurance-checklist.md`

## Non-Negotiables

- Test Factory is the canonical product name. Do not introduce or preserve `QA Farm` in user-facing UI, page titles, aria labels, tests, or docs except when explicitly describing legacy reference material.
- Test Factory must feel editorial, precise, restrained, and operational, not like a generic SaaS dashboard.
- Use the normalized web specifications in this folder and the Behance branding packet. Do not invent source measurements from Behance.
- Use off-white, black, taupe, clay, coffee, saffron, leaf, and deep-blue as a controlled palette.
- Preserve the contrast between huge display serif type and tiny uppercase utility labels.
- Use CSS grid for page layouts, dashboard layouts, report layouts, and editorial evidence collages.
- Use flex only for nav, CTA groups, metadata rows, and horizontal story rails.
- Use real product imagery and evidence artifacts: browser screenshots, report pages, PR status cards, terminal logs, deployment metadata, and UI capture strips.
- Keep app flows practical: smoke-run setup, project management, PR automation, integration settings, run results, empty, error, and confirmation states must stay clear and accessible.

## Deprecated Direction

The previous rugged QA control-room direction, folder-tab navigation, red cutout shadows, green grid pages, generic dashboard styling, cartoon or novelty motifs, and old reference boards are deprecated for Test Factory. See `deprecated-references.md` for the complete list.
