# AGENTS.md — working in this repository

Guide for coding agents (and human contributors) making changes to the WebMCP
Furniture Room Planner. Read this before editing; read `docs/ARCHITECTURE.md`
before touching anything structural.

## What this is

A Next.js 16 + React 19 + TypeScript (strict) single-page living-room planner
with no backend: a deterministic furniture catalog and room store in the
browser, a React Three Fiber 3D editor, and a WebMCP surface — the page
registers 19 tools against Chrome's Model Context API
(`document.modelContext`/`navigator.modelContext`) so a browser agent can
drive the exact same store actions as the human UI. All product/room data is
hand-authored constants; nothing is fetched at runtime.

## Commands (Bun)

```bash
bun install        # dependencies
bun run dev        # dev server → http://localhost:3000
bun run check      # typecheck (tsc --noEmit)      — run before finishing
bun run test       # Vitest domain suites (39 tests, 6 files)
bun run build      # production build
bun run start      # serve production build
```

Read-only exploration of the running app is done with the browser tool; the
Model Context API of this app is driven from the page via the driver snippet
in `docs/WEBMCP.md` §3 (JSON-string args, envelope normalization, tools must
come from `getTools()`).

## Repository map

```
src/
  domain/    pure logic + types + colocated *.test.ts   ← ground truth rules
  data/      products.ts (78), placementZones.ts (10), demoRoom.ts (presets)
  store/     roomStore.ts (single Zustand source of truth), selectors.ts
  webmcp/    registerTools.ts, serialize.ts, tools/{read,mutation}Tools.ts
  components/ planner/ (shell + panels + drawers), marketplace/, three/ (R3F)
  app/       page.tsx, layout.tsx, globals.css (Tailwind v4 tokens)
docs/
  ARCHITECTURE.md   module map, state model, invariants, UI, 3D, theming
  WEBMCP.md         protocol spec: lifecycle, envelope, tools, errors
  TESTING.md        commands, suite contracts, manual verification passes
README.md           product overview, quick start, demo workflows
```

## Invariants (never break)

1. **One source of truth.** UI and WebMCP tools call the same store actions.
   Never add a second store, page-local state that mirrors domain state, or a
   tool path that bypasses the store/domain functions.
2. **Pure deterministic domain.** `src/domain/*` functions never use clocks,
   randomness, globals, or DOM; never mutate caller-owned arrays/objects.
   Ids/timestamps come from the store's fixed session epoch + sequence.
3. **Structured failure.** Mutations return
   `{ok:false, code, message, details?}`; failures never throw and never
   partially apply. Tools surface domain errors verbatim. New failure
   conditions should reuse or extend this shape with a stable `code`.
4. **Activity privacy boundary.** The feed records only completed agent
   actions via fixed templates in the store (`recordAgentActivity` + action
   commit, `origin: 'agent'` only). Never add a path that pushes free-form
   text (prompts, queries, reasoning) into activity messages or the DOM.
5. **Locked semantics.** Locked items reject remove/replace everywhere;
   move/rotate always allowed.
6. **Budget semantics.** Only `source: 'marketplace'` items count toward
   `newTotal`; replacements keep instance id/position/rotation/source.
7. **No new runtime dependencies or network assets** without an explicit
   ask. The 3D scene is procedural; thumbnails are CSS gradients.

## Conventions

- **Types/domain first.** Rules live in `src/domain`; store actions delegate
  and never reimplement. Selectors (`store/selectors.ts`) stay thin and
  return stable references.
- **UI.** Tailwind v4 semantic tokens only (slate/white surfaces, indigo
  accent, semantic status colors — no hard-coded hex in components). Keep
  the single-workspace structure: dominant 3D stage, Furnish/Edit rail,
  drawer surfaces for Designs/Cart/Activity, slim status bar. Preserve
  accessibility requirements: one `h1`, named controls at every breakpoint,
  44px targets, visible focus, Escape + focus trap + restore for every modal
  surface (drawers, mobile sheet, budget dialog), polite live regions,
  `motion-reduce` support.
- **WebMCP tools** are thin adapters: parse args via `serialize.ts` readers,
  call the store action with `origin: 'agent'`, return `toolOk`/`toolFail`.
  Reads declare `readOnlyHint`; descriptions stay precise and static.
- **Tests** are colocated `*.test.ts` in `src/domain`, pure and
  deterministic, asserting observable contracts (result discriminants first).
  Adding a domain rule or error code → add/extend a test.
- **Scope discipline.** Don't reformat untouched files, don't run
  project-wide suites mid-task; the orchestrator runs `check` + `test` +
  `build` at the end. Do not install packages or add config without asking.

## Common change patterns

- **New catalog product:** add to `src/data/products.ts` (id/name/category/
  price/extents/styles/colors/material/stock). Validate through a test that
  searches for it.
- **New room rule:** implement in `src/domain/validation.ts` (issues) or
  `placement.ts` (placement constraints), expose via store action, add a
  test, then decide whether a WebMCP tool should surface it.
- **New WebMCP tool:** add to `src/webmcp/tools/readTools.ts` (read) or
  `mutationTools.ts` (mutation) following the existing factory pattern;
  registration is automatic. Update README + `docs/WEBMCP.md` tool tables.
- **UI change:** verify against the running app at 1440×900 and 375×812 and
  confirm no document-level scroll, no duplicate mounted panels, and no
  lost accessible names/announcements.

## When reviewing this repo

Start with `docs/ARCHITECTURE.md` §10 (invariants checklist), then run
`docs/TESTING.md` §2–§5 (automated suites, WebMCP pass, UI pass, hygiene).
