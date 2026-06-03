# 04. Layout And Surfaces

## Layout Principle

Build pages like editorial campaign systems: controlled grids, generous negative space, asymmetric modules, fine construction lines, and deliberate contrast between full-bleed imagery and quiet off-white panels.

## Global Grid

Desktop:

```css
.page-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  column-gap: 24px;
  max-width: 1280px;
  margin-inline: auto;
  padding-inline: 64px;
}
```

Tablet uses 8 columns, 32 px margins, and 20 px gutters. Mobile uses 4 columns, 20 px margins, and 16 px gutters.

Use an 8 px baseline and 96-192 px editorial section spacing.

## CSS Grid And Flex Rules

Use CSS grid for:

- page layout
- menu layout
- item detail layout
- reservation and checkout splits
- image collages
- editorial section composition

Use flex only for:

- header navigation
- CTA groups
- metadata rows
- menu chips
- quantity controls
- horizontal story rails

## Surface Types

### Paper Editorial

Use for page introductions, menu cards, story text, reservation details, and forms.

- Background: `paper` or `warm-white`.
- Border: optional 1 px `grid-line`.
- Padding: 32-64 px desktop, 24 px tablet, 20 px mobile.
- Radius: 0 by default.

### Dark Editorial

Use for manifesto, footer, campaign impact moments, and selected content cards.

- Background: `ink`, `charcoal`, or `espresso`.
- Text: `warm-white`.
- Body opacity: 80-88%.
- Avoid long paragraphs.

### Taupe Card

Use for text-only campaign cards, menu highlights, and small content blocks.

- Background: `taupe`.
- Text: `warm-white`.
- Best for short serif copy plus tiny labels.

### Clay Launch Card

Use for seasonal/event/active moments only.

- Background: `clay`.
- Text: `warm-white`.
- Keep copy short.

### Social Story Overlay

Use only in social, journal, or campaign sections.

- Border: 1 px white at 60-85% over image, or `grid-line` over light surfaces.
- Radius: 10-16 px.
- Fine-line icons at 16-20 px.

## Layout Recipes

### Full-Bleed Photo Hero

- `min-height: 100svh`.
- Full-bleed cafe exterior/interior image.
- Overlay: black gradient at 20-45% depending on contrast.
- Header absolute or transparent at top.
- Large centered wordmark or bottom-left lockup.
- CTA pair below support line or bottom center.

### Brand Manifesto Split

- Black background.
- Metadata columns 1-4.
- Large serif statement columns 6-12.
- Body paragraph columns 6-11.
- Padding: 128-160 px desktop.

### Origin Collage

- Label columns 1-4.
- Headline/body columns 7-12.
- Collage below in the 12-column grid.
- Use 3-7 images with mixed square, portrait, and landscape crops.
- Align to the micro-grid and keep empty space.

### Menu Overview

- Oversized serif category rows.
- 4-6 rows per viewport.
- Row height: `clamp(72px, 10vh, 132px)`.
- Hover can reveal thumbnail or italic emphasis, not loud animation.

### Functional Split Page

Use for reservation, checkout, account, and order detail.

- Left 5 columns: image, story, summary, or context.
- Right 5-6 columns: form or task UI.
- Form surface: warm-white with 1 px border.
- Mobile stacks task content first.

## Responsive Rules

Desktop preserves blank columns and asymmetry. Tablet reduces density but keeps the grid. Mobile stacks functional content, reduces collage density, and hides decorative grid overlays when they hurt clarity.
