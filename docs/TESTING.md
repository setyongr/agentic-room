# Testing and verification

Automated coverage and manual checks for the planner and WebMCP integration.

## 1. Commands

Requires [Bun](https://bun.sh) 1.3 (pinned via `packageManager`).

```bash
bun install --frozen-lockfile # install the committed dependency versions
bun run check      # TypeScript strict typecheck  (tsc --noEmit)
bun run test       # Vitest domain suites         (jsdom environment)
bun run build      # production static build     (Sites)
bun run build:next # standard Next.js build      (.next/)
bun run build:sites # Sites static export          (out/)
bun run start      # serve the production build   (http://localhost:3000)
bun run dev        # development server with HMR
```

Expected baseline at time of writing: typecheck clean, **135 tests across 9
files**, production build succeeds with a single static route (`/`).

### Release-preparation pass — September 3, 2026

- Typecheck, all 66 domain tests, and the production build pass.
- Local production UI checked at 1440×900 and 375×812: one branded `h1`,
  one marketplace panel, no document-level overflow. Product-details controls
  are named and usable; mobile-sheet Escape restores focus to its opener.
- Codex in-app browser discovered the 22 tools. Room inspection, scene
  capture, the four-piece furnishing workflow (including the $594 cart), and Budget
  Rescue ($684 total, $316 remaining) succeeded through the registered tools.
- The production route, bundled GLB, and committed preview returned HTTP 200.
- Basic credential-pattern checks found no matches in the working sources
  or ten existing commits. This was not a comprehensive security audit.
- Non-blocking Three.js dependency warnings for `PCFSoftShadowMap` and
  `Clock` deprecations remain; no dependency upgrade was attempted.

This is a scoped local check, not a full accessibility audit or proof that
every tool/error case was exercised. A deployed-origin check, other browser
clients, and the complete manual matrix below remain release checks for the
chosen host. No public deployment was performed.

## 2. Automated suites (`src/domain/*.test.ts`)

All tests are deterministic unit tests over public domain exports with real
catalog products and the seeded room — no React, no store, no WebMCP.

| Suite | Tests | Contract covered |
| --- | --- | --- |
| `validation.test.ts` | 11 | Out-of-bounds detection; overlap tolerance with vertical-band semantics; `height_bounds` ceiling/floor checks; east-window (sill-aware), balcony-door, and entry-door clearance blocking. Each fixture isolates exactly one issue so removing the validator fails the test. |
| `placement.test.ts` | 24 | Locked items reject removal/replacement with `item_locked`; locked items stay movable/rotatable; failed actions never mutate caller-owned arrays; unlocked removal succeeds. Variant contract: catalog-default resolution, authored colorway storage, `invalid_variant` rejection with available-value details, variant preservation across move/rotate/lock, and keep-or-reset color on replacement. Ownership re-tagging (`setItemSource`) preserves every other field, allows locked items, no-ops on the same source. Elevation (`setItemElevation`) rejects negative/non-finite heights with `invalid_elevation`, no-ops on the same height, and `moveProduct` preserves the raised height. |
| `resize.test.ts` | 47 | `resizeRoom`: supported-range enforcement (`invalid_room_size` with limits details); proportional opening rescaling per wall (grow/shrink, on-wall clamping, ceiling height caps that never re-grow), opening removal when a wall becomes too short; zone rescaling with unusable-zone drops; identical-dimension no-op preserving the input reference; input immutability; stable survivor order; sequential resizes from live dimensions. Opening placement: `moveOpening` along a wall or onto another wall (clamped, `opening_overlap` on collisions), `addOpening` presets with auto-centering on the first free span, `removeOpening`, and `setOpeningDimensions` width/height/sill limits (`invalid_opening_size` details) — each with deterministic error codes and input immutability. `emptyRoom`: empty openings with zones scaled/dropped for any footprint. |
| `pricing.test.ts` | 6 | Existing items contribute $0; marketplace items price at current catalog prices; signed remaining/over-budget semantics; missing catalog products never corrupt totals; replacement repricing is exact. |
| `alternatives.test.ts` | 5 | Candidates are in-stock, strictly cheaper, same category, dimensionally compatible; savings exact; ranking deterministic (pinned order); `maxResults`/`targetPrice` respected; structured errors (`missing_instance`, `existing_instance`, `locked_instance`, `missing_product`). |
| `appearance.test.ts` | 7 | `updateRoomAppearance`: immutable single-field updates; same-value/empty patches return the original reference; invalid wall/floor/wallpaper ids rejected in wall → floor → wallpaper order with exact `field`/`allowedValues` details. |
| `designs.test.ts` | 10 | Snapshot capture/restore fidelity and deep-copy isolation (mutating one side never affects the other); seeded demo snapshot restores byte-identically; corrupt/duplicate input rejected with structured codes. Room appearance and per-item variants round-trip byte-for-byte and are deep-cloned; missing/malformed appearance or variant data fails with `invalid_snapshot`. |
| `cart.test.ts` | 19 | Marketplace-only adds (existing sofa/rug can never enter); all-or-nothing rejection; unique line ids; dedupe of already-carted instances; totals match catalog prices. Per-line `removeCartItem` recalculates totals, supports prune-to-empty, and fails with `cart_item_not_found`/`cart_checked_out`. Mock `checkoutCart` returns a deterministic order summary and marks the cart checked out (`cart_empty` guard); `clearCart` restarts an empty active cart. |
| `catalog.test.ts` | 6 | Catalog integrity: data/domain category lists in sync, unique ids, positive extents, colors/materials inside the filter vocabularies. Audio-visual additions: TV/soundbar/speaker categories searchable, name-queryable, and placeable on the media-wall zone. |

## 3. WebMCP verification (browser)

The tools are only observable in a browser that ships the Model Context API.
Use the [WebMCP browser setup](WEBMCP.md#2-availability-and-registration-lifecycle)
and record the browser/client version. The planner remains usable without WebMCP.

### 3.1 Setup

```bash
bun run build && bun run start   # or: bun run dev
# open http://localhost:3000
```

Confirm the API is present and 31 tools registered:

```js
const mc = document.modelContext ?? navigator.modelContext;
(await mc.getTools()).map((t) => t.name); // 31 names: 11 reads + 20 mutations
```

### 3.2 Driver

Use the [console driver](WEBMCP.md#3-calling-tools). It handles the JSON-string arguments and envelope
normalization. Successful logged actions update **Agent activity**; mutations
also update the scene, spend, or validity as appropriate. Scene snapshots,
failed calls, and no-op mutations need not add an activity entry.

### 3.3 Required checks

1. **Every read tool** returns `success: true` with no room-design change
   (`get_room_state` item count is unchanged after the batch). Fixed-template
   activity entries are allowed. `get_planner_guide` returns the static site
   orientation payload (site identity, capabilities with their tool names,
   workflow, boundaries) and logs nothing. Scene capture requires a mounted,
   working WebGL canvas; before it is ready, expect `capture_unavailable`.
2. **Every mutation tool** round-trips: `place_product` → item appears in
   `get_room_state` and in the Edit rail list; `move_product`/`rotate_product`
   update `position`/`rotation`; `set_item_locked` flips `locked`;
   `set_budget` changes `pricing.budget`; `replace_product` changes
   `productId` while keeping `instanceId`; `save_design` →
   `get_saved_designs` lists it; `load_design` restores it; `add_to_cart`
   increments the cart; `remove_product` removes it.
   Variant/style round-trips: `place_product` with a non-default `color`
   (and matching material) returns an item whose `variant` matches in
   `get_room_state`; `set_room_appearance` (explicit ids, then `preset:
   "default"`) changes and restores `get_room_state.appearance` with one
   fixed "Updated room finishes" feed entry per actual change and none for a
   repeated identical call; `save_design` → change appearance → `load_design`
   restores both appearance and item variants.
   Room-geometry round-trips: `resize_room` to e.g. 5 × 3.5 × 2.6 →
   `get_room_state.room.dimensions` matches and openings stay on their walls;
   the same call again → `status: "unchanged"`; resizing narrower than a
   seeded piece leaves the item coordinates untouched and surfaces it in
   `validation` as `out_of_bounds`; resetting the room restores 6 × 4.5 × 2.8.
   New-tool round-trips:
   - `set_item_source` flips `source` between `existing`/`marketplace` and
     moves the item in/out of `pricing.newTotal`; repeating the same source
     is a no-op success.
   - `set_item_elevation` changes `position.y` (raise a TV to ~1.2 m); a
     `move_product` afterwards keeps that height; y = 3 surfaces a
     `height_bounds` layout error.
   - `move_opening` slides an opening along its wall (`alongCenterM`
     changes); `wall` relocates it to another wall; `add_opening` adds a
     standard door/window to any wall (id `opening-N` appears in
     `get_room_state.room.openings`); `remove_opening` deletes it;
     `resize_opening` changes `alongWidthM`/`heightM`/`sillM`, and the 3D
     scene frames follow the new sill.
   - `remove_cart_item` drops one `add_to_cart` line and shrinks the cart
     total; `new_project` returns `furnitureCount` 0 and `openingCount` 0
     while `get_room_state.room.dimensions` keeps the measured size and the
     default demo room still returns on a fresh page load.
3. **Invalid calls return helpful errors** (all `success: false`):
   - `set_budget` with `-1` → `invalid_args`
   - `place_product` with an unknown product → `missing_product`
   - `place_product` with neither `zoneId` nor `position` → `invalid_args`
   - `remove_product`/`replace_product` on a locked item → `item_locked`
   - `find_cheaper_alternatives` on the seeded existing sofa →
     `existing_instance`
   - `load_design` with an unknown id → `design_not_found`
   - `place_product` with a color outside the product's colors or a
     mismatched `material` → `invalid_variant` with `availableColors`/
     `availableMaterials` details
   - `set_room_appearance` with one finish id alone, or `preset` plus
     explicit ids → `invalid_args`
   - `resize_room` with out-of-range dimensions (e.g. width 1.5 or height
     2.2) → `invalid_room_size` with `dimensions`/`limits` details
   - `move_opening`/`add_opening` onto a spot occupied by another opening on
     the same wall → `opening_overlap`; unknown opening ids →
     `opening_not_found`; `resize_opening` beyond the wall/ceiling limits →
     `invalid_opening_size` with `field`/`min`/`max` details
   - `set_item_elevation` with a negative `y` → `invalid_args`
   - `remove_cart_item` for an instance with no cart line →
     `cart_item_not_found`; `checkout_cart`-equivalent UI paths are refused
     on an empty or already-checked-out cart (`cart_empty`,
     `cart_checked_out`)
   - State must be unchanged after each failure (no partial mutation).
4. **Scene sync:** after an agent `place_product`, the 3D room shows the new
   piece (camera Top view helps) and the header spend figure updates.
5. **Feed boundary:** run the full workflows below and confirm the Agent
   activity drawer shows only fixed-template completion messages — no query
   text, no reasoning.

### 3.4 Demo workflows (end-to-end acceptance)

See [Demo workflows](DEMOS.md) for the commands and expected results:

- **Furnishing:** default room → place Nook Coffee Table (Center Table), Twist
  Floor Lamp (Sofa Side East), Lita Accent Chair (Reading Corner), Fiddle
  Leaf Fig (Back Wall) → `check_layout` valid → `calculate_total`
  `newTotal: 594` of `700`, `remaining: 106` → `add_to_cart` totals $594.
- **Budget Rescue:** load the preset (Designs drawer → Load Budget Rescue)
  → `get_room_state` shows `newTotal: 1140`, `remaining: -140` → four
  `replace_product` swaps (165 + 131 + 70 + 90 savings) → `newTotal: 684`,
  `remaining: 316`, layout valid; each swap preserves instance id, position,
  rotation, and source.
- **Start empty, hang a TV, cut a window:** place Aria 55" OLED TV on the
  media wall → `add_to_cart` then `remove_cart_item` (cart empty again) →
  `set_item_source` to `existing` (newTotal back to 0) → `set_item_elevation`
  y 1.2 (hangs) → `add_opening` window on the north wall → `resize_opening`
  sill 1.1 × height 1.2 → `check_layout` valid → `new_project` returns
  `furnitureCount` 0 and `openingCount` 0 at the measured size.

## 4. Human UI verification

### 4.1 Desktop (≥ 1024 px)

- App fits the viewport: no document-level scroll; only the rail and drawers
  scroll internally.
- Rail switches Furnish ⇄ Edit; placing a product (any row's "Place" button)
  switches to Edit with the new piece selected; Clear selection returns the
  rail to its catalog/empty edit guidance.
- Camera switcher (floating in the room) cycles orbit/top/front/side.
- Room size (Furnish rail → Room size): entering real dimensions (e.g.
  5.4 × 3.6 × 2.7 m) and applying updates the 3D shell, the stage size pill,
  and the footer announcement (area, removed openings, pieces left outside);
  shrinking below a piece's extents flags it out-of-bounds in the status bar;
  Reset to demo size restores 6 × 4.5 × 2.8 m; preset camera views keep the
  resized room framed.
- Doors & windows (same Room size tab, below the size form): every opening
  lists its wall, movable range, Move/nudge controls, a "Move to wall"
  selector, Remove with confirm, and a Size block (width/height, plus sill
  height for windows — the window's vertical position). "Add an opening"
  drops a standard door/window onto any wall's first free span; the 3D
  frames, glass, and clearance follow every change.
- Edit rail on a selected piece: Ownership (Already owned / Buy new) moves
  the piece in/out of the marketplace spend instantly; Height above floor
  (input + 0 / 0.45 / 1.2 m presets) lifts pieces off the floor, and the
  X / Y / Z readout reflects it; sliding the piece keeps its height.
- Designs drawer: "New empty project" (two-step confirm) clears every piece,
  door, and window at the current room size and resets budget/finishes,
  while a fresh page load still shows the default demo room.
- Cart drawer: per-line remove buttons, then a mock "Checkout {total}"
  button → checked-out state with order announcement; "Start a new cart"
  resets it for the next shopping round.
- Budget control in the top bar opens a dialog; applying a value updates the
  header spend, status bar, and validation instantly; invalid (negative)
  values show an inline error.
- Save design (top bar) opens the Designs drawer; saving a named design adds
  it to the list; Load restores it; Reset room (two-step confirm) and Load
  Budget Rescue behave.
- Cart drawer: placing marketplace items enables "Add N room item(s)"; cart
  totals match the marketplace spend; line totals and the estimated total
  update after removals and after the mock checkout.
- Agent activity: after the WebMCP checks in §3, the newest six entries show
  with the "Latest" chip and monetary amounts on money events.
- A status message from any action is announced politely (screen-reader
  friendly) and visible without scrolling.

### 4.2 Mobile / tablet (< 1024 px)

- Bottom bar shows Furnish / Edit (with validity dot) / Activity / Model credits; the credits popover lists the bundled sofa's CC-BY attribution.
- Furnish/Edit opens the rail as a bottom sheet with a scrim; the closed
  sheet is not reachable by keyboard (inert); Escape, scrim, and the close
  button dismiss it and restore focus to the opener.
- The open Furnish sheet scrolls vertically through the full furniture
  catalog on touch and with a trackpad, without causing document-level scroll.
- Activity opens the drawer as a bottom sheet; Designs/Cart behave the same.
- No horizontal overflow at 375 px; canvas fills the stage.

### 4.3 Accessibility quick pass

- Exactly one `h1` ("AgenticRoom — Living room planner"); every control has an accessible
  name (icon-only buttons on small screens still named).
- Focus is visible (indigo ring) and never lands on off-screen content;
  modals (drawers, budget dialog, mobile sheet) trap focus and restore it on
  close.
- Live regions: `role="status"` announcements, activity `role="log"` with
  `aria-live="polite"`.
- `prefers-reduced-motion` disables the motion utilities.

## 5. Performance and hygiene sanity

- Fresh load: only same-origin app and bundled asset requests (no remote
  fonts, textures, or images); the default room renders from procedural data.
  The catalog can request the committed sofa preview image without loading its GLB.
  The single bundled sofa GLB (`public/models/sofa-ak-studio.glb`) is fetched
  only when the Noir Studio Sofa product is placed; user-uploaded models load
  separately from their own session object URLs.
- 3D: with a full room (~10+ pieces) orbit/top interactions stay smooth;
  DPR is capped at 2 and frame-loop code performs no allocations
  (see `docs/ARCHITECTURE.md` §8).
- Repository hygiene: no credentials/API keys in source, no
  development-only URLs in production code, `bun run check` + `bun run test`
  + `bun run build` all pass from a clean checkout.
