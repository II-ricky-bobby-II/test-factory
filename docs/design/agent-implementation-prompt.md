# Agent Implementation Prompt

Use this prompt when asking an AI coding agent to create or update UI.

```txt
You are redesigning this app using the Test Factory design system.

Before editing UI, read the files in `/design`.

The app should feel like a rugged QA control room made from dark grid paper, cream report cards, red-orange cutout accents, green status labels, and retro editorial typography.

Do not create a generic SaaS dashboard.

Use:
- dark charcoal grid backgrounds
- cream paper cards
- forest green success accents
- red-orange failure and emphasis accents
- large bold display headings
- mono metadata labels
- folder-tab navigation
- rounded paper panels
- subtle paper texture
- report-like QA layouts
- clear pass/fail/warn states

Avoid:
- blue primary colors
- generic gradients
- glassmorphism
- neon cyberpunk styling
- literal cowboy clip art
- over-themed copy

Create or reuse components for:
- AppShell
- FolderTabs
- PaperCard
- StatusBadge
- RunCard
- MetricCard
- ReportSection
- VisualDiffCard
- LogPanel
- PrimaryButton
- SecondaryButton

Keep the UI readable. The style can be expressive, but test results, errors, reports, and actions must stay clear.
```
