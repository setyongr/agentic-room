# Testing and verification

Everything a reviewer or contributor needs to validate the repository:
commands, what the automated suites prove, and the manual desktop/mobile/
WebMCP passes that the automated suites deliberately do not cover.

---

## 1. Commands

Requires [Bun](https://bun.sh) 1.3 (pinned via `packageManager`).

```bash
bun install        # install dependencies
bun run check      # TypeScript strict typecheck  (tsc --noEmit)
bun run test       # Vitest domain suites         (jsdom environment)
bun run build      # production build             (Next.js)
bun run start      # serve the production build   (http://localhost:3000)
bun run dev        # development server with HMR
```

Expected baseline at time of writing: typecheck clean, **39 tests across 6
files**, production build succeeds with a single static route (`/`).

## 2. Automated suites (`src/domain/*.test.ts`)

All tests are deterministic unit tests over public domain exports with real
catalog products and the seeded room — no React, no store, no WebMCP.

| Suite | Tests | Contract covered |
| --- | --- | --- |
| `validation.test.ts` | 5 | Out-of-bounds detection; overlap tolerance; east-window, balcony-door, and entry-door clearance blocking. Each fixture isolates exactly one issue so removing the validator fails the test. |
| `placement.test.ts` | 6 | Locked items reject removal/replacement with `item_locked`; locked items stay movable/rotatable; failed actions never mutate caller-owned arrays; unlocked removal succeeds. |
| `pricing.test.ts` | 6 | Existing items contribute $0; marketplace items price at current catalog prices; signed remaining/over-budget semantics; missing catalog products never corrupt totals; replacement repricing is exact. |
| `alternatives.test.ts` | 5 | Candidates are in-stock, strictly cheaper, same category, dimensionally compatible; savings exact; ranking deterministic (pinned order); `maxResults`/`targetPrice` respected; structured errors (`missing_instance`, `existing_instance`, `locked_instance`, `missing_product`). |
| `designs.test.ts` | 9 | Snapshot capture/restore fidelity and deep-copy isolation (mutating one side never affects the other); seeded demo snapshot restores byte-identically; corrupt/duplicate input rejected with structured codes. |
| `cart.test.ts` | 8 | Marketplace-only adds (existing sofa/rug can never enter); all-or-nothing rejection; unique line ids; dedupe of already-carted instances; totals match catalog prices. |

## 3. WebMCP verification (browser)

The tools are only observable in a browser that ships the Model Context API
(verified surface: Chrome 152). The app degrades gracefully everywhere else.

### 3.1 Setup

```bash
bun run build && bun run start   # or: bun run dev
# open http://localhost:3000
```

Confirm the API is present and 19 tools registered:

```js
const mc = document.modelContext ?? navigator.modelContext;
(await mc.getTools()).map((t) => t.name); // 19 names: 9 reads + 10 mutations
```

### 3.2 Driver

Use the `run(name, args)` snippet from README ("Testing the WebMCP
integration in Chrome"). It handles the JSON-string arguments and envelope
normalization. After **every** call, the status bar's **Agent activity**
entry and the shared state (scene, header spend, validity) update — a good
sanity signal that the call landed on the live store.

### 3.3 Required checks

1. **Every read tool** returns `success: true` with no state change
   (`get_room_state` item count is unchanged after the batch).
2. **Every mutation tool** round-trips: `place_product` → item appears in
   `get_room_state` and in the Edit rail list; `move_product`/`rotate_product`
   update `position`/`rotation`; `set_item_locked` flips `locked`;
   `set_budget` changes `pricing.budget`; `replace_product` changes
   `productId` while keeping `instanceId`; `save_design` →
   `get_saved_designs` lists it; `load_design` restores it; `add_to_cart`
   increments the cart; `remove_product` removes it.
3. **Invalid calls return helpful errors** (all `success: false`):
   - `set_budget` with `-1` → `invalid_args`
   - `place_product` with an unknown product → `missing_product`
   - `place_product` with neither `zoneId` nor `position` → `invalid_args`
   - `remove_product`/`replace_product` on a locked item → `item_locked`
   - `find_cheaper_alternatives` on the seeded existing sofa →
     `existing_instance`
   - `load_design` with an unknown id → `design_not_found`
   - State must be unchanged after each failure (no partial mutation).
4. **Scene sync:** after an agent `place_product`, the 3D room shows the new
   piece (camera Top view helps) and the header spend figure updates.
5. **Feed boundary:** run the full workflows below and confirm the Agent
   activity drawer shows only fixed-template completion messages — no query
   text, no reasoning.

### 3.4 Demo workflows (end-to-end acceptance)

Both are reproduced step-by-step in README → "Demo workflows" with exact
expected numbers. Acceptance:

- **Hero:** default room → place Nook Coffee Table (Center Table), Twist
  Floor Lamp (Sofa Side East), Lita Accent Chair (Reading Corner), Fiddle
  Leaf Fig (Back Wall) → `check_layout` valid → `calculate_total`
  `newTotal: 594` of `700`, `remaining: 106` → `add_to_cart` totals $594.
- **Budget Rescue:** load the preset (Designs drawer → Load Budget Rescue)
  → `get_room_state` shows `newTotal: 1140`, `remaining: -140` → four
  `replace_product` swaps (165 + 131 + 70 + 90 savings) → `newTotal: 684`,
  `remaining: 316`, layout valid; each swap preserves instance id, position,
  rotation, and source.

## 4. Human UI verification

### 4.1 Desktop (≥ 1024 px)

- App fits the viewport: no document-level scroll; only the rail and drawers
  scroll internally.
- Rail switches Furnish ⇄ Edit; placing a product (any row's "Place" button)
  switches to Edit with the new piece selected; Clear selection returns the
  rail to its catalog/empty edit guidance.
- Camera switcher (floating in the room) cycles orbit/top/front/side.
- Budget control in the top bar opens a dialog; applying a value updates the
  header spend, status bar, and validation instantly; invalid (negative)
  values show an inline error.
- Save design (top bar) opens the Designs drawer; saving a named design adds
  it to the list; Load restores it; Reset room (two-step confirm) and Load
  Budget Rescue behave.
- Cart drawer: placing marketplace items enables "Add N room item(s)"; cart
  totals match the marketplace spend.
- Agent activity: after the WebMCP checks in §3, the newest six entries show
  with the "Latest" chip and monetary amounts on money events.
- A status message from any action is announced politely (screen-reader
  friendly) and visible without scrolling.

### 4.2 Mobile / tablet (< 1024 px)

- Bottom bar shows Furnish / Edit (with validity dot) / Activity.
- Furnish/Edit opens the rail as a bottom sheet with a scrim; the closed
  sheet is not reachable by keyboard (inert); Escape, scrim, and the close
  button dismiss it and restore focus to the opener.
- Activity opens the drawer as a bottom sheet; Designs/Cart behave the same.
- No horizontal overflow at 375 px; canvas fills the stage.

### 4.3 Accessibility quick pass

- Exactly one `h1` ("Living room planner"); every control has an accessible
  name (icon-only buttons on small screens still named).
- Focus is visible (indigo ring) and never lands on off-screen content;
  modals (drawers, budget dialog, mobile sheet) trap focus and restore it on
  close.
- Live regions: `role="status"` announcements, activity `role="log"` with
  `aria-live="polite"`.
- `prefers-reduced-motion` disables the motion utilities.

## 5. Performance and hygiene sanity

- Fresh load: no network asset requests beyond the Next.js bundle (no remote
  fonts, textures, or images); scene renders from procedural data.
- 3D: with a full room (~10+ pieces) orbit/top interactions stay smooth;
  DPR is capped at 2 and frame-loop code performs no allocations
  (see `docs/ARCHITECTURE.md` §8).
- Repository hygiene: no credentials/API keys in source, no
  development-only URLs in production code, `bun run check` + `bun run test`
  + `bun run build` all pass from a clean checkout.
