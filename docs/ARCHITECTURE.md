# Architecture

This document is the deep-dive companion to the README. It maps every
`src/` module, explains the state model and the domain rules, and records
the invariants reviewers should hold the code to.

**Status:** current as of commit `0de4c7a` (Slate + Indigo single-workspace UI).

---

## 1. Design principles

1. **One source of truth.** All state — room geometry, furniture, budget,
   pricing, validation, saved designs, cart, activity feed — lives in a
   single Zustand store (`src/store/roomStore.ts`). The human UI and the 19
   WebMCP tools are two front-ends over the same store actions. There is no
   server state and no duplicated algorithm.
2. **Pure, deterministic domain.** `src/domain/*` contains pure functions
   over immutable inputs. They never touch `Date.now()`, `Math.random()`,
   global state, or the DOM. All ids and timestamps are minted by the store
   from a fixed session epoch plus a per-session counter, so replaying an
   action sequence reproduces identical state.
3. **Structured failure, never throws.** Domain functions and store actions
   return `SerializableResult`/`SerializableError`
   (`{ok:false, code, message, details?}`). A failed mutation never partially
   applies. Failures are JSON-serializable end to end so the WebMCP layer can
   surface them verbatim.
4. **Observable agent actions, private reasoning.** The WebMCP surface only
   logs *completed* actions via fixed application templates. Prompts, chain
   of thought, and free-form user text never reach the activity feed.
5. **UI is a thin consumer.** Components subscribe to narrow store slices
   with selectors (`src/store/selectors.ts`); they do not reimplement domain
   logic. The 3D viewport is `aria-hidden` decoration — semantic, keyboard
   accessible controls live outside the canvas.

## 2. Repository map

```
src/
  app/
    layout.tsx          Root metadata/viewport (slate theme colors) + globals
    page.tsx            Renders <PlannerShell />
    globals.css         Tailwind v4 @theme tokens (see §7)
  components/
    WebMcpProvider.tsx  Mounts the Model Context registry once (client effect)
    planner/            UI shell + secondary surfaces (see §6)
    marketplace/        MarketplacePanel — catalog sidebar content
    three/              React Three Fiber scene (see §8)
  data/
    products.ts         78 hand-authored products, category/style/color lists
    placementZones.ts   10 named zones with footprints, categories, hints
    demoRoom.ts         Default demo preset + Budget Rescue preset snapshots
  domain/
    types.ts            Shared types: products, room, validation issues,
                        snapshots, cart, activity; enums and constants
    catalog.ts          Product lookup + deterministic search/sort/paging
    placement.ts        Zone placement, move/rotate/remove/replace rules
    validation.ts       Layout/budget/stock/catalog validation (issue list)
    pricing.ts          Marketplace-only budget math + budget pressure
    alternatives.ts     Cheaper-compatible-alternative ranking
    designs.ts          Snapshot capture/restore (deep, validated copies)
    cart.ts             Marketplace-only cart rules
    activity.ts         Activity feed model: types, templates, bounds
    *.test.ts           Colocated Vitest suites (6 files, 39 tests)
  store/
    roomStore.ts        The Zustand store: state, actions, commit pipeline
    selectors.ts        Stable derived selectors (selected item, totals, …)
  webmcp/
    types.ts            Local Model Context API typings (no SDK dependency)
    registerTools.ts    Feature detection + registration/unregistration
    serialize.ts        Result envelopes, read helpers, argument parsing
    tools/readTools.ts      9 read tools
    tools/mutationTools.ts  10 mutation tools
```

## 3. Data model (`src/domain/types.ts`)

### Room (`RoomData`)

The demo room is a **6.0 × 4.5 × 2.8 m** box in centered coordinates:
`x ∈ [-3, 3]`, `z ∈ [-2.25, 2.25]`, north wall at `z = -2.25`, south wall at
`z = +2.25`. `RoomData` carries:

- `dimensions` — width/depth/height in meters.
- `openings` — three wall openings with x/z-centered rectangular footprints:
  - `entry-door` (west wall, `z` around −1),
  - `east-window` (east wall; a window with `sillHeight`),
  - `balcony-door` (south wall).
- `placementZones` — ten logical zones, each with an x/z-centered
  `footprint`, an `allowedCategories` list, an optional `maxItems` capacity,
  a suggestion `rank`, and a one-line `hint` used by saved designs and zone
  guidance. Zones overlap the `living-area` anchor intentionally (e.g.
  `center-table`, `sofa-side-west/east`); category rules are defined so no
  placement is attributed to a zone that rejects it.

### Products (`FurnitureProduct`)

`id`, `name`, `category` (15 categories), `price` (USD), meter extents
`width/depth/height`, `styleTags`, `colors`, `material`, `stock`,
`defaultRotation?`, `thumbnailGradient?`. All data is hand-authored in
`src/data/products.ts`; nothing is fetched at runtime.

### Placed furniture (`PlacedFurniture`)

`instanceId` (deterministic), `productId`, `position` (`Vec3`, y = floor
base), `rotation` (yaw degrees about +y; 0 = front faces +z/south),
`locked`, `source` — `'existing'` (part of the seeded room) or
`'marketplace'`. **Only `marketplace` items count toward the budget.**
Locked items cannot be removed or replaced; they can still be moved and
rotated.

### Validation issues (`ValidationIssue`)

Discriminated on `kind`, each with `severity`, `message`, affected
`instanceIds`, optional `refId` (zone/opening) and `footprint`:

| kind | severity | meaning |
| --- | --- | --- |
| `out_of_bounds` | error | footprint crosses a room wall |
| `overlap` | warning | hard furniture footprints intersect beyond tolerance |
| `blocks_opening` | error | footprint intersects a door/window clearance |
| `zone_mismatch` | warning | category not allowed in the zone containing the center |
| `outside_zone` | warning | center is not inside any placement zone |
| `budget_exceeded` | error | marketplace total > budget |
| `out_of_stock` | error | a placed product has zero stock |
| `missing_product` | error | a placed product is not in the catalog |

`ValidationResult.valid` is false when any **error**-severity issue exists;
warnings inform but do not invalidate.

### Snapshots, cart, activity

- `DesignSnapshot` — deep, serializable copy of room/items/budget plus
  name/timestamps; restore validates shape and rejects duplicates.
- `Cart` — lines of marketplace items priced from the catalog, `status:
  active | checked_out`; only placed marketplace instances may be added.
- `ActivityEntry` — `id`, `type` (19 fixed kinds), `message` (fixed
  template), optional `instanceId`/`productId`/`amount`; bounded feed.

## 4. State and actions (`src/store/roomStore.ts`)

### State slices

| field | notes |
| --- | --- |
| `room` | static geometry (from `data/`) |
| `furniture` | readonly array; every write replaces it (never mutated in place) |
| `budget` | number ≥ 0 |
| `selectedInstanceId` / `cameraMode` | view state (never feed-logged) |
| `savedDesigns` / `cart` | session-only |
| `activity` | newest last, bounded (50) |
| `validation` / `pricing` | **live** — recomputed synchronously after every mutation |
| `lastMutation` | monotonic marker bumped once per successful state write (drives UI feedback) |
| `sessionSequence` | deterministic counter; each minted id/timestamp consumes one step |

### Actions

- **View:** `selectItem`, `setCameraMode`.
- **Read helpers:** `getProductById`, `searchProducts`,
  `getAvailablePlacementZones`, `fitProductInZone`, `checkLayout`,
  `calculateTotal`, `getBudgetPressure`, `findCheaperAlternatives`,
  `recordAgentActivity`.
- **Mutations:** `placeProduct`, `moveProduct`, `rotateProduct`,
  `removeProduct`, `setItemLocked`, `replaceProduct`, `setBudget`,
  `saveDesign`, `loadDesign`, `resetToDefault`, `loadBudgetRescue`,
  `addToCart`.

Every mutation follows the same pipeline:

```
prev = get()                      → capture current state
result = domainFunction(...)      → pure, never mutates prev
result.ok? ──no──▶ return result  → unchanged state, structured error
commit(prev, data, origin, activity?)  → ONE atomic set()
  • furniture/items replaced immutably
  • pricing + validation recomputed in the same write
  • if origin === 'agent': append one fixed-template feed entry
  • lastMutation++ and sessionSequence++ for any new ids
```

`origin` is `'human' | 'agent'`. The activity feed is written **only** by
`origin: 'agent'` actions (the WebMCP surface); the human UI never adds
entries. Read-only agent calls (`check_layout`, `calculate_total`,
`search_products`, …) record completion entries with `'agent'` origin —
read tools log *that a read happened*, never the query text.

### Determinism

- Fixed epoch (`2026-09-01T00:00:00.000Z`) + `sessionSequence` produce ids
  like `budget-rescue-table-value-1`, `snapshot-26`, `cart-line-53` and ISO
  timestamps. Nothing in the app reads wall-clock time or randomness.
- Search sorts are stable (ties keep catalog order); alternative rankings
  break ties by compatibility score, then savings, then product id;
  validation issues are emitted in fixed order.

## 5. Domain modules in one paragraph each

| module | responsibility |
| --- | --- |
| `catalog.ts` | Product lookup; `searchProducts` with free-text + category/style/color/material/price filters, dimension windows, deterministic sort, paging; stock awareness. |
| `placement.ts` | Zone discovery for a category, zone fit preview, zone placement (centers item in zone footprint, enforces category/capacity/bounds), explicit x/z placement, move/rotate/remove/replace with lock rules. |
| `validation.ts` | Runs the issue checks from §3 in fixed order against room, furniture, and budget. |
| `pricing.ts` | Marketplace-only totals (`newTotal` vs existing/grand), signed remaining, `getBudgetPressure` (under/at/over status + replaceable items most-expensive-first). |
| `alternatives.ts` | For one placed marketplace item: cheaper same-category in-stock candidates ranked by style/color/material/dimension compatibility then savings; `totalSavings`. |
| `designs.ts` | Snapshot capture/restore with deep copies and shape/duplicate validation; never aliases live state. |
| `cart.ts` | Adds only placed marketplace instances; all-or-nothing; unique line ids; catalog prices; rejects post-checkout adds. |
| `activity.ts` | Feed constants: bounded size, fixed per-type message templates with structured fields. |

## 6. UI composition

### Workspace shell (`PlannerShell`)

One viewport-sized column: `PlannerHeader` (64px) → room stage →
`WorkspaceStatusBar`, with drawers layered on top. The WebMCP provider
mounts exactly once inside the shell.

- **Left rail (20rem, ≥ `lg`):** Furnish/Edit segmented switch renders
  exactly one panel — `MarketplacePanel` (Furnish) or `FurnitureInspector`
  (Edit). Placing a product or selecting a room piece switches the rail to
  Edit. Below `lg` the rail becomes a bottom sheet: closed it is `inert`
  (removed from tab order and the accessibility tree), open it is a modal
  dialog with focus trap, Escape close, and focus restore to the opener.
- **Room stage:** full-bleed `RoomCanvas`; floating overlays are
  pointer-transparent except the camera controls (`RoomCameraControls`,
  exported by `PlannerHeader.tsx`) and status chips.
- **Drawers (`WorkspaceDrawer`):** Designs, Cart, Agent activity open as
  right-side drawers (bottom sheets on phones) with scrim, Escape, Tab trap,
  and focus restore. `DesignCartPanel` takes `view: 'designs' | 'cart'` and
  renders only the requested surface; `AgentActivityFeed` is drawer content.
- **Status bar (`WorkspaceStatusBar`):** `lg+` shows layout validity, piece
  count, spend, remaining budget, and the latest agent action (button opens
  the activity drawer). Below `lg` it is a three-action bottom bar
  (Furnish / Edit · validity dot / Activity).

### Panels

- **MarketplacePanel** — flat sidebar content: search, category select, one
  `Filters` disclosure (style/color/price), flat product rows with compact
  "Place" actions (auto-zone placement), pagination, empty state. It owns its
  scroll only when mounted in the rail.
- **FurnitureInspector** — placed-items list + selected-piece editor
  (position form, rotation steps, lock/unlock, remove, per-item validation
  issues) in a single internal scroll region; the polite status footer stays
  pinned below the scroll area.
- **DesignCartPanel** — `designs`: name + save, saved list with Load,
  Reset room (two-step confirm), Load Budget Rescue; `cart`: add-all
  available, line list with totals. Flat divided rows; status messages are
  polite `role="status"` regions.
- **AgentActivityFeed** — newest-six of the bounded feed, fixed-template
  messages, monetary amounts only for money event types, polite
  `role="log"`, a "Latest" chip, and a useful empty state.
- **PlannerHeader** — brand/plan identity, Designs + Cart (with live count)
  entries, spend/budget control (opens a keyboard-modal budget dialog routed
  through `setBudget(budget, 'human')`), Save design (opens the Designs
  drawer for a named save), plus one visually hidden `h1` ("Living room
  planner") for page semantics.

Accessibility invariants used throughout: 44px touch targets, visible indigo
focus rings, `motion-reduce` support, `aria-live="polite"` announcements,
and canvas content mirrored in readable text.

## 7. Theming (`src/app/globals.css`)

Tailwind CSS 4 maps semantic custom properties onto utilities via
`@theme inline`, so components use token classes only:

| token utilities | value (light / dark) |
| --- | --- |
| `bg-background` | `#f8fafc` slate-50 / `#0f172a` slate-900 |
| `bg-surface` / `-raised` / `-muted` | white / slate-100 tints · slate-800/900 |
| `text-text` / `-muted` / `-faint` | slate-950 / slate-500 / slate-400 |
| `border-border` | slate-200 / slate-700 |
| `bg-accent` `text-on-accent` | indigo-600 · hover indigo-700 |
| `text-accent-strong` / `bg-accent-soft` | indigo-700 / indigo-50 |
| `success` / `warning` / `error` (+ `-soft`) | emerald / amber / red |
| `shadow-card` / `shadow-pop` | restrained slate shadows |
| `rounded-card` / `rounded-control` | 12px / 8px |

Status colors are semantic only; selection and primary actions are indigo.
Components never hard-code hex values.

## 8. 3D scene (`src/components/three/`)

- `RoomCanvas` — client R3F `<Canvas>`: DPR capped at 2, soft PCF shadows,
  suspended scene with a quiet procedural fallback, `aria-hidden`.
- `RoomArchitecture` — room shell: procedural floor texture (canvas, created
  once), off-white walls, baseboards, window frames/glass, and door/window
  clearances; clearance surfaces tint amber-neutral when clear and red when
  blocked. Colors are cool slate-family to match the UI.
- `FurnitureMesh` — every catalog category maps to procedural primitives
  (boxes/cylinders) sized to the product's real extents, with material-aware
  palette lookups. Geometry is memoized per product + selection. New/replaced
  items pop in; move/rotate damp toward store targets in `useFrame`
  **without per-frame allocations**. Flat rings mark selection and invalid
  placement; pointer events bubble to select the instance.
- `CameraController` — orbit/top/front/side presets; constrained so users
  cannot get lost below the floor or far outside the room.
- `RoomScene` — subscribes to room/furniture/validation/selection and
  assembles architecture + meshes.

The scene is decorative-but-faithful: it renders exactly the store state and
provides click selection, while every human action also has a semantic,
keyboard-accessible control outside the canvas.

## 9. WebMCP surface

See `docs/WEBMCP.md` for the full protocol spec. In brief: `WebMcpProvider`
calls `registerRoomTools()` in an effect, feature-detects
`document.modelContext ?? navigator.modelContext`, registers 19 tools with
JSON schemas and safety annotations, and unregisters on cleanup (Strict Mode
safe). Tools call the same store actions as the UI with `origin: 'agent'`
and return serializable JSON or structured failures — no throws, no partial
mutations.

## 10. Invariants reviewers should verify

- Domain functions are pure and never mutate caller-owned arrays/objects.
- Failed store actions leave state byte-identical (`lastMutation` untouched).
- The activity feed can only be appended through fixed templates; no free-form
  text path exists from tools to the feed.
- Only `marketplace` items contribute to `newTotal`; replacements keep
  `instanceId`/position/rotation/source and repricing is exact.
- Locked items reject remove/replace everywhere (UI and tools) but allow
  move/rotate.
- WebMCP read tools never mutate state; tools and UI share one store instance
  (no drift).
- No runtime clock/randomness, no network calls, no remote assets.
