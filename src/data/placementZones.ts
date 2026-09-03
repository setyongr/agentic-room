import type { PlacementZone, PlacementZoneKind, RectFootprint } from '@/domain/types';

/**
 * Logical placement zones for the default 6 × 4.5 m living room.
 *
 * Room coordinates are centered on the room: x ∈ [-3, 3], z ∈ [-2.25, 2.25]
 * (north wall at z = -2.25, south wall at z = +2.25, west wall at x = -3,
 * east wall at x = +3). Every footprint is an x/z-centered rectangle:
 * `footprint.x`/`footprint.z` is the center, `width` runs along x and
 * `depth` along z.
 *
 * Zone membership is decided by an item's center point (position.x/z),
 * and a center inside several zones is checked against each of them.
 * These zones are disjoint except for three intentional overlaps with the
 * `living-area` anchor zone: `center-table` sits fully inside it, and the
 * two sofa-side zones overlap its flanks. Because `living-area` allows
 * every category the specific zones allow, no placement can be attributed
 * to a zone that rejects it. The rug needs no zone coverage (soft
 * categories are zone-exempt), but the locked sofa's center (0, 0.7) is
 * covered by `living-area`.
 *
 * Rotation convention (shared with demoRoom.ts): rotation is yaw in degrees
 * about +y; 0 = the product's front faces +z (south), +90 = +x (east),
 * 180 = -z (north), 270 = -x (west). All seeded rotations are multiples of
 * 90°, so width/depth either apply as-is (0/180) or swap (90/270).
 */

/** A placement zone with a suggestion priority and a one-line placement hint. */
export interface RankedPlacementZone extends PlacementZone {
  /** placement priority: 1 = suggest items here first when seeding/auto-placing */
  rank: number;
  /** one-line guidance for placing items in this zone */
  hint: string;
}

/**
 * The ten logical zones of the demo room:
 * media wall (north), reading corner (northeast), center table, sofa sides,
 * window side (east), back wall (southwest), entry wall (west), the
 * balcony-adjacent safe area (southeast, beside the balcony door), and the
 * living-area anchor (sofa, rug, coffee table; also the only zone that
 * accepts beds — a sleeping corner can be laid out over the open floor).
 */
export const PLACEMENT_ZONES: readonly RankedPlacementZone[] = [
  {
    id: 'reading-corner',
    kind: 'seating',
    name: 'Reading Corner',
    footprint: { x: 2.25, z: -1.725, width: 1.4, depth: 0.85 },
    allowedCategories: [
      'armchair',
      'accent_chair',
      'side_table',
      'floor_lamp',
      'table_lamp',
      'plant',
      'decor',
    ],
    maxItems: 4,
    rank: 1,
    hint: 'Anchor an armchair in the northeast corner facing the room; add a lamp and side table, window light on the east.',
  },
  {
    id: 'living-area',
    kind: 'seating',
    name: 'Living Area',
    footprint: { x: 0, z: 0.2, width: 3.0, depth: 2.2 },
    allowedCategories: [
      'sofa',
      'rug',
      'coffee_table',
      'side_table',
      'armchair',
      'accent_chair',
      'storage',
      'floor_lamp',
      'table_lamp',
      'plant',
      'decor',
      'bed',
    ],
    rank: 2,
    hint: 'Anchor zone for the sofa, rug, and coffee table (beds drop here too); the seed room ships with the first three already placed.',
  },
  {
    id: 'media-wall',
    kind: 'media',
    name: 'Media Wall',
    footprint: { x: -0.1, z: -2.0, width: 3.2, depth: 0.5 },
    allowedCategories: ['cabinet', 'shelf', 'storage', 'decor', 'plant', 'tv', 'soundbar', 'speaker'],
    maxItems: 4,
    rank: 3,
    hint: 'Center the TV and console on the north wall; flank them with speakers, shelves, decor, or plants.',
  },
  {
    id: 'center-table',
    kind: 'general',
    name: 'Center Table',
    footprint: { x: 0, z: -0.425, width: 1.8, depth: 1.05 },
    allowedCategories: ['coffee_table', 'side_table', 'decor'],
    maxItems: 1,
    rank: 4,
    hint: 'One coffee table centered on the rug; keep at least 0.4 m clear of the sofa front.',
  },
  {
    id: 'sofa-side-west',
    kind: 'general',
    name: 'Sofa Side (West)',
    footprint: { x: -1.475, z: 0.65, width: 0.65, depth: 0.7 },
    allowedCategories: ['side_table', 'floor_lamp', 'table_lamp', 'plant', 'decor'],
    maxItems: 2,
    rank: 5,
    hint: 'Small side table, lamp, or plant beside the sofa\u2019s west arm.',
  },
  {
    id: 'sofa-side-east',
    kind: 'general',
    name: 'Sofa Side (East)',
    footprint: { x: 1.475, z: 0.65, width: 0.65, depth: 0.7 },
    allowedCategories: ['side_table', 'floor_lamp', 'table_lamp', 'plant', 'decor'],
    maxItems: 2,
    rank: 6,
    hint: 'Small side table, lamp, or plant beside the sofa\u2019s east arm.',
  },
  {
    id: 'window-side',
    kind: 'window',
    name: 'Window Side',
    footprint: { x: 2.65, z: -0.2, width: 0.5, depth: 1.4 },
    allowedCategories: ['side_table', 'table_lamp', 'plant', 'storage', 'decor'],
    maxItems: 3,
    rank: 7,
    hint: 'Low pieces only \u2014 side table, plant, or lamp that won\u2019t block the east window.',
  },
  {
    id: 'back-wall',
    kind: 'storage',
    name: 'Back Wall',
    footprint: { x: -0.825, z: 1.975, width: 2.75, depth: 0.55 },
    allowedCategories: ['console', 'cabinet', 'storage', 'shelf', 'plant', 'decor'],
    maxItems: 3,
    rank: 8,
    hint: 'Console, storage, or shelf along the south wall west of the balcony door.',
  },
  {
    id: 'entry-wall',
    kind: 'entry',
    name: 'Entry Wall',
    footprint: { x: -2.8, z: 0.65, width: 0.4, depth: 1.5 },
    allowedCategories: ['console', 'cabinet', 'shelf', 'storage', 'plant', 'decor'],
    maxItems: 2,
    rank: 9,
    hint: 'Console or shelf by the entrance; keep the door swing clear.',
  },
  {
    id: 'balcony-adjacent',
    kind: 'general',
    name: 'Balcony-Adjacent Safe Area',
    footprint: { x: 2.8, z: 1.3, width: 0.4, depth: 1.4 },
    allowedCategories: ['plant', 'storage', 'decor'],
    maxItems: 2,
    rank: 10,
    hint: 'Small plants or baskets beside the balcony door, out of the door path.',
  },
];

/** Lookup a zone by id; throws when the id is unknown. */
export function getPlacementZone(id: string): RankedPlacementZone {
  const zone = PLACEMENT_ZONES.find((z) => z.id === id);
  if (!zone) {
    throw new Error(`Unknown placement zone id: ${id}`);
  }
  return zone;
}

/** Convenience: all zone footprints, in rank order. */
export const PLACEMENT_ZONE_FOOTPRINTS: readonly RectFootprint[] = PLACEMENT_ZONES.map(
  (zone) => zone.footprint,
);

/** All zone kinds used by the demo room, in rank order. */
export const PLACEMENT_ZONE_KIND_USAGE: readonly PlacementZoneKind[] = PLACEMENT_ZONES.map(
  (zone) => zone.kind,
);
