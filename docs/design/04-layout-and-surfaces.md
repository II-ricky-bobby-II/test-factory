# 04. Layout and Surfaces

## Layout Principle

Use strong structure with layered editorial composition.

The UI should feel designed, not randomly decorated.

## App Shell

Default shell:

- dark charcoal grid background
- top or bottom folder-tab navigation
- large page heading
- cream cards for content
- red or green status accents

Base page structure:

```txt
[folder tabs]
[mono page label]
[large display title]
[main action / summary]
[paper cards / panels]
[logs / screenshots / artifacts]
```

## Background Types

### Dark Grid

Use for:

- dashboard
- visuals page
- overview pages
- artifact pages

### Paper Grid

Use for:

- reports
- run details
- documentation-like pages
- printable summaries

### Green Grid

Use for:

- brand-heavy pages
- empty states
- onboarding
- success summary screens

## Surface Types

### Paper Card

Use for most content.

Traits:

- cream background
- dark ink text
- rounded corners
- visible border
- optional paper grid
- light shadow

### Dark Panel

Use for logs, terminal-style blocks, and tables on dark pages.

Traits:

- blacktop background
- cream text
- thin light border
- rounded corners

### Label / Sticker

Use for short metadata.

Traits:

- cream or white background
- dark text
- mono font
- slight border
- optional tiny rotation on decorative labels only

## Composition Rules

Use overlap where it helps brand.

Good overlap examples:

- cutout object behind hero title
- status stamp over paper report
- screenshot strip overlapping report card
- nav tabs overlapping page surface

Do not overlap key controls or tables.

## Responsive Rules

Desktop:

- use editorial split layouts
- allow large titles
- allow collage elements

Tablet:

- keep two-column content when readable
- reduce decorative objects

Mobile:

- stack content
- keep tabs scrollable or move to bottom nav
- remove large collage objects when they hurt clarity
- keep test status visible above the fold
