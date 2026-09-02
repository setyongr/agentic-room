import type { DesignSnapshot, PlacedFurniture, RoomAppearance, RoomData, RoomOpening } from '@/domain/types';
import { DEFAULT_ROOM_APPEARANCE } from '@/data/appearance';
import { DEFAULT_ROOM_DIMENSIONS } from '@/domain/types';
import { DEMO_BUDGET, getProduct } from '@/data/products';
import { PLACEMENT_ZONES } from '@/data/placementZones';

/**
 * Default living-room demo state: a 6 × 4.5 × 2.8 m room, centered
 * coordinate system (x ∈ [-3, 3], z ∈ [-2.25, 2.25]; north wall at
 * z = -2.25, south at z = +2.25, west at x = -3, east at x = +3), a $700
 * budget, and two ready-to-load states:
 *
 * - `DEFAULT_DEMO_SNAPSHOT`: the room as shipped — locked existing sofa and
 *   rug plus an unlocked existing entry console, and nothing else: the full
 *   700 budget is available for the hero agent to place marketplace products
 *   and finish the room.
 * - `BUDGET_RESCUE_SNAPSHOT`: a "Budget Rescue" starting point — the same
 *   locked sofa and rug, but the four premium marketplace products (Terra
 *   Coffee Table 340, Halo Floor Lamp 220, Aria Accent Chair 310, Alder
 *   Ladder Shelf 270; total 1140) against a 1000 budget. The layout is fully
 *   valid; it is deliberately over budget so the rescue flow can swap in the
 *   value replacements (175 + 89 + 240 + 180 = 684).
 *
 * Geometry conventions (shared with placementZones.ts):
 * - Rotation is yaw in degrees about +y; 0 = product front faces +z (south),
 *   +90 = +x (east), 180 = -z (north), 270 = -x (west). All seeded rotations
 *   are multiples of 90°, so an item's x extent is `width` at rotation
 *   0/180 and `depth` at 90/270 (and vice versa for z).
 * - Opening footprints are x/z-centered: for north/south walls the opening
 *   width runs along x (`width`) and the wall thickness is `depth`; for
 *   east/west walls the wall thickness is `width` and the opening width runs
 *   along z (`depth`).
 * - Every placed item's center sits inside a placement zone that allows its
 *   category, items stay inside the room bounds, and no item intersects an
 *   opening footprint. The rug is the only intentional item-item overlap: it
 *   lies flat (height 0.012 m) under the sofa and coffee table, as in real
 *   interiors.
 */

/** Entry door, west wall; clearances: z ∈ [-1.45, -0.55], wall cut x ∈ [-3.1, -2.9]. */
export const ENTRY_DOOR: RoomOpening = {
  id: 'entry-door',
  kind: 'door',
  wall: 'west',
  footprint: { x: -3, z: -1.0, width: 0.2, depth: 0.9 },
  height: 2.1,
  sillHeight: 0,
};

/** East wall window; clearances: z ∈ [-1.4, 0.2], wall cut x ∈ [2.9, 3.1]. */
export const EAST_WINDOW: RoomOpening = {
  id: 'east-window',
  kind: 'window',
  wall: 'east',
  footprint: { x: 3, z: -0.6, width: 0.2, depth: 1.6 },
  height: 1.4,
  sillHeight: 0.9,
};

/** Balcony glass door, south wall; clearances: x ∈ [0.8, 2.6], wall cut z ∈ [2.15, 2.35]. */
export const BALCONY_DOOR: RoomOpening = {
  id: 'balcony-door',
  kind: 'door',
  wall: 'south',
  footprint: { x: 1.7, z: 2.25, width: 1.8, depth: 0.2 },
  height: 2.4,
  sillHeight: 0,
};

/** All wall openings of the demo room, in stable order. */
export const ROOM_OPENINGS: readonly RoomOpening[] = [ENTRY_DOOR, EAST_WINDOW, BALCONY_DOOR];

/** Static geometry of the default demo room. */
export const DEFAULT_ROOM: RoomData = {
  dimensions: DEFAULT_ROOM_DIMENSIONS,
  openings: ROOM_OPENINGS,
  placementZones: PLACEMENT_ZONES,
};

/**
 * Items already present in the default room. The sofa and rug are locked
 * (part of the room); the entry console is existing but movable. Existing
 * items never count toward the budget regardless of catalog price.
 */
export const DEFAULT_ROOM_ITEMS: readonly PlacedFurniture[] = [
  {
    instanceId: 'existing-sofa',
    productId: 'fjord-3-seat-sofa',
    position: { x: 0, y: 0, z: 0.7 },
    // Faces north toward the media wall. Occupies x ∈ [-1.03, 1.03], z ∈ [0.25, 1.15].
    rotation: 180,
    locked: true,
    source: 'existing',
    variant: { color: 'linen', material: 'linen' },
  },
  {
    instanceId: 'existing-rug',
    productId: 'cloud-wool-rug',
    position: { x: 0, y: 0, z: 0.2 },
    // Matches the product's defaultRotation; 2.8 m along x, 2.0 m along z,
    // under the sofa and coffee table (flat, intentional overlap).
    rotation: 90,
    locked: true,
    source: 'existing',
    variant: { color: 'ivory', material: 'wool' },
  },
  {
    instanceId: 'existing-console',
    productId: 'soho-console',
    position: { x: -2.8, y: 0, z: 0.75 },
    // Long side along the west entry wall. Occupies x ∈ [-2.99, -2.61], z ∈ [0.2, 1.3].
    rotation: 90,
    locked: false,
    source: 'existing',
    variant: { color: 'walnut', material: 'walnut' },
  },
];

/**
 * Budget Rescue starting state: locked sofa and rug plus the four premium
 * marketplace products. Marketplace total 1140 against budget 1000 — the
 * layout is valid, the price is not, which is exactly the rescue scenario.
 */
export const BUDGET_RESCUE_ITEMS: readonly PlacedFurniture[] = [
  {
    instanceId: 'existing-sofa',
    productId: 'fjord-3-seat-sofa',
    position: { x: 0, y: 0, z: 0.7 },
    rotation: 180,
    locked: true,
    source: 'existing',
    variant: { color: 'linen', material: 'linen' },
  },
  {
    instanceId: 'existing-rug',
    productId: 'cloud-wool-rug',
    position: { x: 0, y: 0, z: 0.2 },
    rotation: 90,
    locked: true,
    source: 'existing',
    variant: { color: 'ivory', material: 'wool' },
  },
  {
    instanceId: 'rescue-coffee-table',
    productId: 'budget-rescue-table-premium',
    position: { x: 0, y: 0, z: -0.45 },
    // Terra Coffee Table; 0.4 m clear of the sofa front, on the rug.
    rotation: 0,
    locked: false,
    source: 'marketplace',
    variant: { color: 'walnut', material: 'walnut' },
  },
  {
    instanceId: 'rescue-floor-lamp',
    productId: 'budget-rescue-lamp-premium',
    position: { x: 1.75, y: 0, z: -1.5 },
    // Halo Floor Lamp beside the reading chair.
    rotation: 0,
    locked: false,
    source: 'marketplace',
    variant: { color: 'cream', material: 'brass' },
  },
  {
    instanceId: 'rescue-accent-chair',
    productId: 'budget-rescue-chair-premium',
    position: { x: 2.45, y: 0, z: -1.73 },
    // Aria Accent Chair anchoring the reading corner.
    rotation: 0,
    locked: false,
    source: 'marketplace',
    variant: { color: 'terracotta', material: 'velvet' },
  },
  {
    instanceId: 'rescue-shelf',
    productId: 'budget-rescue-shelf-premium',
    position: { x: 1.05, y: 0, z: -2.05 },
    // Alder Ladder Shelf on the media wall's east end.
    rotation: 0,
    locked: false,
    source: 'marketplace',
    variant: { color: 'oak', material: 'alder' },
  },
];

/** Deterministic creation/update timestamps for the seed snapshots (ISO 8601). */
export const DEFAULT_SNAPSHOT_CREATED_AT = '2026-09-01T00:00:00.000Z';
export const BUDGET_RESCUE_CREATED_AT = '2026-09-01T01:00:00.000Z';

/** Budget of the Budget Rescue scenario, USD. */
export const BUDGET_RESCUE_BUDGET = 1000;

/** Room styling of the Budget Rescue preset: warm sand walls, walnut floor, linen stripe wallpaper. */
export const BUDGET_RESCUE_APPEARANCE: RoomAppearance = {
  wallFinishId: 'warm-sand',
  floorFinishId: 'walnut',
  wallpaperId: 'linen-stripe',
};

/** Ready-to-load default demo state: furnished but incomplete, 700 budget, nothing spent.*/
export const DEFAULT_DEMO_SNAPSHOT: DesignSnapshot = {
  id: 'snapshot-default-demo',
  name: 'Default Living Room Demo',
  createdAt: DEFAULT_SNAPSHOT_CREATED_AT,
  updatedAt: DEFAULT_SNAPSHOT_CREATED_AT,
  room: DEFAULT_ROOM,
  items: DEFAULT_ROOM_ITEMS,
  budget: DEMO_BUDGET,
  appearance: DEFAULT_ROOM_APPEARANCE,
  thumbnailGradient: 'linear-gradient(135deg, #E6DFD2, #8FA3A0)',
};

/** Ready-to-load Budget Rescue starter: valid layout, 1140 spent against 1000. */
export const BUDGET_RESCUE_SNAPSHOT: DesignSnapshot = {
  id: 'snapshot-budget-rescue',
  name: 'Budget Rescue Starter',
  createdAt: BUDGET_RESCUE_CREATED_AT,
  updatedAt: BUDGET_RESCUE_CREATED_AT,
  room: DEFAULT_ROOM,
  items: BUDGET_RESCUE_ITEMS,
  budget: BUDGET_RESCUE_BUDGET,
  appearance: BUDGET_RESCUE_APPEARANCE,
  thumbnailGradient: 'linear-gradient(135deg, #F3E9DC, #C96F4A)',
};

/** Every catalog product id referenced by the seed states. */
export const SEEDED_PRODUCT_IDS: readonly string[] = [
  'fjord-3-seat-sofa',
  'cloud-wool-rug',
  'soho-console',
  'budget-rescue-table-premium',
  'budget-rescue-lamp-premium',
  'budget-rescue-chair-premium',
  'budget-rescue-shelf-premium',
];

// Load-time integrity: the seed states must never reference an id the
// catalog does not define. Fails fast instead of shipping broken rooms.
for (const id of SEEDED_PRODUCT_IDS) {
  if (!getProduct(id)) {
    throw new Error(`Seed room references a product missing from the catalog: ${id}`);
  }
}
