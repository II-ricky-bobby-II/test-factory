# 03. Typography

Use three font roles.

## 1. Display Font

Use for large page titles, hero text, and major headings.

Traits:

- bold
- condensed or chunky
- retro editorial
- high impact
- tight line height

Recommended options:

- `Archivo Black`
- `Anton`
- `Cooper Black`
- `Fraunces 900`
- `Ultra`
- `Bricolage Grotesque 800`

Default recommendation:

```css
--font-display: "Archivo Black", "Anton", system-ui, sans-serif;
```

Use display type for:

- Test Factory
- Smoke Runs
- Visual Diffs
- Test Reports
- Run Failed

Do not use display type for tables, logs, or long paragraphs.

## 2. Sans Font

Use for normal UI text.

Traits:

- clean
- readable
- slightly warm
- not too corporate

Recommended options:

- `Inter`
- `Geist`
- `Satoshi`
- `DM Sans`

Default recommendation:

```css
--font-sans: "Inter", "Geist", system-ui, sans-serif;
```

Use sans type for:

- body copy
- forms
- cards
- buttons
- report text

## 3. Mono / Pixel Font

Use for metadata only.

Traits:

- technical
- compact
- retro
- label-like

Recommended options:

- `IBM Plex Mono`
- `Space Mono`
- `JetBrains Mono`
- `Geist Mono`
- `Departure Mono`

Default recommendation:

```css
--font-mono: "IBM Plex Mono", "Space Mono", monospace;
```

Use mono type for:

- run ID
- browser/device
- timestamps
- test path
- file names
- status metadata
- section eyebrow text

Do not use mono text for long body copy.

## Type Scale

| Role | Size | Weight | Line Height |
|---|---:|---:|---:|
| Hero | `72px-112px` | `900` | `0.9` |
| Page title | `44px-72px` | `900` | `0.95` |
| Section title | `28px-40px` | `800` | `1.0` |
| Card title | `18px-24px` | `700` | `1.15` |
| Body | `15px-17px` | `400-500` | `1.5` |
| Small | `13px-14px` | `400-600` | `1.35` |
| Mono label | `11px-13px` | `600-700` | `1.2` |

## Heading Rules

Headings should feel bold and placed with intent.

Good:

```txt
SMOKE RUN / CHECKOUT
Run Failed
```

Bad:

```txt
Dashboard Overview
```

Prefer specific, operational labels.
