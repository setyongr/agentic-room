import { describe, expect, it } from 'vitest';
import { BALCONY_DOOR, DEFAULT_ROOM, EAST_WINDOW, ENTRY_DOOR } from '@/data/demoRoom';
import type { PlacedFurniture } from '@/domain/types';
import { checkLayout } from '@/domain/validation';

/**
 * Fresh, isolated fixture per call: one deliberate geometry violation each,
 * positioned so every fixture yields exactly the issue under test.
 *
 * Room: 6 × 4.5 m centered, so x ∈ [-3, 3], z ∈ [-2.25, 2.25]. Openings:
 * entry door (west wall, x ∈ [-3.1, -2.9], z ∈ [-1.45, -0.55]), east window
 * (east wall, x ∈ [2.9, 3.1], z ∈ [-1.4, 0.2]), balcony door (south wall,
 * x ∈ [0.8, 2.6], z ∈ [2.15, 2.35]). All rotations are multiples of 90°,
 * so the rotated footprint extents are exact swaps of width/depth.
 */
function placed(
  instanceId: string,
  productId: string,
  x: number,
  z: number,
  rotation = 0,
): PlacedFurniture {
  return {
    instanceId,
    productId,
    position: { x, y: 0, z },
    rotation,
    locked: false,
    source: 'marketplace',
  };
}

describe('checkLayout room boundary', () => {
  it('reports an item whose footprint crosses a room wall', () => {
    // Alder Ladder Shelf (0.9 × 0.35) centered on the media-wall zone's
    // north edge: the footprint reaches z = -2.425 while the north wall
    // sits at z = -2.25. The center stays inside media-wall, whose allowed
    // categories include shelf, so this is the only issue.
    const shelf = placed('shelf-out', 'budget-rescue-shelf-premium', 0, -2.25);
    const result = checkLayout(DEFAULT_ROOM, [shelf]);

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      kind: 'out_of_bounds',
      severity: 'error',
      instanceIds: ['shelf-out'],
    });
  });
});

describe('checkLayout furniture overlap', () => {
  it('reports a furniture overlap above the contact tolerance', () => {
    // Vello 3-Seat Sofa (2.2 × 0.95) at z = 0.2 and Terra Coffee Table
    // (1.1 × 0.6) at z = 0.6 overlap by 1.1 × 0.375 = 0.4125 m², well above
    // the 0.02 m² contact tolerance. Both centers lie inside living-area,
    // whose allowed categories cover both, so this is the only issue.
    const sofa = placed('sofa-a', 'vello-3-seat-sofa', 0, 0.2);
    const table = placed('table-b', 'budget-rescue-table-premium', 0, 0.6);
    const result = checkLayout(DEFAULT_ROOM, [sofa, table]);

    // Overlap is a warning: the design remains valid.
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      kind: 'overlap',
      severity: 'warning',
      instanceIds: ['sofa-a', 'table-b'],
    });
  });
});

describe('checkLayout opening clearance', () => {
  it('reports an item blocking the east window clearance', () => {
    // Pixel Cube Side Table (0.4 × 0.4) at the window-side zone's east end:
    // the footprint x ∈ [2.55, 2.95] cuts 0.05 m into the east window's
    // clearance (x ∈ [2.9, 3.1]) without crossing the east wall at x = 3.
    const table = placed('table-window', 'pixel-cube-side-table', 2.75, -0.2);
    const result = checkLayout(DEFAULT_ROOM, [table]);

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      kind: 'blocks_opening',
      severity: 'error',
      instanceIds: ['table-window'],
      refId: EAST_WINDOW.id,
    });
  });

  it('reports an item blocking the balcony door clearance', () => {
    // Ottoman Storage (0.6 × 0.6) at the balcony-adjacent zone's south edge:
    // the footprint z ∈ [1.6, 2.2] overlaps the balcony door's required
    // clearance (z ∈ [2.15, 2.35]) by 0.05 m while staying inside the room
    // (z ≤ 2.25) and inside a zone that allows storage.
    const ottoman = placed('ottoman-balcony', 'ottoman-storage', 2.6, 1.9);
    const result = checkLayout(DEFAULT_ROOM, [ottoman]);

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      kind: 'blocks_opening',
      severity: 'error',
      instanceIds: ['ottoman-balcony'],
      refId: BALCONY_DOOR.id,
    });
  });

  it('reports an item blocking the entry door clearance', () => {
    // Soho Console rotated 90° (x extent 0.38, z extent 1.1) in the
    // entry-wall zone: the footprint x ∈ [-2.99, -2.61], z ∈ [-0.6, 0.5]
    // overlaps the entry door's clearance (x ∈ [-3.1, -2.9],
    // z ∈ [-1.45, -0.55]) by 0.09 × 0.05 m² without crossing the west wall
    // at x = -3 or leaving the entry-wall zone.
    const console = placed('console-entry', 'soho-console', -2.8, -0.05, 90);
    const result = checkLayout(DEFAULT_ROOM, [console]);

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      kind: 'blocks_opening',
      severity: 'error',
      instanceIds: ['console-entry'],
      refId: ENTRY_DOOR.id,
    });
  });
});
