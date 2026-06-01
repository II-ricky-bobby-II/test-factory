# 07. AI Agent Rules

These rules are for Cursor, Codex, Claude, or any AI agent changing the UI.

## Required Behavior

Before changing UI, read this folder.

Before creating new UI, check whether a matching component already exists.

Before inventing a new style, use the tokens in `02-design-tokens.md`.

## Hard Rules

- Do not create a generic SaaS dashboard.
- Do not use blue as the primary color.
- Do not use glassmorphism.
- Do not use neon cyberpunk styling.
- Do not use generic gradient blobs.
- Do not use literal cowboy clip art.
- Do not overuse western copy.
- Do not reduce readability for style.
- Do not make tables harder to scan.
- Do not hide failed states.

## Required Style Choices

Use:

- dark charcoal grid backgrounds
- cream paper cards
- forest green success accents
- red-orange failure accents
- large bold display headings
- mono metadata labels
- folder-tab navigation
- rounded paper panels
- subtle texture
- report-like layouts

## Conflict Rule

If default UI patterns conflict with the design system, the design system wins.

If written rules conflict with visual references, use the visual references for look and the written rules for implementation.

If style conflicts with usability, usability wins.

## New Component Checklist

Any new component must answer these:

1. Does it use approved colors?
2. Does it use the correct font role?
3. Does it fit dark grid / paper report language?
4. Are status states clear?
5. Is it readable on mobile?
6. Does it avoid generic SaaS styling?
7. Can it be reused?

## When Building Pages

Start with page purpose.

Then choose one page mode:

- dark dashboard mode
- paper report mode
- visual diff mode
- settings mode

Do not mix every style on every page.

## Acceptance Criteria

A UI change passes design review when:

- it clearly belongs to the same visual family as the references
- it uses the token system
- it supports QA workflows clearly
- it handles pass/fail/warn states correctly
- it does not look like a generic template
