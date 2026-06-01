# 06. QA Product Patterns

This design system is for a QA app. The UI must make test state obvious.

## Core Product Areas

- dashboard
- smoke runs
- visual diffs
- reports
- logs
- artifacts
- repo connections
- settings

## Dashboard

Purpose: show current QA health fast.

Required blocks:

- latest run
- pass/fail/warn counts
- visual diff count
- recent runs
- artifacts
- connected repo

Style:

- dark grid background
- large display title
- cream metric cards
- red failure emphasis
- green pass emphasis

## Runs Page

Purpose: browse test runs.

Required data:

- run ID
- test suite
- status
- branch
- commit
- started time
- duration
- browser
- device

Style:

- paper or dark table
- status badges
- rows should feel like field records

## Run Detail Page

Purpose: inspect one run.

Required sections:

- run summary
- failed tests
- screenshots
- logs
- artifacts
- environment
- rerun action

Style:

- paper report layout
- red failure stamp if failed
- mono metadata

## Visual Diffs Page

Purpose: compare screenshots.

Required views:

- baseline
- latest
- diff
- changed areas
- route/component metadata

Style:

- screenshot cards
- red boxes around changes
- green badge when clean

## Report Page

Purpose: share or review final QA result.

Style:

- paper grid background
- document-like layout
- large title
- metadata stamp
- boxed summaries
- screenshot strips
- run notes

## Logs Page / Panel

Purpose: debug quickly.

Style:

- dark terminal receipt
- mono text
- clear pass/fail coloring
- timestamps visible
- copy/download actions

## Status Language

Use exact test language.

Good:

- Failed at checkout payment step
- Visual mismatch on pricing card
- Auth smoke passed
- 3 warnings found

Bad:

- Something went wrong
- Looks okay
- Oops
- All good partner

## Severity Rules

Failure must be visually obvious.

Warning must be noticeable but less loud.

Success should be calm.

Never hide failures behind neutral cards.

## Data Density

QA screens can be dense, but must stay readable.

Use:

- grouped sections
- clear labels
- mono metadata
- action rows
- collapsible logs

Avoid:

- tiny unreadable tables
- decorative overlap inside data-heavy areas
- hiding key errors below the fold
