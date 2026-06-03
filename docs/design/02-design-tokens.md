# 02. Design Tokens

Use these tokens for color, typography, spacing, radius, borders, shadows, layout, and motion.

## Color Tokens

| Token | Hex | Use |
|---|---:|---|
| `ink` | `#050505` | Primary text, black panels, footer |
| `charcoal` | `#171411` | Softer dark surfaces and overlays |
| `espresso` | `#21170F` | Warm dark brown-black panels |
| `paper` | `#F7F3EA` | Primary page background |
| `warm-white` | `#FFFCF5` | Cards, menus, forms, reversed panels |
| `mist` | `#ECEBE7` | Neutral grey background |
| `grid-line` | `#D8D3C8` | Fine grid, dividers, construction lines |
| `taupe` | `#918A7C` | Muted cards, labels, secondary surfaces |
| `clay` | `#D65A2B` | Launch, active, focus, primary accent |
| `saffron` | `#E5B72E` | Flower or highlight accent |
| `coffee` | `#9B6436` | Coffee, wood, hover warmth |
| `cream` | `#E7D0AE` | Beverage and food warmth |
| `leaf` | `#405733` | Natural green, success state |
| `deep-blue` | `#223D66` | Textile-inspired accent |
| `error` | `#9E2F1C` | Error state |
| `success` | `#405733` | Success state |

## Semantic Tokens

| Token | Value |
|---|---|
| `--surface-page` | `var(--color-paper)` |
| `--surface-card` | `var(--color-warm-white)` |
| `--surface-inverse` | `var(--color-ink)` |
| `--surface-muted` | `var(--color-taupe)` |
| `--text-primary` | `var(--color-ink)` |
| `--text-secondary` | `rgba(5,5,5,0.72)` |
| `--text-tertiary` | `rgba(5,5,5,0.52)` |
| `--text-inverse` | `var(--color-warm-white)` |
| `--border-default` | `rgba(5,5,5,0.16)` |
| `--border-grid` | `rgba(216,211,200,0.72)` |
| `--focus-ring` | `var(--color-clay)` |

## Spacing Tokens

Use a 4 px base with an 8 px baseline rhythm.

| Token | Value | Use |
|---|---:|---|
| `space-1` | `4px` | Icon/text micro gap |
| `space-2` | `8px` | Compact gap |
| `space-3` | `12px` | Form label gap |
| `space-4` | `16px` | Small component padding |
| `space-5` | `24px` | Card gap, mobile section gap |
| `space-6` | `32px` | Component padding, tablet gap |
| `space-7` | `48px` | Card and section interior |
| `space-8` | `64px` | Desktop margin, major gap |
| `space-9` | `80px` | Section intro gap |
| `space-10` | `96px` | Small desktop section padding |
| `space-11` | `128px` | Standard desktop section padding |
| `space-12` | `160px` | Large editorial section padding |
| `space-13` | `192px` | Immersive hero or manifesto spacing |
| `space-14` | `240px` | Rare oversized brand pause |

## Layout Tokens

| Breakpoint | Columns | Margin | Gutter | Max width |
|---|---:|---:|---:|---:|
| Desktop | 12 | `64px` | `24px` | `1280px` |
| Tablet | 8 | `32px` | `20px` | `100%` |
| Mobile | 4 | `20px` | `16px` | `100%` |

Use 24 micro columns on desktop, 16 on tablet, and 8 on mobile when aligning collages.

## Radius

| Token | Value | Use |
|---|---:|---|
| `radius-none` | `0` | Editorial cards, images, menu panels |
| `radius-xs` | `4px` | Small controls only |
| `radius-sm` | `8px` | Form controls, chips |
| `radius-md` | `12px` | Social frames, modals |
| `radius-lg` | `16px` | Story card only |
| `radius-full` | `999px` | Avatar or pill only |

Default editorial modules and images use square corners.

## Borders And Shadows

Use hairline borders and grid lines before shadows.

- Hairline: `1px solid var(--border-default)`.
- Grid border: `1px solid var(--border-grid)`.
- Dotted menu guide: `1px dotted rgba(5,5,5,0.22)`.
- Inverse border: `1px solid rgba(255,252,245,0.42)`.
- Default shadow: none.
- Soft shadow: `0 18px 40px rgba(5,5,5,0.10)` only for floating social cards.
- Modal shadow: `0 28px 80px rgba(5,5,5,0.28)`.

## Motion

- Fast: `140ms`.
- Base: `220ms`.
- Slow: `600ms`.
- Standard easing: `cubic-bezier(0.2, 0, 0, 1)`.
- Editorial easing: `cubic-bezier(0.16, 1, 0.3, 1)`.

Respect `prefers-reduced-motion`.

## Deprecated Token Mapping

Old Test Factory token names must not be used in new docs or components. If legacy runtime CSS still references them, map them to the new tokens until the component can be renamed:

| Deprecated | New token |
|---|---|
| `brandRed` | `clay` |
| `brandRedDark` | `coffee` or `error` |
| `brandOrange` | `saffron` |
| `brandGreen` | `leaf` |
| `fieldGreen` | `leaf` |
| `blacktop` | `ink` or `espresso` |
| `paperWarm` | `warm-white` |
| `chalk` | `warm-white` |
| `mutedInk` | `taupe` |
| `cutoutRed` | remove; use hairline border or `shadow-soft` only |
