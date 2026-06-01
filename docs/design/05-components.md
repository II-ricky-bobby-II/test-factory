# 05. Components

## App Shell

The shell sets the design tone.

Required:

- dark grid background
- folder-tab nav
- branded page title area
- content max width
- no blue primary styling

## Folder Tabs

Use folder-like tabs for main navigation.

Tabs should look like cream file folders with green labels.

States:

- default: cream background, green text
- active: cream background, red top/underline accent
- hover: slightly raised
- disabled: muted ink

Main nav labels:

- Dashboard
- Runs
- Visuals
- Reports
- Settings

## Buttons

### Primary Button

Use for the main action.

Style:

- red-orange background
- cream text
- pill shape
- uppercase or strong label
- bold sans

Use for:

- Run smoke check
- Re-run test
- Create report

### Secondary Button

Use for secondary actions.

Style:

- cream background
- dark ink text
- pill shape
- thin border

Use for:

- View report
- Open artifact
- Compare visuals

### Utility Button

Use for low-priority actions.

Style:

- transparent background
- dashed border
- mono text

Use for:

- Copy run ID
- Download logs
- Open raw output

## Paper Card

Use for metrics, summaries, run cards, and report sections.

Card anatomy:

```txt
[mono eyebrow]
[title]
[content]
[action row]
```

## Status Badge

Badges must be readable first, styled second.

Labels:

- PASSED
- FAILED
- WARN
- RUNNING
- SKIPPED

Use uppercase text.

Do not use vague labels like “good” or “bad”.

## Run Card

Run card content:

- test name
- status
- run ID
- timestamp
- browser
- device
- duration
- pass/fail/warn counts
- primary action

Failed run cards need a clear red accent.

Passed run cards need a calm green accent.

## Metric Card

Use for:

- passed count
- failed count
- warnings
- duration
- visual changes

Numbers should be large.

Labels should be small and clear.

## Report Section

Use paper-grid styling.

Sections:

- summary
- failed tests
- visual diffs
- logs
- artifacts
- run notes

## Visual Diff Card

Show:

- baseline screenshot
- latest screenshot
- diff screenshot
- status badge
- affected selector or route
- percent changed if available

Use red outlines for mismatch areas.

## Log Panel

Logs should feel like terminal receipts.

Required:

- blacktop background
- mono font
- cream text
- red error lines
- green pass lines
- copy button

## Forms

Forms should feel like paper input fields.

Use:

- rounded inputs
- visible border
- clear labels
- no overly minimal invisible inputs

## Empty States

Empty states should stay branded but clear.

Example:

```txt
No smoke runs yet.
Connect a repo and run your first check.
```

Optional western terms are allowed, but clarity wins.
