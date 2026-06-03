# Agent Implementation Prompt

Use this prompt when asking an AI coding agent to create or update Test Factory UI.

```txt
You are implementing the Test Factory design system.

Before editing UI, read `docs/design/README.md` and follow the required read order.

Create a refined editorial QA product experience based on the supplied Behance branding packet: large PP Migra-style serif typography, tiny widely tracked Gilroy-style labels, off-white/black/taupe/clay color fields, visible grid construction, asymmetric evidence collages, real product screenshots, report artifacts, and quiet functional UI.

Use:
- paper, warm-white, mist, ink, charcoal, espresso
- taupe, clay, saffron, coffee, cream, leaf, deep-blue accents
- PP Migra or fallback display serif
- Gilroy or Inter/Helvetica fallback sans
- 12-column desktop, 8-column tablet, 4-column mobile grid
- CSS grid for page, dashboard, report, and collage layouts
- flex only for nav, CTA groups, metadata rows, and horizontal rails
- thin editorial buttons
- square/rectangular evidence cards
- practical smoke-run, project, integration, report, empty, and error states

Avoid:
- generic SaaS dashboards
- neon developer-tool styling
- bright blue primary UI
- heavy shadows
- rounded cards everywhere
- cartoon robot/check icons
- fake stock imagery or placeholder UI
- old Test Factory control-room references
- cafe-domain copy in product UI

Preserve accessibility: readable body text, real HTML text for essential content, contrast over images, keyboard focus states, clear form errors, 44 px hit targets, and reduced-motion support.
```
