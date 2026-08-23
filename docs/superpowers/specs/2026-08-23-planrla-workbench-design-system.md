# Planrla Workbench Design System

## Product lens

Planrla is an AI agent workbench: the agent performs work, while the human
tracks state, reviews artifacts, and decides what needs attention. The visual
system therefore favors readable density, explicit status, and calm surfaces
over conversational decoration.

## Visual direction

- Canvas: cool zinc/slate neutral, with white or raised surfaces for hierarchy.
- Accent: one restrained blue for focus, links, active navigation, and running work.
- Status: amber means waiting for a decision, green means completed, red means failed.
- Shape: 4px tags, 6px controls, 8px panels. No oversized rounded cards.
- Type: system sans for interface copy; monospace only for paths, commands, IDs, and metrics.
- Motion: no ambient animation; use short opacity/transform feedback only when a state changes.

## Semantic tokens

Tokens live in `src/design-system/workbench.css` and are exposed to Tailwind as
`workbench-*` colors. Components must consume semantic names instead of raw
gray/blue values for new UI.

| Token family | Meaning | Light | Dark |
| --- | --- | --- | --- |
| `canvas` | app background behind panels | cool 96% | charcoal 9% |
| `surface` | primary panel surface | white | charcoal 12% |
| `surface-muted` | inset areas and quiet rows | cool 98% | charcoal 15% |
| `border` | default separators | cool 89% | cool 23% |
| `ink` / `muted` | primary and secondary copy | dark / gray | light / gray |
| `accent` | active/focus/running | blue 55% | blue 65% |
| `waiting` / `success` / `danger` | state feedback | amber / green / red | brighter variants |

## Surface rules

1. Use `.ds-workbench` as the root shell surface.
2. Use `.ds-panel` for bounded feature areas and `.ds-surface-raised` only for
   floating or elevated surfaces.
3. Use `.ds-panel-header` for panel title rows so all tools share the same 44px
   header rhythm.
4. Use `.ds-command-surface` for the primary prompt/command console.
5. Use `.ds-status` plus one state modifier for task state; do not rely on color
   alone because the dot and label carry the same meaning.

## Accessibility and responsive rules

- Icon-only controls require an accessible label and a visible focus ring.
- Shells use `min-height: 100dvh`, not `100vh`.
- Fixed mobile controls reserve the existing safe-area variables.
- Empty states present one clear next action.
- New transitions stay within 200ms and respect reduced motion.
