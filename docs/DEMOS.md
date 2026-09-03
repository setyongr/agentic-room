# Demo workflows

Use the console driver in [WebMCP §3](WEBMCP.md#3-calling-tools) before running
these examples. Reset to the specified preset before each workflow.

Both workflows start from shipped presets and use only catalog products and
zones. The figures below are acceptance targets; rerun them on the deployed
URL before recording a demo. Budget Rescue starts over budget and becomes
valid after its first replacement.

## Furnish the room

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

## Reduce an over-budget design

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
