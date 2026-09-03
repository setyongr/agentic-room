/**
 * AgenticRoom planner guide — the structured "AGENTS.md for WebMCP".
 *
 * The Chrome Model Context API surface this page registers against is
 * tool-only (registerTool/getTools/executeTool): there is no native
 * site-instructions channel. The guide below is the WebMCP-idiomatic
 * equivalent — a static, deterministic, first-party read tool
 * (`get_planner_guide`) that any agent can call first to learn what the
 * site is, what it can do, which tools to use for each job, and the
 * invariants agents must respect. Content is authored here, not scraped
 * from the DOM, and never contains session state.
 */

import { PRODUCTS } from '@/data/products';
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from '@/data/appIdentity';
import { FURNITURE_CATEGORIES } from '@/domain/types';

/** Stable guide version; bump when agent-facing semantics change. */
export const PLANNER_GUIDE_VERSION = 1;

/** Tool description (<=500 characters): what the guide returns and why to call it first. */
export const PLANNER_GUIDE_DESCRIPTION =
  'Orientation for agents that just opened this site: what AgenticRoom is, what the room editor can do, the exact tools to use for each task, a recommended design workflow, and the invariants agents must respect (budget semantics, locks, session-only uploads). Call this first, then get_room_state for the live design. Static, first-party content; never mutates state and never reads session data.';

/** Every capability of the planner, each mapped to its WebMCP tools. */
const CAPABILITIES: readonly { name: string; summary: string; tools: readonly string[] }[] = [
  {
    name: 'Furniture placement and editing',
    summary:
      'Add catalog furniture to placement zones or exact coordinates, then move, rotate, lock, remove, or swap the product behind any piece.',
    tools: [
      'place_product',
      'move_product',
      'rotate_product',
      'set_item_elevation',
      'set_item_locked',
      'remove_product',
      'replace_product',
    ],
  },
  {
    name: 'Ownership and budget',
    summary:
      'Re-tag any piece as already owned ("existing", never counted toward the budget) or as a new marketplace purchase; set the budget and read live totals and pressure.',
    tools: ['set_item_source', 'set_budget', 'calculate_total', 'get_budget_pressure'],
  },
  {
    name: 'Room shell: size, openings, finishes',
    summary:
      'Resize the room to real measurements, add/move/relocate/remove doors and windows on any wall, and restyle walls, floor, and wallpaper.',
    tools: [
      'resize_room',
      'add_opening',
      'move_opening',
      'remove_opening',
      'resize_opening',
      'set_room_appearance',
    ],
  },
  {
    name: 'Searching and guidance',
    summary:
      'Browse the hand-authored catalog with deterministic filters, inspect placement-zone compatibility, and get cheaper in-stock alternatives for expensive pieces.',
    tools: ['search_products', 'get_product', 'get_available_placement_zones', 'find_cheaper_alternatives'],
  },
  {
    name: 'Validation and visual checks',
    summary:
      'Re-run layout validation (bounds, overlaps, opening clearances, zones, stock), recompute totals, and render the 3D room to an image for vision checks.',
    tools: ['check_layout', 'render_scene_snapshot'],
  },
  {
    name: 'Designs and cart',
    summary:
      'Save the current design as a session snapshot, restore one later, and add placed marketplace pieces to the shopping cart.',
    tools: [
      'save_design',
      'load_design',
      'get_saved_designs',
      'new_project',
      'add_to_cart',
      'remove_cart_item',
    ],
  },
];

/** Recommended first steps for designing a room with an agent. */
const WORKFLOW: readonly string[] = [
  'Call get_planner_guide for orientation, then get_room_state to see the live room, openings, placed items, budget, pricing, and validation before changing anything.',
  'Search the catalog with search_products (category/style/color/price filters, dimension windows) and inspect a product with get_product for full details and compatible zones.',
  'Place pieces with place_product — zoneId centers them in a valid zone; position {x, z} places explicitly. Choose a colorway the product actually offers, then use set_item_elevation to hang wall pieces (TVs, wall art, shelves) at a height instead of on the floor.',
  'Re-tag pieces the user already owns with set_item_source source="existing" so they never count against the budget; everything else stays marketplace and is what set_budget/calculate_total measure.',
  'Adjust the room itself: resize_room to real measurements, add/move/relocate/remove doors and windows with add_opening/move_opening/remove_opening, resize any opening (width, height, and window sill height — the vertical position of a window) with resize_opening, and style it with set_room_appearance.',
  'Check consequences with check_layout and calculate_total after every batch; use render_scene_snapshot to judge the visual result, and get_budget_pressure/find_cheaper_alternatives when over budget.',
  'When the design is right, save it with save_design so the user can restore it from the Designs panel; marketplace pieces can be added to the cart with add_to_cart and pruned again with remove_cart_item so the cart holds only the handful of items the user intends to buy. To start from scratch (the default demo room is only the initial showcase), clear the canvas with new_project — it keeps the measured room size and empties every item, door, and window.',
];

/** Rules agents must respect while operating this site. */
const BOUNDARIES: readonly string[] = [
  'One shared store: tools and the human UI drive identical state, so every successful mutation updates the 3D scene, pricing, and validation synchronously. Failures never partially apply — the design is byte-identical after any error.',
  'Budget semantics: only source="marketplace" items count toward the budget. Price, stock, geometry, and validation never depend on colorways. Locked items cannot be removed or replaced (set_item_locked first) but can always move and rotate.',
  'Openings: doors and windows live on walls and carry real clearance; furniture that blocks one is an error. Adding or moving an opening is refused when it would collide with another opening on the same wall (opening_overlap) or when the wall cannot host it (invalid_opening_position).',
  'Determinism: ids and timestamps are deterministic per session (instances like "sofa-product-1", added openings like "opening-1"). No clocks, no randomness — replaying the same tool calls reproduces identical state.',
  'Session-only uploads: models the user uploads via the UI are a visual layer outside this tool surface — they are excluded from room data, budgets, validation, cart, and saved designs; save_design refuses while one is placed. Never claim uploads are persisted or agent-editable.',
  'Activity privacy: the page logs only completed agent actions through fixed templates (never prompts or reasoning). Keep calls purposeful; tool schemas are static and first-party.',
  'The catalog is hand-authored and rendered procedurally in the 3D scene (one optional bundled GLB); there are no remote assets and no backend.',
];

/** Catalog overview derived from the live data modules (deterministic at load). */
function catalogSummary(): Record<string, unknown> {
  return {
    productCount: PRODUCTS.length,
    categoryCount: FURNITURE_CATEGORIES.length,
    categories: [...FURNITURE_CATEGORIES],
    audioVisualCategories: ['tv', 'soundbar', 'speaker'],
    note: 'Category ids are stable and shared by search_products filters, placement zones, and placed items.',
  };
}

/** The full guide payload returned by the get_planner_guide read tool. */
export function buildPlannerGuide(): Record<string, unknown> {
  return {
    guideVersion: PLANNER_GUIDE_VERSION,
    site: {
      name: APP_NAME,
      tagline: APP_TAGLINE,
      about: APP_DESCRIPTION,
      note: 'WebMCP names the protocol, not this application.',
    },
    startHere: 'Call get_room_state to inspect the live design before the first mutation.',
    catalog: catalogSummary(),
    capabilities: CAPABILITIES.map((capability) => ({ ...capability, tools: [...capability.tools] })),
    workflow: [...WORKFLOW],
    boundaries: [...BOUNDARIES],
    note: 'Every capability lists its exact tool names; tool descriptions and this guide are the agent-facing contract of the site.',
  };
}
