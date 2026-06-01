# 02. Design Tokens

Use these tokens for color, radius, shadow, spacing, and borders.

## Color Tokens

| Token | Hex | Use |
|---|---:|---|
| `charcoal` | `#181818` | Main dark background |
| `blacktop` | `#111111` | Deep panels, logs, header areas |
| `fieldGreen` | `#193C30` | Green page backgrounds |
| `paper` | `#DAD4CE` | Main card surface |
| `paperWarm` | `#D2CCC6` | Secondary paper surface |
| `cream` | `#EFE7D8` | Light paper text/surface |
| `ink` | `#1B1A1A` | Main dark text |
| `mutedInk` | `#5F5B55` | Muted dark text |
| `chalk` | `#E6DED2` | Text on dark surfaces |
| `brandRed` | `#C2442D` | Failure, primary CTA, cutout shadow |
| `brandRedDark` | `#7A3629` | Red borders and pressed states |
| `brandOrange` | `#E58541` | Warnings, secondary accent |
| `brandGreen` | `#0E5A3E` | Success, active labels |
| `softGreen` | `#315045` | Muted green UI |
| `lineSoft` | `rgba(255,255,255,0.08)` | Grid lines on dark |
| `lineDark` | `rgba(0,0,0,0.18)` | Grid lines on paper |

## Status Colors

| Status | Color | Usage |
|---|---:|---|
| Pass | `brandGreen` | Passed tests, clean visual diffs |
| Fail | `brandRed` | Failed tests, destructive states |
| Warn | `brandOrange` | Warnings, flaky tests |
| Running | `cream` on `blacktop` | Active jobs |
| Skipped | `mutedInk` | Skipped tests |

## Radius

| Token | Value | Use |
|---|---:|---|
| `radius-sm` | `10px` | Small badges, inputs |
| `radius-md` | `14px` | Inputs, small cards |
| `radius-lg` | `22px` | Paper cards |
| `radius-xl` | `28px` | Large panels, tabs |
| `radius-pill` | `999px` | Pills, buttons, badges |

## Borders

Use visible borders. Do not rely only on shadow.

- Paper card border: `1px solid rgba(0,0,0,0.22)`
- Dark card border: `1px solid rgba(255,255,255,0.12)`
- Dashed utility border: `1px dashed rgba(255,255,255,0.24)`

## Shadows

Use flat print-style shadows.

- Paper shadow: `0 12px 40px rgba(0,0,0,0.18)`
- Cutout red shadow: `10px 10px 0 #C2442D`
- Small lift: `0 8px 24px rgba(0,0,0,0.16)`

## Spacing

Use a simple 4px-based scale.

| Token | Value |
|---|---:|
| `space-1` | `4px` |
| `space-2` | `8px` |
| `space-3` | `12px` |
| `space-4` | `16px` |
| `space-5` | `20px` |
| `space-6` | `24px` |
| `space-8` | `32px` |
| `space-10` | `40px` |
| `space-12` | `48px` |
| `space-16` | `64px` |
| `space-20` | `80px` |

## Grid Backgrounds

Dark pages must use a subtle grid.

Paper pages may use a paper grid.

Grid lines must stay faint. They should add texture, not reduce readability.
