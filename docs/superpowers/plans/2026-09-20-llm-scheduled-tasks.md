# LLM Scheduled Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conversational CRUD and confirmation for recurring LLM schedules while preserving the existing cron-prompts executor.

**Architecture:** Add a small schedule command service around the existing cron-prompts store/driver. Expose it through the provider tool route used by chat, with mutations represented as confirmation requests; after confirmation, the existing driver creates a fresh Agent session for each trigger.

**Tech Stack:** TypeScript, Express, SQLite, node-cron, existing provider spawn/session services, existing chat permission/tool protocol.

**Spec:** `docs/superpowers/specs/2026-09-20-llm-scheduled-tasks.md`

## Global Constraints

- Do not execute shell commands or native crontab entries for this feature.
- Mutation operations require confirmation before persistence.
- Preserve existing uncommitted user changes and modify only feature-scoped files.
- Run backend typecheck and focused tests before claiming completion.

---

### Task 1: Schedule command domain contract

**Files:**
- Create: `server/modules/cron-prompts/llm-schedule-commands.ts`
- Test: `server/modules/cron-prompts/llm-schedule-commands.test.ts`

- [ ] Write failing tests for create/list/update/delete command validation and confirmation payloads.
- [ ] Run the focused test and verify the missing module failure.
- [ ] Implement pure command parsing/building without database side effects.
- [ ] Run the focused test and verify all cases pass.

### Task 2: Connect commands to existing cron execution

**Files:**
- Modify: `server/modules/cron-prompts/cron-prompts.store.ts`
- Modify: `server/modules/cron-prompts/cron-prompts.routes.ts`
- Modify: `server/modules/cron-prompts/index.ts`
- Test: `server/modules/cron-prompts/cron-prompts.routes.test.ts`

- [ ] Add route/service tests proving an approved command persists through the existing store and reloads the driver.
- [ ] Run tests red before implementation.
- [ ] Implement the smallest service adapter and keep `cronPromptsDriver` as the only executor.
- [ ] Run focused route tests green.

### Task 3: Expose conversational tools and confirmation

**Files:**
- Modify: `server/modules/mcp/session-query-mcp.route.ts`
- Modify: `server/modules/providers/list/zcode/zcode-mcp.provider.ts`
- Test: `server/modules/cron-prompts/llm-schedule-commands.test.ts`

- [ ] Add `schedule_create`, `schedule_confirm`, `schedule_list`, `schedule_update`, `schedule_delete`, and `schedule_run_now` schemas.
- [ ] Make mutation tools return a confirmation request instead of writing immediately.
- [ ] Wire confirmation approval to the schedule command service.
- [ ] Run the provider tool tests and backend typecheck.

### Task 4: Verification and documentation

- [ ] Run focused cron tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build:client` if frontend code changed.
- [ ] Verify a real schedule creation, approval, trigger handoff, and generated session without leaving a test schedule behind.
