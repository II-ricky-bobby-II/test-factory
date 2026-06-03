# 05. Components

## Component Principles

- Components must feel editorial, not SaaS-generic.
- Typography and spacing define hierarchy before color.
- Use square or rectangular image cards for editorial modules.
- Reserve rounded corners for social overlays and functional controls.
- Prefer thin borders over shadows.
- Functional flows must remain clear.

## Header And Navigation

Desktop header:

- Height: 80-96 px editorial pages, 72-80 px app pages.
- Padding: 32-64 px.
- Left or centered text logo: THE LOCAL CAFE.
- Nav labels: 11-12 px uppercase sans, 0.30-0.38em tracking.
- Gap: 28-40 px.
- Transparent over hero; paper/blur with hairline border after scroll or on app pages.
- Active state: underline or clay dot/line. No filled pills.

Mobile header:

- Height: 64-72 px.
- Padding: 20 px.
- Menu trigger: "MENU" label or two-line icon.
- Mobile nav: full-screen paper or black panel with large serif links and small metadata.

## Buttons And Links

Primary editorial button:

- Height: 44-52 px.
- Padding: 14 px 22 px.
- Border: 1 px solid currentColor.
- Radius: 0-4 px.
- Label: 11-12 px uppercase sans, 0.24-0.32em tracking.
- Background: transparent by default.
- Hover: invert or shift to clay/coffee.

Secondary text link:

- Underline 1 px, offset 4 px.
- Hover changes underline length or text color.

Icon arrow link:

- Label plus thin arrow, 12 px gap.

## Cards

Editorial image card:

- Radius: 0.
- Aspect ratios: 1:1, 4:5, 16:9, 3:4.
- Caption below image or over a contrast-safe overlay.
- Hover image scale max 1.02.

Text-only campaign card:

- Background: taupe, ink, warm-white, or clay.
- Padding: 32-56 px.
- Large serif copy with tiny labels.

Social story card:

- Use only for social/journal/campaign modules.
- Aspect ratio: 1:1, 4:5, or 9:16.
- Radius: 12-16 px.
- Border: 1 px white at 60-80%.
- Never use for forms, evidence item cards, or primary navigation.

## Evidence Components

Evidence category rows:

- Number plus category name.
- PP Migra-style serif, 72-112 px desktop, 40-56 px mobile.
- Border-top: 1 px grid line.
- Optional hover thumbnail.

Evidence item card:

- Screenshot, category label, evidence name, status tag, description, timestamp, select/open action.
- Warm-white or transparent on grid.
- Image: square or 4:5.
- Padding: 24-48 px.
- Border: optional 1 px grid line.

Status tags:

- Text-first labels: PASS, FAIL, WARN, QUEUED, RUNNING, BLOCKED.
- Tiny uppercase sans, 0.16-0.24em tracking.
- Do not rely on color alone.

Step selector:

- Thin bordered control.
- 40-44 px height.
- Plus/minus icons at 16 px.
- Hover/focus uses clay or coffee border.

## Forms

Use for login, ad hoc runs, projects, saved checks, integrations, and account.

- Label: sentence case for app clarity; uppercase labels only on editorial landing sections.
- Input height: 48-56 px.
- Border: 1 px `border-default` or underline.
- Background: warm-white or transparent.
- Radius: 0-4 px.
- Focus: 2 px clay outline or clear border change.
- Error text: 13-14 px below field, not color-only.
- Field gap: 20-24 px.
- Section gap: 40-56 px.

Reservation fields: party size, date, time, full name, phone, email, occasion/note, optional seating preference.

Checkout fields: order type, pickup/delivery time, customer details, delivery address if needed, payment summary, instructions.

## Filters, Tabs, Accordions

Tabs and filters:

- Flex wrap, gap 12 px.
- Active state: ink background with warm-white text or underline.
- Avoid colorful chips.

Accordions:

- Border-top: 1 px grid line.
- Header height: 56-72 px.
- Plus/minus icon at 16-20 px.
- Body max width: 680 px.

## Cart, Modals, Toasts

Evidence drawer:

- Width: 420-520 px desktop.
- Background: paper or warm-white.
- Header: small logo/label plus close.
- Items: compact list with square evidence thumbnails.
- Footer: result summary, copy/open actions.

Run confirmation:

- Width: 520-680 px.
- Optional Test Factory mark.
- Serif headline 40-56 px.
- Details in clean rows.

Toasts:

- Bottom right desktop, bottom on mobile.
- Ink for confirmation, warm-white for neutral.
- Text 14-15 px.

## Empty And Error States

Use a small cloud mark, a display serif headline, clear body copy, and one direct action.

Examples:

- Project: "No project selected." / "Create a project or run an ad hoc preview check."
- Runs: "No evidence yet." / "Start a smoke check to capture browser output."
- 404: "This preview path drifted." / "Return to the dashboard, projects, or settings."

## Footer

- Black background.
- Oversized wordmark.
- Build state, capabilities, integrations, security posture, and contact details.
- 3-4 columns desktop; stacked mobile.
- Utility labels in uppercase sans.
