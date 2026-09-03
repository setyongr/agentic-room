# WebMCP surface specification

This page specifies the Model Context API surface this app registers — the
contract an agent (the browser's built-in assistant, a console script, or a
review harness) can rely on. Source of truth: `src/webmcp/` and the store
actions it calls. High-level tables also appear in the README; this document
adds lifecycle, envelope, error, and boundary detail.

---

## 1. Overview

The page is its own MCP server — no binary, daemon, or backend. It registers
**22 tools** (10 reads, 12 mutations) against Chrome's in-browser Model
Context API. The human UI and the tools drive the same Zustand store; a tool
call is indistinguishable from a click except for `origin: 'agent'`, which is
what makes the completed action visible in the activity feed.

Implementation files:

| file | role |
| --- | --- |
| `src/webmcp/types.ts` | Minimal local typings for the API (no SDK dependency): tool/schema/annotation shapes. |
| `src/webmcp/registerTools.ts` | `registerRoomTools()` — detection, registration, unregistration, dev-only warnings. |
| `src/webmcp/serialize.ts` | Result envelope helpers, input readers (string/number/object/array), per-tool parsing. |
| `src/webmcp/tools/readTools.ts` | The 10 read tools. |
| `src/webmcp/tools/mutationTools.ts` | The 12 mutation tools. |

## 2. Availability and registration lifecycle

- Detection: `document.modelContext ?? navigator.modelContext`
  (some experimental builds expose `navigator` instead of `document`).
- `WebMcpProvider` (mounted once inside `PlannerShell`) calls
  `registerRoomTools()` inside a client effect and aborts it in cleanup via
  an `AbortController`. On abort the host unregisters the tools, which makes
  the mount safe under React Strict Mode's mount → cleanup → mount cycle.
- Unsupported browsers: registration is skipped, cleanup is a no-op, and the
  planner works normally with no tools exposed.
- The API is experimental Chrome functionality (verified surface: Chrome
  152). It is available on secure origins; some builds gate it behind an
  origin trial/experimental setting. Confirm with:

```js
document.modelContext ?? navigator.modelContext ?? 'unavailable in this build'
```

- Annotations: reads register `readOnlyHint: true` and
  `untrustedContentHint: false` (all output is first-party application
  data). Destructive tools (remove/load/reset paths) carry the destructive
  hint where the host schema supports it.

## 3. Calling tools — envelope

```js
const mc = document.modelContext ?? navigator.modelContext;
const tools = await mc.getTools();                  // tools MUST come from getTools()
const tool = tools.find((t) => t.name === 'place_product');
const raw = await mc.executeTool(tool, JSON.stringify(args)); // args MUST be a JSON string
```

Known host quirks (all handled by the README driver snippet):

- `executeTool` **rejects plain objects** — arguments must be a JSON string.
- The tool object passed to `executeTool` must be the one returned by
  `getTools()` (the host attaches an `origin` member the registered copy
  lacks).
- `getTools()` may return `inputSchema` as a JSON **string** even though
  `registerTool` accepted an object — normalize with `JSON.parse` when
  needed.
- Results may arrive as the tool JSON directly (observed in the browser
  relay build) or wrapped in the MCP envelope
  `{content:[{type:'text', text:'<JSON>'}]}` — normalize by unwrapping
  `content[0].text` when present.

Every tool result is a JSON object with a `success` discriminant:

```jsonc
// success
{ "success": true, "...tool data": "..." }
// failure — never thrown, never partial
{ "success": false, "error": "Human readable message", "code": "machine_code", "...details": "..." }
```

## 4. Read tools (10) — never mutate state

| Tool | Purpose | Key arguments |
| --- | --- | --- |
| `get_room_state` | Room dimensions/openings (plus supported resize ranges), room appearance (wall/floor/wallpaper ids), every placed item (id, name, category, extents, position, rotation, locked, source, budget price, color/material variant), budget, live pricing, live validation, last saved design name | — |
| `get_available_placement_zones` | Zones accepting `category` with capacity left: footprints, occupancy, remaining | `category` (enum) |
| `search_products` | Deterministic catalog search: free-text + category/style/color/material/price filters, dimension window (`maxWidth`/`maxDepth`), sort, paging | `query`, `category`, `styles`, `colors`, `materials`, `minPrice`, `maxPrice`, `inStockOnly`, `sort`, `maxWidth`, `maxDepth`, `page`, `pageSize` |
| `get_product` | Full catalog record for one product + compatible placement zones (`{id,name,kind}[]`) + its placed instances | `productId` |
| `check_layout` | Re-run validation → `valid`, `issueCount`, every issue (kind/severity/message/instances) | — |
| `calculate_total` | Budget breakdown: per-item lines, marketplace/existing/grand totals, signed remaining, over-budget flag | — |
| `get_budget_pressure` | `under_budget | at_budget | over_budget`, `amountOver`, replaceable marketplace items sorted most-expensive-first | — |
| `find_cheaper_alternatives` | Cheaper, in-stock, same-category candidates for one placed marketplace item, ranked by compatibility then savings, with scores | `instanceId`, `targetPrice?`, `maxResults?` |
| `get_saved_designs` | Session designs, newest first: name, id, item count, budget, marketplace total and room appearance at save time | — |
| `render_scene_snapshot` | Render the current 3D room to a JPEG image (data URL) for visual/vision checks: `view` = `live` (editor camera as last left) or `orbit`/`top`/`front`/`side` overviews framed without moving the user's camera; output downscaled to `maxWidth`. Captures only the 3D canvas — never UI overlays or text. Returns `format`, `width`, `height`, `dataUrl` | `view?`, `maxWidth?` |

Read annotations: `readOnlyHint`, no feed-logging of arguments. Read-only
calls still append *completion* entries ("Inspected the room: …",
"Searched the marketplace: 1 match", "Layout check passed") to the activity
feed because the feed observes agent activity, not state changes — those
templates never contain query text or other free-form content.

## 5. Mutation tools (12) — same store actions as the UI, `origin: 'agent'`

| Tool | Purpose | Key arguments |
| --- | --- | --- |
| `place_product` | Add a product. `zoneId` places at the zone center with category/capacity/footprint enforcement; `position {x, z}` places explicitly. Schema requires **exactly one** of `zoneId`/`position` (`oneOf`). Optional `color`/`material` select the visual variant (defaults: first authored color + authored material); unknown colors/materials fail with `invalid_variant`. Returns the item (with its stored variant) + refreshed pricing/layout | `productId`, `zoneId` **or** `position`, `rotation?`, `color?`, `material?` |
| `move_product` | Move an item to new x/z (locked items may move; geometry is not re-checked — validation refreshes immediately after) | `instanceId`, `position {x, z}` |
| `rotate_product` | Set yaw degrees; normalized to [0, 360) | `instanceId`, `rotation` |
| `remove_product` | Remove an item (destructive hint; locked → `item_locked`) | `instanceId` |
| `set_item_locked` | Lock/unlock; locked rejects remove/replace but allows move/rotate. Setting the current value is a success no-op | `instanceId`, `locked` |
| `set_budget` | Budget ≥ 0; refreshes the budget validation + pricing immediately | `budget` |
| `set_room_appearance` | Style the room (visual only; pricing/layout untouched). Either `preset: "default"` or all three explicit finish ids; mixed/partial inputs fail with `invalid_args`. Returns the resolved appearance + layout | `preset` **or** `wallFinishId` + `floorFinishId` + `wallpaperId` |
| `resize_room` | Resize the room shell to real measured dimensions. All of `width`/`depth`/`height` in meters within the supported ranges (`get_room_state` → `room.resizeLimits`; out-of-range fails with `invalid_room_size`). Openings keep their walls (scaled proportionally, clamped on-wall; openings whose wall became too short are removed and reported) and placement zones rebuild with the room. Furniture never moves — pieces left outside the new walls surface as layout errors. Returns `status` (`resized`/`unchanged`), `dimensions`, `floorAreaM2`, `removedOpeningIds` + refreshed pricing/layout | `width`, `depth`, `height` |
| `replace_product` | Swap the product behind an item: same category, in stock, unlocked. Preserves `instanceId`/position/rotation/source; keeps the current color when the replacement offers it, else resets to the replacement's first color, always with the replacement's material. Returns `savings` (negative when pricier) + refreshed layout/pricing | `instanceId`, `replacementProductId` |
| `save_design` | Capture the live design (room, items with variants, room appearance) as a named snapshot; returns the design summary incl. appearance. Fails with `user_models_not_savable` while session-uploaded models are placed (uploads are never stored) | `name`, `thumbnailGradient?` |
| `load_design` | Restore a session design incl. room appearance and item variants (destructive: current design is discarded; unknown id → `design_not_found`); restored block includes appearance | `designId` |
| `add_to_cart` | Add placed marketplace instances at catalog prices; all-or-nothing — any unknown/existing/already-carted instance rejects the whole request | `instanceIds` (array) |

Each successful mutation returns the store's refreshed `pricing` and
`layout` alongside its specific payload (e.g. `place_product` → `item`;
`replace_product` → `item`, `savings`; `set_budget` → `budget`), so an agent
never needs a second round trip to confirm consequences.

## 6. Structured errors

Failures use machine-stable codes; messages are for humans and may change.
Codes surface verbatim from the domain, so new domain failures flow through
unchanged. Codes exercised by the test suite and demo workflows:

| code | meaning |
| --- | --- |
| `invalid_args` | Schema-level parse failure at the tool boundary (wrong type, missing required field, budget < 0, `position` malformed, `zoneId`/`position` missing). |
| `missing_product` | Unknown catalog product id. |
| `missing_instance` | Unknown placed-instance id. |
| `existing_instance` | Instance is seeded room furniture (`source: 'existing'`) and the action requires a marketplace item. |
| `locked_instance` / `item_locked` | Item is locked and the action is not allowed on locked items. |
| `invalid_budget` | Budget not finite or negative. |
| `design_not_found` | `load_design` id not saved this session. |
| `duplicate_instance_ids` | Snapshot/design contains duplicate instance ids. |
| `invalid_snapshot` | Snapshot shape is corrupt and cannot be restored. |
| `cart_checked_out` | Cart is no longer accepting items. |
| `cart_add_rejected` | Some requested instances could not be added (details list the rejections). |
| `invalid_variant` | Place/replace requested a color not offered by the product or a mismatched material (details: `requestedVariant`, `availableColors`, `availableMaterials`). |
| `invalid_room_appearance` | Appearance update referenced an unknown finish/wallpaper id (details: `field`, `value`, `allowedValues`). |
| `invalid_room_size` | Room resize requested dimensions outside the supported ranges (details: `dimensions`, `limits`). |
| `user_models_not_savable` | `save_design` while session-uploaded models are placed (uploads are never stored; details: `userModelIds`). |
| `user_model_not_found` | User-model action referenced an id that is no longer placed. |
| `invalid_rotation` | Uploaded-model rotation is not a finite number of degrees. |

Zone placement can also fail with placement-specific codes defined in
`src/domain/placement.ts` (category disallowed, zone capacity/footprint
limits, no fit found) — the tool layer returns them verbatim with a
human-readable `message`. For the authoritative set, grep `fail(` in
`src/domain/*.ts`.

Guarantees: failures never throw, never partially apply, and leave the store
byte-identical. A mutation that fails reports no feed entry and no
`lastMutation` bump.

## 7. Privacy and observability boundary

- The activity feed records only **completed** actions, composed from fixed
  templates plus structured fields (`instanceId`, `productId`, `amount`).
  Tool descriptions and schemas are static strings; there is no code path by
  which free-form text (queries, prompts, reasoning) reaches the feed or the
  DOM.
- Feed is bounded (50 entries); the UI shows the newest six with a "Latest"
  chip; monetary amounts render only for money event types.
- Read-only tools log completion, never contents. No telemetry, no network,
  no persistence of agent activity outside the page session.

## 8. Testing the surface

Full manual passes live in `docs/TESTING.md`; the two end-to-end demo flows
(human-readable, with exact expected numbers) are in the README under
"Demo workflows". Quick start for a reviewer:

```bash
bun install
bun run dev              # http://localhost:3000
# DevTools console → confirm availability, then:
const mc = document.modelContext ?? navigator.modelContext;
await mc.getTools();     // expect 22 registered names
```

Then run the driver snippet from README ("Testing the WebMCP integration in
Chrome") and watch the status bar's Agent activity entry update on every
call.
