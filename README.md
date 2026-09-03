# WebMCP — a room planner your browser assistant can drive

WebMCP is a small but complete living-room design studio: a deterministic
furniture marketplace, a 3D room editor, budget-aware pricing and layout
validation, saved designs, and a shopping cart — all in the browser, with no
backend and no AI provider. What makes it different is that the page **exposes
its own tools through Chrome's Model Context API** (`document.modelContext`).
A model-context client — the browser's built-in on-page assistant, or any
script with access to the page — can inspect the room, place and swap
furniture, and manage the budget through the exact same code paths the human
UI uses, while every completed action appears in a visible activity feed.

The point is not the furniture. It is a concrete demonstration of the Model
Context API as a **shared, verifiable handoff between a web app and an
agent**:

- **No server-side MCP host needed.** The page is its own MCP server: it
  registers 21 tools (10 reads, 11 mutations) with JSON schemas and safety
  annotations against Chrome's in-browser Model Context API. There is no
  `webmcp` binary, no WebSocket daemon, no API key, and nothing to deploy
  besides the page itself.
- **One source of truth.** Every tool executes against the same Zustand store
  as the human UI, using the same store actions with `origin: 'agent'`. A
  mutation from the assistant re-renders the 3D scene, refreshes pricing and
  validation, and appends to the activity feed synchronously — exactly as if a
  person had clicked it. There is no scraping, no duplicated algorithms, and
  no way for the agent's view of the room to drift from the user's.
- **Inspectable, not creepy.** The activity feed records only **completed
  actions** — "Placed “Nook Coffee Table” in the “Center Table” zone",
  "Replaced “Terra Coffee Table” with “Nook Coffee Table”" — composed from
  fixed application templates with structured fields. Agent reasoning or chain
  of thought never appears on the page, and read-only tools never log private
  content.
- **Deterministic and safe.** The catalog, room geometry, and validation are
  hand-authored constants; ids and timestamps are minted from a fixed session
  epoch plus a per-session counter, so replaying the same action sequence
  reproduces identical state. Mutations fail with structured error codes
  (`item_locked`, `zone_full`, `missing_product`, …) without ever partially
  applying or throwing, and browsers without the API simply run the UI
  untouched.

## How it works

```
                    ┌──────────────────────────────────────────────┐
                    │                browser page                  │
                    │                                              │
  human UI ────────►│  Zustand room store (single source of truth) │
  (clicks, forms)   │  furniture · budget · pricing · validation   │
                    │  saved designs · cart · activity feed        │
                    │        ▲                            ▲        │
                    │        │ same actions               │         │
                    │        │ origin: 'agent'            │         │
  Chrome Model ─────┤  WebMcpProvider ── 21 tools ────────┘         │
  Context API       │  (registerRoomTools)                          │
  (assistant /      │  document.modelContext.registerTool(...)      │
  console script)   └──────────────────────────────────────────────┘
```

- **Registration.** `WebMcpProvider` (mounted once inside `PlannerShell`)
  calls `registerRoomTools()` in a client effect. It feature-detects
  `document.modelContext` (and `navigator.modelContext` on experimental
  builds), then registers the 21 tools sequentially, honoring an
  `AbortController` signal whose abort unregisters them — which makes the
  effect safe under React Strict Mode's mount → cleanup → mount cycle.
  Unsupported browsers get a no-op cleanup: the planner works, tools just
  aren't exposed.
- **Execution.** Read tools are annotated `readOnlyHint: true,
  untrustedContentHint: false` (first-party data only) and return compact
  JSON with capped lists (25 items). Mutations route through the store's
  domain functions; on success the store recomputes `pricing` and
  `validation` synchronously, and on failure returns the domain's
  `{success:false, error, code, ...details}` payload unchanged — no throw, no
  partial mutation.
- **Activity feed.** Every completed agent action appends one entry assembled
  from a fixed per-event template plus structured fields (`instanceId`,
  `productId`, `amount`); callers can never inject free-form text. The feed is
  bounded at 50 entries, and the UI shows the newest 6 with a "Latest" chip
  and dollar amounts for money events. The human UI never writes to the feed
  — only `origin: 'agent'` actions do.

## Capabilities

- **Marketplace**: 79 hand-authored products across 15 categories with
  prices, meter dimensions, style tags, colors, materials, and stock; search
  with free-text, category, style, color, material, and price filters,
  deterministic sorting (relevance / price / name), and pagination. Product
  cards show every colorway (with stock, dimensions, material, and
  compatible zones) and place the colorway you pick.
- **Room styling**: four wall finishes, four floor finishes, and three
  optional wallpaper patterns, chosen from accessible swatch cards and
  rendered procedurally on the 3D walls and floor; a stage overlay and saved
  design thumbnails reflect the current styling.
- **3D room editor**: a procedural 6 × 4.5 × 2.8 m living room (React Three
  Fiber) with three wall openings (entry door, east window, balcony door),
  ten placement zones (media wall, reading corner, sofa sides, window side,
  …), orbit/top/front/side cameras, click-to-select, and validation-driven
  highlights.
- **Placement intelligence**: zone placement enforces category allowance,
  occupancy limits, and footprint fit; layout validation checks room bounds,
  furniture overlap (soft items like rugs never block), opening clearance,
  zone compatibility and membership, budget, stock, and catalog integrity —
  errors fail, warnings inform.
- **Budget & pricing**: only marketplace-sourced items count against the
  budget; existing room items are listed but free. Live totals, signed
  remaining, over-budget status, and budget pressure (with replaceable items
  sorted most-expensive-first) are always one read away.
- **Design workflow**: save named snapshots, restore them, reset the room,
  load the Budget Rescue preset, and add placed marketplace items to a cart
  (existing items can never be purchased).
- **Shared editing surface**: room inspection, product discovery, placement,
  movement, rotation, locking, removal, budget changes, design snapshots, and
  cart updates all operate on the same state whether initiated in the UI or
  through WebMCP. Agent-only helpers add structured zone, pressure, and
  alternative analysis.

## The tool surface — 21 tools

All results are JSON strings: `{success:true, ...}` or
`{success:false, error, code, ...details}`. Argument names match the JSON
schema exactly (`camelCase` keys; `position` is a nested `{x, z}` object).

### Reads (10) — read-only, never mutate state

| Tool | Purpose | Key arguments |
| --- | --- | --- |
| `get_room_state` | Full snapshot: room dimensions, openings, room appearance (wall/floor/wallpaper), every placed item (id, name, category, dimensions, position, rotation, lock, source, budget price, color/material variant), budget, live pricing, validation issues, last saved design name | — |
| `get_available_placement_zones` | Zones that accept a category and still have capacity, with occupancy and remaining slots | `category` (enum) |
| `search_products` | Catalog search with filters, dimension window, deterministic sort and paging | `query`, `category`, `styles`, `colors`, `materials`, `minPrice`, `maxPrice`, `inStockOnly`, `sort`, `maxWidth`, `maxDepth`, `page`, `pageSize` |
| `get_product` | One product's full catalog details, its compatible placement zones, plus its placed instances | `productId` |
| `check_layout` | Re-run validation: valid flag plus every issue (kind, severity, message, affected instances) | — |
| `calculate_total` | Full budget breakdown: marketplace/existing subtotals, grand total, budget, signed remaining, over-budget flag, one line per item | — |
| `get_budget_pressure` | under/at/over-budget status, remaining, amount over, replaceable marketplace items sorted by price (most expensive first) | — |
| `find_cheaper_alternatives` | Cheaper same-category, in-stock replacements for one placed marketplace item, ranked by style/color/material/dimension compatibility then savings, with scores | `instanceId`, `targetPrice?`, `maxResults?` |
| `get_saved_designs` | Designs saved this session, newest first, with budget, item count, marketplace total, and room appearance at save time | — |
| `render_scene_snapshot` | Render the live 3D room to a JPEG data URL so an agent can judge the visual result: `view` = `live` or the standard `orbit`/`top`/`front`/`side` overviews (user camera untouched); downscaled to `maxWidth`; canvas only, never UI text | `view?`, `maxWidth?` |

### Mutations (11) — same store actions as the UI, `origin: 'agent'`

| Tool | Purpose | Key arguments |
| --- | --- | --- |
| `place_product` | Add a product: `zoneId` centers it in a zone (category/capacity/fit enforced), or `position {x, z}` places it explicitly; optional `rotation` and optional `color` (a product colorway; its authored material is applied). Returns the item with its stored variant plus refreshed pricing and layout | `productId`, `zoneId` **or** `position`, `rotation?`, `color?`, `material?` |
| `move_product` | Move a placed item to new x/z coordinates (locked items may move; the move itself is unvalidated, validation refreshes immediately) | `instanceId`, `position` |
| `rotate_product` | Set yaw rotation in degrees, normalized to [0, 360) | `instanceId`, `rotation` |
| `remove_product` | Remove a placed item (destructive; locked items rejected with `item_locked`) | `instanceId` |
| `set_item_locked` | Lock or unlock an item; locked items cannot be removed or replaced but may move/rotate | `instanceId`, `locked` |
| `set_budget` | Set the design budget (≥ 0); only marketplace items count against it; budget check refreshes immediately | `budget` |
| `replace_product` | Swap the product backing an item (same category, in stock, unlocked); keeps instance id, position, rotation, source, and the color when the replacement offers it; returns the price `savings` (negative when pricier) | `instanceId`, `replacementProductId` |
| `set_room_appearance` | Style the room: all three finish ids or `preset: "default"`; visual only, never affects pricing or layout | `wallFinishId`, `floorFinishId`, `wallpaperId` **or** `preset` |
| `save_design` | Capture the live design (room, items with variants, appearance) as a named snapshot | `name`, `thumbnailGradient?` |
| `load_design` | Restore a session snapshot, including room appearance and item variants (destructive: current design is discarded; unknown ids fail with `design_not_found`) | `designId` |
| `add_to_cart` | Add placed marketplace items to the cart at catalog prices; all-or-nothing (unknown, existing, or already-carted instances reject the whole request) | `instanceIds` (array) |

## Quick start

Requires [Bun](https://bun.sh) (the repo pins `bun@1.3.14`).

```bash
bun install
bun run dev        # start the Next.js dev server → http://localhost:3000
```

The app itself needs no setup beyond that: open `http://localhost:3000` and
the planner renders with the default demo room (locked sofa and rug, an
existing console, a $700 budget, nothing spent).

The interface is one continuous workspace: the 3D room dominates the viewport,
the left rail switches between **Furnish** (marketplace catalog) and **Edit**
(placed pieces — selecting a piece in the room opens its editor), and
**Designs**, **Cart**, and **Agent activity** open as focused drawers from the
top bar or status bar. A slim status bar always shows layout validity, piece
count, spend, and remaining budget; on phones the same controls live in a
bottom bar and the rail becomes a bottom sheet.

Other commands:

```bash
bun run check      # typecheck (tsc --noEmit)
bun run test       # run the test suite (vitest) — 54 tests, 7 files
bun run build      # production build
bun run start      # serve the production build
```

## Testing the WebMCP integration in Chrome

The Model Context API is experimental. It is enabled on secure origins
(localhost counts) in Chrome builds that ship it — the surface this app
registers against was verified on **Chrome 152** — but some builds gate it
behind the Model Context origin trial or an experimental feature setting. The
app degrades gracefully: if both `document.modelContext` and
`navigator.modelContext` are `undefined`, the UI works normally and no tools
are registered. Confirm availability with:

```js
// DevTools console on http://localhost:3000
document.modelContext ?? navigator.modelContext ?? 'unavailable in this build'
```

Once available, drive the tools from the console (the same surface the
browser's built-in assistant uses):

```js
const mc = document.modelContext ?? navigator.modelContext;
const run = async (name, args = {}) => {
  const tools = await mc.getTools(); // tools must come from getTools()
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);

  const raw = await mc.executeTool(tool, JSON.stringify(args)); // args must be a JSON string
  const parsed = JSON.parse(raw);
  // Chrome integrations may expose the tool JSON directly or inside an MCP envelope.
  return Array.isArray(parsed?.content)
    ? JSON.parse(parsed.content[0].text)
    : parsed;
};
```

Chrome-specific quirks handled by the snippet: `executeTool` rejects plain
objects, so arguments are passed as a JSON **string**; the tool object must be
the one returned by `getTools()` because it carries host metadata; and
`getTools()` may return `inputSchema` as a JSON string. The result-normalizing
branch supports both the direct JSON string observed in the browser relay and
the MCP-shaped `{content:[{type:'text', text:'…'}]}` envelope used by other
Model Context integrations.

Watch the **Agent activity** entry in the status bar (open its drawer from
there) as you call tools: each completed action appears, and every mutation
also updates the 3D scene, the header budget line, and the validation state
live.

## Demo workflows

Both workflows start from shipped presets, use only catalog products and
zones, and were verified end-to-end against the registered tools (layout
`valid: true`, `issueCount: 0` at every step).

### Hero workflow — furnish the empty room, $594 of a $700 budget

The default demo room (what you see on load) has the locked sofa and rug, the
existing entry console, a $700 budget, and **zero marketplace spend**. Finish
the room with four marketplace pieces:

```js
await run('get_room_state');                                              // 3 items, newTotal 0
await run('get_available_placement_zones', { category: 'coffee_table' }); // Center Table: 1 slot free
await run('place_product', { productId: 'budget-rescue-table-value', zoneId: 'center-table' });   // Nook Coffee Table  $175
await run('place_product', { productId: 'budget-rescue-lamp-value',  zoneId: 'sofa-side-east' }); // Twist Floor Lamp    $89
await run('place_product', { productId: 'budget-rescue-chair-value', zoneId: 'reading-corner' }); // Lita Accent Chair  $240
await run('place_product', { productId: 'fiddle-leaf-fig',           zoneId: 'back-wall' });      // Fiddle Leaf Fig     $90
await run('check_layout');      // { success: true, valid: true, issueCount: 0 }
await run('calculate_total');   // newTotal: 594, budget: 700, remaining: 106, overBudget: false
await run('add_to_cart', {
  instanceIds: ['budget-rescue-table-value-1', 'budget-rescue-lamp-value-1',
                'budget-rescue-chair-value-1', 'fiddle-leaf-fig-1'],
});                             // 4 lines, cart total $594
```

Placement runs through the domain: each product fits its zone (footprint,
category, capacity), every item lands inside the room clear of all openings,
and no hard furniture overlaps. The result: **$594 spent of $700, $106
remaining, valid layout, four marketplace pieces**, and a cart holding all
four. Instance ids are deterministic (`<productId>-1`); the feed shows one
entry per action, from "Inspected the room" through "Added 4 items to the
cart".

### Budget Rescue — from $1,140 over a $1,000 budget to $684, $316 to spare

The Budget Rescue preset is the same room with four premium marketplace
pieces (Terra Coffee Table $340, Halo Floor Lamp $220, Aria Accent Chair
$310, Alder Ladder Shelf $270 = **$1,140 against a $1,000 budget** — layout
fully valid, price not). Load it with the **Load Budget Rescue** button in
the **Designs** drawer (top-right **Save design** opens it; **Reset room**
there returns to the default demo), then swap each premium piece for its
value replacement:

```js
await run('get_room_state');        // 6 items; pricing: newTotal 1140, remaining -140, overBudget true
await run('get_budget_pressure');   // status "over_budget", amountOver 140
                                    // replaceable: Terra 340, Aria 310, Alder 270, Halo 220
await run('find_cheaper_alternatives', { instanceId: 'rescue-coffee-table', targetPrice: 200 });
                                    // → Nook Coffee Table $175, savings $165
await run('replace_product', { instanceId: 'rescue-coffee-table',  replacementProductId: 'budget-rescue-table-value' }); // $975, $25 remaining
await run('replace_product', { instanceId: 'rescue-floor-lamp',    replacementProductId: 'budget-rescue-lamp-value' });   // $844, $156 remaining
await run('replace_product', { instanceId: 'rescue-accent-chair',  replacementProductId: 'budget-rescue-chair-value' }); // $774, $226 remaining
await run('replace_product', { instanceId: 'rescue-shelf',         replacementProductId: 'budget-rescue-shelf-value' });  // $684, $316 remaining
await run('check_layout');      // { success: true, valid: true, issueCount: 0 }
await run('calculate_total');   // newTotal: 684, budget: 1000, remaining: 316, overBudget: false
```

Replacements keep each item's instance id, position, rotation, and source, and
report the savings (165 + 131 + 70 + 90 = **$456 rescued**). The result:
**$684 spent of $1,000 — $316 remaining** — with the identical layout still
valid. The feed tracks the whole rescue: "Found 1 cheaper alternative for
“Terra Coffee Table”", then one "Replaced … with …" entry per swap, each with
its dollar amount.

## Tests

```bash
bun run test
```

54 tests across 7 pure-domain suites (`src/domain/*.test.ts`), run with
Vitest under jsdom:

| Suite | Tests | Covers |
| --- | --- | --- |
| `validation.test.ts` | 5 | bounds, overlap tolerance, east-window, balcony-door, and entry-door clearance |
| `pricing.test.ts` | 6 | existing-vs-marketplace accounting, over-budget reporting, replacement repricing |
| `placement.test.ts` | 13 | locked-item rules, remove/replace/move/rotate invariants, colorway resolution and preservation |
| `designs.test.ts` | 10 | snapshot save/restore fidelity and isolation, corrupt-input rejection, appearance/variant round-trips |
| `cart.test.ts` | 8 | marketplace-only adds, all-or-nothing rejection, dedupe, totals |
| `alternatives.test.ts` | 5 | candidate filtering, ranking determinism, caps, structured errors |
| `appearance.test.ts` | 7 | room appearance updates: immutability, same-value no-ops, invalid id rejection |

## Project structure

```
src/
  app/              Next.js App Router shell (page, layout, global styles)
  components/
    planner/        workspace shell: PlannerShell (stage + rail + drawers),
                    PlannerHeader (budget + actions), WorkspaceStatusBar,
                    WorkspaceDrawer; panels: FurnitureInspector,
                    DesignCartPanel (designs/cart), AgentActivityFeed
    marketplace/    MarketplacePanel (search, filters, product rows)
    three/          R3F scene: room architecture, furniture meshes,
                    camera controller (orbit/top/front/side), canvas
    WebMcpProvider  single Model Context registry host for the page
  data/             deterministic catalog (79 products), placement zones,
                    room appearance registry, demo presets (default demo +
                    Budget Rescue)
  domain/           pure logic: catalog, placement, validation, pricing,
                    alternatives, designs, cart, activity, shared types
  store/            roomStore — the single Zustand source of truth
  webmcp/           Model Context API surface: registerTools, serialize,
                    tools/readTools.ts (9), tools/mutationTools.ts (11)
```

Each `src/` directory and every runtime rule is explained in depth in
`docs/ARCHITECTURE.md`; the Model Context surface is specified in
`docs/WEBMCP.md`; commands and verification passes live in `docs/TESTING.md`.

## Documentation

- `docs/ARCHITECTURE.md` — module map, state model and actions, domain rules,
  determinism, UI composition, 3D rendering approach.
- `docs/WEBMCP.md` — the Model Context surface: registration lifecycle,
  result envelope, per-tool schema, structured errors, privacy boundary.
- `docs/TESTING.md` — commands, test-suite contracts, and the manual
  desktop/mobile/WebMCP verification pass.

## Deterministic behavior

- **No clocks, no randomness.** State is derived from a fixed session epoch
  (`2026-09-01T00:00:00.000Z`) plus a per-session sequence counter; ids and
  timestamps are minted from the sequence, so replaying the same action
  sequence reproduces byte-identical state.
- **Pure domain.** Search, geometry, pricing, validation, alternatives, and
  cart logic are pure functions over immutable inputs; store actions delegate
  to them and never reimplement anything.
- **Stable ordering.** Sort ties keep catalog order (spec-guaranteed stable
  sort); alternative suggestions break ties by compatibility, then savings,
  then product id; validation issues are emitted in a fixed order.
- **Bounded output.** List-heavy read tools cap or paginate results with
  explicit counts; the activity store caps at 50 entries and the UI shows the
  newest 6.

## Limitations

- **Procedural 3D.** The viewport is a decorative, procedurally lit R3F scene
  (primitive meshes, contact shadows, no remote environment or photoreal
  assets). It reflects state faithfully but is not a CAD tool.
- **In-memory state.** Everything lives in the browser's Zustand store.
  Reloading resets to the default demo; there is no persistence, accounts, or
  backend.
- **Simulated cart.** The cart tracks marketplace items at catalog prices;
  checkout and payment are explicitly out of scope — it is a shopping-cart
  demo, not a store.
- **Experimental browser API, no hosted agent.** The Model Context API is a
  Chrome capability still rolling out (see the testing section above); the
  app registers tools for whatever model-context client is present and works
  fine without one. No AI provider, agent process, or inference backend is
  included or contacted — the "agent" is whoever drives the page's
  `modelContext` surface.

## Tech stack

Bun 1.3 (runtime + package manager) · Next.js 16 (App Router) · React 19 ·
TypeScript (strict) · Zustand 5 (state) · Three.js + @react-three/fiber 9 +
@react-three/drei (3D) · Tailwind CSS 4 + lucide-react (UI) · Vitest 4 +
jsdom (tests).
