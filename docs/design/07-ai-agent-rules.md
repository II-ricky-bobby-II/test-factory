# 07. AI Agent Rules

These rules are for Codex, Cursor, Claude, and any AI agent changing Test Factory UI or documentation.

## Required Behavior

Before changing UI, read this folder in the order listed in `README.md`.

Before creating a new component, check `05-components.md`.

Before inventing tokens, use `02-design-tokens.md`, `tokens.css`, and `design-tokens.json`.

## Hard Rules

- Do not revive the old rugged QA control-room design direction.
- Do not use folder-tab navigation, red cutout shadows, dark dashboard grids, or rounded paper report panels as the default surface.
- Do not create a generic SaaS dashboard or neon developer-tool interface.
- Do not use blue, purple, neon, or bright startup colors as primary UI.
- Do not use cartoon robot/check icons, emoji, or novelty lab motifs.
- Do not use cafe, food, Sikkim, Delhi, or hospitality copy in Test Factory product UI unless explicitly referencing the external Behance source.
- Do not use heavy shadows or rounded cards as the default surface.
- Do not reduce readability for style.
- Do not hide deployment URLs, project names, run status, logs, report outcomes, integration errors, or primary actions.

## Required Style Choices

Use:

- paper, warm-white, mist, ink, charcoal, espresso
- taupe, clay, saffron, coffee, cream, leaf, deep-blue as controlled accents
- PP Migra-style display serif
- Gilroy-style sans labels and body/UI copy
- small uppercase labels with wide tracking
- CSS grid and visible construction lines
- product-documentary imagery and real evidence artifacts
- asymmetric collage layouts
- thin editorial buttons
- square and rectangular image cards
- practical forms and app states

## New Component Checklist

Any new component must answer:

1. Does it use approved Test Factory tokens?
2. Does it use the correct type role?
3. Is the layout grid-based when it is two-dimensional?
4. Are controls keyboard reachable and 44 px minimum where interactive?
5. Are focus states visible?
6. Does body copy stay practical?
7. Does the component avoid generic SaaS styling and stray cafe-domain copy?
8. Does it preserve mobile readability?

## Acceptance Criteria

A UI change passes design review when it clearly belongs to the Behance-inspired Test Factory visual family, uses tokenized styling, supports the required workflow, handles error/empty/confirmation states, respects reduced motion, and does not preserve deprecated visual references.
