# 07. AI Agent Rules

These rules are for Codex, Cursor, Claude, and any AI agent changing The Local Cafe UI or documentation.

## Required Behavior

Before changing UI, read this folder in the order listed in `README.md`.

Before creating a new component, check `05-components.md`.

Before inventing tokens, use `02-design-tokens.md`, `tokens.css`, and `design-tokens.json`.

## Hard Rules

- Do not revive the old Test Factory/QA control-room design direction.
- Do not use folder-tab navigation, red cutout shadows, dark dashboard grids, or rounded paper report panels for The Local Cafe.
- Do not create a generic cafe template or food-delivery-app interface.
- Do not use blue, purple, neon, or bright startup colors as primary UI.
- Do not use cartoon coffee icons, emoji food icons, or novelty cultural motifs.
- Do not overuse Himalayan/Tibetan script accents.
- Do not use heavy shadows or rounded cards as the default surface.
- Do not reduce readability for style.
- Do not hide menu prices, availability, cart totals, reservation errors, or checkout actions.

## Required Style Choices

Use:

- paper, warm-white, mist, ink, charcoal, espresso
- taupe, clay, saffron, coffee, cream, leaf, deep-blue as controlled accents
- PP Migra-style display serif
- Gilroy-style sans labels and body/UI copy
- small uppercase labels with wide tracking
- CSS grid and visible construction lines
- natural-light documentary imagery
- asymmetric collage layouts
- thin editorial buttons
- square and rectangular image cards
- practical forms and app states

## Runtime Product Note

If this design system is applied to an existing non-cafe app, preserve product functionality and domain labels required by that app. Tokenize and restyle the UI with the Local Cafe system, but do not rename business workflows unless the product migration explicitly requires it.

## New Component Checklist

Any new component must answer:

1. Does it use approved Local Cafe tokens?
2. Does it use the correct type role?
3. Is the layout grid-based when it is two-dimensional?
4. Are controls keyboard reachable and 44 px minimum where interactive?
5. Are focus states visible?
6. Does body copy stay practical?
7. Does the component avoid generic food-delivery styling?
8. Does it preserve mobile readability?

## Acceptance Criteria

A UI change passes design review when it clearly belongs to The Local Cafe visual family, uses tokenized styling, supports the required workflow, handles error/empty/confirmation states, respects reduced motion, and does not preserve deprecated visual references.
