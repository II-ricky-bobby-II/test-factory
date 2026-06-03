# 03. Typography

Typography is the primary brand carrier. The system depends on contrast between expressive display serif type and tiny structured sans labels.

## Typeface Roles

| Role | Preferred | Fallback | Use |
|---|---|---|---|
| Display serif | PP Migra Regular | Cormorant Garamond, Bodoni 72, Didot, Georgia | Logo, hero, large page titles, report headlines |
| Display italic | PP Migra Italics | Cormorant Garamond Italic, Bodoni 72, Didot Italic, Georgia Italic | Emphasis words, poetic subheads, evidence notes |
| Utility sans | Gilroy Semibold | Inter, Helvetica Neue, Arial | Eyebrows, nav, captions, metadata, buttons |
| Body sans | Gilroy Regular | Inter, Helvetica Neue, Arial | Body copy, forms, checkout, account UI |
| Script accent | Microsoft Himalaya | serif | Non-critical cultural accents only |

Use PP Migra and Gilroy only with proper licenses. Otherwise use the fallback stacks while preserving the intended contrast.

```css
--font-display: 'PP Migra', 'Cormorant Garamond', 'Bodoni 72', 'Didot', Georgia, serif;
--font-display-italic: 'PP Migra Italic', 'Cormorant Garamond', 'Bodoni 72', 'Didot', Georgia, serif;
--font-sans: 'Gilroy', 'Inter', 'Helvetica Neue', Arial, sans-serif;
--font-script: 'Microsoft Himalaya', serif;
```

## Core Rule

Do not make the product all serif. Serif carries emotion and scale. Sans carries structure, navigation, metadata, form clarity, and transactional UI.

## Type Scale

| Role | Size | Line height | Tracking | Use |
|---|---:|---:|---:|---|
| `display-hero` | `clamp(96px, 11vw, 176px)` | `0.86` | `-0.035em` | Hero wordmark or page title |
| `display-xl` | `clamp(72px, 8vw, 128px)` | `0.90` | `-0.03em` | Section-defining headline |
| `display-lg` | `clamp(56px, 6vw, 96px)` | `0.95` | `-0.025em` | Editorial headline |
| `display-md` | `clamp(40px, 4.8vw, 72px)` | `1.00` | `-0.02em` | Menu category, campaign title |
| `display-sm` | `clamp(32px, 3.2vw, 48px)` | `1.04` | `-0.015em` | Card title, modal headline |
| `body-lg` | `18px` | `1.55` | `0` | Intro paragraph |
| `body-md` | `15-16px` | `1.55` | `0` | Standard body |
| `body-sm` | `13-14px` | `1.50` | `0` | UI help and descriptions |
| `label-lg` | `13px` | `1.2` | `0.34em` | Main labels, nav |
| `label-md` | `11-12px` | `1.2` | `0.28em` | Captions and metadata |
| `label-sm` | `9-10px` | `1.2` | `0.22em` | Dense social metadata |

Do not shrink body copy below 16 px on mobile.

## Label Rules

Labels are a brand signature:

```css
.label {
  font-family: var(--font-sans);
  font-size: 11px;
  line-height: 1.2;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.34em;
}
```

Use up to `0.38em` tracking for desktop nav. Keep mobile labels readable.

## Hierarchy Recipes

Hero:

```text
FROM SIKKIM TO DELHI
THE LOCAL CAFE
HIMALAYAN HOSPITALITY
```

Editorial section:

```text
THE CULTURE
Every Dish Carries A Little Mountain Air
```

Functional app page:

```text
CHECKOUT
Review your order.
```

## Italic Rules

Use italics for one emphasis word, subheads, campaign cards, or short evidence notes. Do not use italics for navigation, form labels, statuses, error messages, logs, or long paragraphs.

## Body Copy Rules

- Desktop body width: 440-620 px.
- Paragraph size: 15-16 px desktop, 16 px mobile.
- Line height: 1.5-1.65.
- Color: `text-secondary` by default.
- Body copy should be practical and clear even when headlines are poetic.

## Bad Typography Signs

The design is off-brand if the hero is small, labels are not widely tracked, most content is generic sans, script is decorative everywhere, or display text wraps awkwardly with orphan words.
