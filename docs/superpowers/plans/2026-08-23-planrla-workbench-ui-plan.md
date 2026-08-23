# Planrla Workbench UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the desktop and mobile Planrla shell so the app reads as an AI agent workbench with clear project context, task state, transcript, command console, and inspector surfaces.

**Architecture:** Keep existing data hooks, routing, WebSocket behavior, and feature panels. Add presentational Workbench components under `src/components/workbench/`, then connect them to the current `AppContent`, `MainContentHeader`, `ChatMessagesPane`, and `ChatComposer` surfaces. Preserve existing primitives and callbacks; only replace layout and visual composition.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, lucide-react, existing shared UI primitives, CSS variables from `src/design-system/workbench.css`.

**Spec:** `docs/superpowers/specs/2026-08-23-planrla-workbench-design-system.md`

## Global Constraints

- New UI uses `workbench-*` semantic tokens and `.ds-*` classes.
- Icon-only controls have `aria-label`; interactive surfaces use existing primitives.
- Shell height uses `100dvh`; fixed mobile controls preserve safe-area variables.
- New files stay below 500 lines; each session stays within the repository's 300-line feature limit.
- Verify each phase with `npm run typecheck` and `npm run build:client`.

---

### Task 1: Workbench shell primitives

**Files:**
- Create: `src/components/workbench/WorkbenchRail.tsx`
- Create: `src/components/workbench/WorkbenchSection.tsx`
- Create: `src/components/workbench/WorkbenchStatus.tsx`
- Create: `src/components/workbench/index.ts`
- Test: `npm run typecheck`

**Interfaces:**
- `WorkbenchRail` accepts navigation items, active item, and an `onSelect` callback.
- `WorkbenchSection` accepts a label, optional action, and `children`.
- `WorkbenchStatus` accepts `running | waiting | complete | failed` and a label.

- [ ] Add typed component props and semantic markup.
- [ ] Use `.ds-panel`, `.ds-label`, `.ds-status`, and lucide icons.
- [ ] Export the components from `index.ts`.
- [ ] Run `npm run typecheck`.

### Task 2: Main workbench surfaces

**Files:**
- Create: `src/components/workbench/WorkbenchHeader.tsx`
- Create: `src/components/workbench/WorkbenchInspector.tsx`
- Create: `src/components/workbench/WorkbenchEmptyState.tsx`
- Modify: `src/components/app/AppContent.tsx`
- Modify: `src/components/main-content/view/subcomponents/MainContentHeader.tsx`
- Test: `npm run typecheck`, `npm run build:client`

**Interfaces:**
- The header consumes current project/session labels and existing tab callbacks.
- The inspector receives extension panel visibility and close/open callbacks.
- The empty state receives the existing new-session callback.

- [ ] Replace shell-level chrome with Workbench surfaces without changing data flow.
- [ ] Make the right inspector visually subordinate but persistent when opened.
- [ ] Give empty states one explicit next action.
- [ ] Run typecheck and client build.

### Task 3: Transcript and command console styling

**Files:**
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`
- Modify: `src/components/chat/view/subcomponents/ChatComposer.tsx`
- Modify: `src/components/sidebar/view/subcomponents/SidebarContent.tsx`
- Test: `npm run typecheck`, `npm run build:client`

**Interfaces:**
- Keep existing message virtualization, composer submission, file mentions, and sidebar search behavior unchanged.
- Apply Workbench tokens to message grouping, tool rows, prompt console, project/session rows, and status affordances.

- [ ] Restyle transcript grouping for readable agent/user/tool hierarchy.
- [ ] Restyle the composer as `.ds-command-surface` with existing prompt controls.
- [ ] Tighten sidebar density and add clear project/session state grouping.
- [ ] Run typecheck and client build.

### Task 4: Full-page states and responsive pass

**Files:**
- Modify: `src/components/main-content/view/MainContent.tsx`
- Modify: `src/components/extension-panel/view/ExtensionPanel.tsx`
- Modify: `src/index.css`
- Test: `npm run typecheck`, `npm run build:client`, `npm test`

- [ ] Apply the Workbench layout to chat, files, Git, tasks, browser, terminal, settings, and project-empty states.
- [ ] Ensure mobile navigation, safe areas, and inspector collapse remain usable.
- [ ] Run all verification commands and record any pre-existing native dependency failures.
