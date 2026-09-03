/**
 * Room resizing — pure domain contract tests.
 *
 * Covers `resizeRoom`: dimension validation against the supported ranges,
 * deterministic proportional rescaling of openings (same wall, clamped onto
 * the wall, heights capped below the ceiling) and placement zones (scaled
 * with the room, unusably small zones dropped), no-op identical resizes,
 * and immutability of the caller's room.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM } from '@/data/demoRoom';
import {
  ROOM_SIZE_LIMITS,
  addOpening,
  emptyRoom,
  moveOpening,
  openingAlongWallCenter,
  openingAlongWallLimits,
  removeOpening,
  resizeRoom,
  setOpeningDimensions,
} from './resize';
import type { RoomData, RoomOpening, RoomDimensions } from './types';

function expectOk<T>(result: { ok: boolean; data?: T }): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected a structured success');
  return (result as { ok: true; data: T }).data;
}

function expectRejected(result: { ok: boolean; code?: string; details?: unknown }): {
  code: string;
  details: Record<string, unknown>;
} {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a structured failure');
  return {
    code: result.code ?? 'missing-code',
    details: (result.details ?? {}) as Record<string, unknown>,
  };
}

function openingById(room: RoomData, id: string): RoomOpening {
  const opening = room.openings.find((o) => o.id === id);
  expect(opening).toBeDefined();
  if (opening === undefined) throw new Error(`missing opening ${id}`);
  return opening;
}

const FLOOR_EPSILON = 1e-9;

/** Every opening's along-wall extent stays inside its wall after a resize. */
function expectOpeningsInside(room: RoomData, ...openings: RoomOpening[]): void {
  const halfW = room.dimensions.width / 2;
  const halfD = room.dimensions.depth / 2;
  for (const opening of openings) {
    const onXAxisWall = opening.wall === 'north' || opening.wall === 'south';
    const along = onXAxisWall ? opening.footprint.x : opening.footprint.z;
    const alongSize = onXAxisWall ? opening.footprint.width : opening.footprint.depth;
    expect(Math.abs(along) + alongSize / 2).toBeLessThanOrEqual(
      (onXAxisWall ? halfW : halfD) + FLOOR_EPSILON,
    );
  }
}

describe('resizeRoom', () => {
  it('grows the room and scales openings proportionally onto their walls', () => {
    const result = expectOk(
      resizeRoom(DEFAULT_ROOM, { width: 8, depth: 6, height: 3.2 }),
    );
    expect(result.changed).toBe(true);
    expect(result.room.dimensions).toEqual({ width: 8, depth: 6, height: 3.2 });
    expect(result.removedOpeningIds).toEqual([]);
    expect(result.room.openings).toHaveLength(3);

    // South-wall balcony door scales along x (8/6); its z stays in the wall plane.
    const balcony = openingById(result.room, 'balcony-door');
    expect(balcony.wall).toBe('south');
    expect(balcony.footprint.x).toBeCloseTo(1.7 * (8 / 6), 12);
    expect(balcony.footprint.z).toBeCloseTo(3, 12);
    expect(balcony.footprint.width).toBe(1.8); // real opening width is unchanged

    // West entry door and east window scale along z (6/4.5); x sits in the wall plane.
    const entry = openingById(result.room, 'entry-door');
    expect(entry.wall).toBe('west');
    expect(entry.footprint.z).toBeCloseTo(-1 * (6 / 4.5), 12);
    expect(entry.footprint.x).toBeCloseTo(-4, 12);

    const window = openingById(result.room, 'east-window');
    expect(window.wall).toBe('east');
    expect(window.footprint.z).toBeCloseTo(-0.6 * (6 / 4.5), 12);
    expect(window.footprint.x).toBeCloseTo(4, 12);
  });

  it('keeps every opening inside the walls when shrinking (clamped, never dangling)', () => {
    const result = expectOk(
      resizeRoom(DEFAULT_ROOM, { width: 4, depth: 3.2, height: 2.8 }),
    );
    expect(result.removedOpeningIds).toEqual([]);
    expectOpeningsInside(result.room, ...result.room.openings);
    // Clamping: the balcony door (1.8 m wide on a 4 m south wall) stays on-wall.
    const balcony = openingById(result.room, 'balcony-door');
    expect(Math.abs(balcony.footprint.x) + balcony.footprint.width / 2).toBeLessThanOrEqual(
      2 + 1e-9,
    );
    const window = openingById(result.room, 'east-window');
    expect(window.footprint.z).toBeCloseTo(-0.6 * (3.2 / 4.5), 12);
  });

  it('removes an opening whose wall became too short to host it', () => {
    // East window: 1.6 m along z + slack > the new 2.0 m depth span.
    const result = expectOk(
      resizeRoom(DEFAULT_ROOM, { width: 5, depth: 2.0, height: 2.8 }),
    );
    expect(result.removedOpeningIds).toEqual(['east-window']);
    expect(result.room.openings.map((o) => o.id)).toEqual(['entry-door', 'balcony-door']);
    // Survivors are still cut into their walls.
    expectOpeningsInside(result.room, ...result.room.openings);
  });

  it('caps opening heights below the ceiling and never re-grows them', () => {
    const low = expectOk(
      resizeRoom(DEFAULT_ROOM, { width: 6, depth: 4.5, height: 2.4 }),
    );
    // Balcony door 2.4 -> 2.25; east window top 2.3 -> 2.25 (height 1.35); entry door unchanged.
    expect(openingById(low.room, 'balcony-door').height).toBeCloseTo(2.25, 12);
    expect(openingById(low.room, 'east-window').height).toBeCloseTo(1.35, 12);
    expect(openingById(low.room, 'entry-door').height).toBe(2.1);
    for (const opening of low.room.openings) {
      expect(opening.sillHeight + opening.height).toBeLessThanOrEqual(2.25 + 1e-9);
    }
    // Growing the ceiling later does not stretch openings back.
    const regrown = expectOk(
      resizeRoom(low.room, { width: 6, depth: 4.5, height: 2.8 }),
    );
    expect(openingById(regrown.room, 'balcony-door').height).toBeCloseTo(2.25, 12);
  });

  it('scales placement zones with the room and drops unusably small ones', () => {
    const result = expectOk(
      resizeRoom(DEFAULT_ROOM, { width: 8, depth: 4.5, height: 2.8 }),
    );
    const living = result.room.placementZones.find((z) => z.id === 'living-area');
    expect(living).toBeDefined();
    expect(living?.footprint.x).toBeCloseTo(0, 12);
    expect(living?.footprint.width).toBeCloseTo(3.0 * (8 / 6), 12);
    const media = result.room.placementZones.find((z) => z.id === 'media-wall');
    expect(media?.footprint.x).toBeCloseTo(-0.1 * (8 / 6), 12);
    // Rules and guidance survive the rescale.
    expect(living?.allowedCategories).toContain('sofa');
    expect(living?.hint).toContain('sofa');
    const corner = result.room.placementZones.find((z) => z.id === 'reading-corner');
    expect(corner?.rank).toBe(1);
  });

  it('drops zones that shrink below usable size at the minimum footprint', () => {
    const result = expectOk(
      resizeRoom(DEFAULT_ROOM, { width: 2.0, depth: 2.0, height: 2.4 }),
    );
    const kept = result.room.placementZones.map((z) => z.id);
    expect(kept).toEqual(['reading-corner', 'living-area', 'center-table']);
    // Every surviving zone is fully inside the room and big enough to hold a piece.
    for (const zone of result.room.placementZones) {
      expect(zone.footprint.width).toBeGreaterThanOrEqual(0.35);
      expect(zone.footprint.depth).toBeGreaterThanOrEqual(0.35);
      expect(Math.abs(zone.footprint.x) + zone.footprint.width / 2).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(zone.footprint.z) + zone.footprint.depth / 2).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('returns the caller room unchanged for identical dimensions (no-op)', () => {
    const result = expectOk(
      resizeRoom(DEFAULT_ROOM, {
        width: DEFAULT_ROOM.dimensions.width,
        depth: DEFAULT_ROOM.dimensions.depth,
        height: DEFAULT_ROOM.dimensions.height,
      }),
    );
    expect(result.changed).toBe(false);
    expect(result.room).toBe(DEFAULT_ROOM);
    expect(result.removedOpeningIds).toEqual([]);
  });

  it('rejects out-of-range, non-finite, and non-positive dimensions deterministically', () => {
    const bad: RoomDimensions[] = [
      { width: 1.5, depth: 4.5, height: 2.8 }, // too narrow
      { width: 6, depth: 11, height: 2.8 }, // too deep
      { width: 6, depth: 4.5, height: 2.2 }, // ceiling too low
      { width: 6, depth: 4.5, height: 4.2 }, // ceiling too tall
      { width: Number.NaN, depth: 4.5, height: 2.8 },
      { width: 6, depth: Infinity, height: 2.8 },
      { width: 6, depth: 4.5, height: -2.8 },
    ];
    for (const dimensions of bad) {
      const failure = expectRejected(resizeRoom(DEFAULT_ROOM, dimensions));
      expect(failure.code).toBe('invalid_room_size');
      expect(failure.details['limits']).toEqual(ROOM_SIZE_LIMITS);
    }
  });

  it('never mutates the caller room, openings, or zones', () => {
    const snapshot = JSON.parse(JSON.stringify(DEFAULT_ROOM)) as RoomData;
    resizeRoom(DEFAULT_ROOM, { width: 3.2, depth: 3, height: 2.6 });
    expect(DEFAULT_ROOM).toEqual(snapshot);
  });

  it('resizes an already-resized room from its live dimensions', () => {
    const first = expectOk(
      resizeRoom(DEFAULT_ROOM, { width: 8, depth: 6, height: 3.2 }),
    );
    const second = expectOk(
      resizeRoom(first.room, { width: 5, depth: 3, height: 2.6 }),
    );
    expect(second.changed).toBe(true);
    // Relative geometry follows the *current* room, not the demo default.
    const balcony = openingById(second.room, 'balcony-door');
    expect(balcony.footprint.x).toBeCloseTo(1.7 * (8 / 6) * (5 / 8), 12);
    expect(second.room.dimensions).toEqual({ width: 5, depth: 3, height: 2.6 });
    // Zones fit inside the twice-resized shell.
    for (const zone of second.room.placementZones) {
      expect(Math.abs(zone.footprint.x) + zone.footprint.width / 2).toBeLessThanOrEqual(2.5 + 1e-9);
      expect(Math.abs(zone.footprint.z) + zone.footprint.depth / 2).toBeLessThanOrEqual(1.5 + 1e-9);
    }
  });

  it('keeps opening order stable when some are removed', () => {
    // Resize depth twice so both the east window (1.6 m + slack) and then no
    // further removals occur: order of survivors matches the source order.
    const once = expectOk(
      resizeRoom(DEFAULT_ROOM, { width: 6, depth: 2.0, height: 2.8 }),
    );
    const twice = expectOk(resizeRoom(once.room, { width: 6, depth: 4.5, height: 2.8 }));
    expect(twice.room.openings.map((o) => o.id)).toEqual(['entry-door', 'balcony-door']);
  });

  it('round-trips a realistic measured room end to end', () => {
    const result = expectOk(
      resizeRoom(DEFAULT_ROOM, { width: 5.4, depth: 3.6, height: 2.7 }),
    );
    expect(result.room.dimensions).toEqual({ width: 5.4, depth: 3.6, height: 2.7 });
    expect(result.changed).toBe(true);
    expect(result.removedOpeningIds).toEqual([]);
    expect(result.room.openings).toHaveLength(3);
    expect(result.room.placementZones.length).toBeGreaterThanOrEqual(5);
    expectOpeningsInside(result.room, ...result.room.openings);
  });
});


describe('moveOpening', () => {
  it('slides a west-wall door along its wall', () => {
    const result = expectOk(moveOpening(DEFAULT_ROOM, 'entry-door', 1.2));
    expect(result.changed).toBe(true);
    const moved = result.room.openings.find((o) => o.id === 'entry-door');
    expect(moved?.footprint.z).toBeCloseTo(1.2, 12);
    expect(moved?.footprint.x).toBeCloseTo(-3, 12); // stays in the west wall plane
    expect(moved?.footprint.width).toBe(0.2); // real size unchanged
    expect(moved?.height).toBe(2.1);
    expect(result.room.openings).toHaveLength(3);
    // Other openings are untouched.
    expect(openingById(result.room, 'east-window').footprint.z).toBeCloseTo(-0.6, 12);
    expect(openingById(result.room, 'balcony-door').footprint.x).toBeCloseTo(1.7, 12);
  });

  it('clamps requests past a wall end onto the movable range', () => {
    // West wall depth 4.5; door 0.9 wide -> limit 2.25 - 0.45 - 0.05 = 1.75.
    const far = expectOk(moveOpening(DEFAULT_ROOM, 'entry-door', 5));
    expect(openingAlongWallCenter(openingById(far.room, 'entry-door'))).toBeCloseTo(1.75, 12);
    const near = expectOk(moveOpening(DEFAULT_ROOM, 'entry-door', -5));
    expect(openingAlongWallCenter(openingById(near.room, 'entry-door'))).toBeCloseTo(-1.75, 12);
  });

  it('moves north/south wall openings along the x axis', () => {
    const result = expectOk(moveOpening(DEFAULT_ROOM, 'balcony-door', -2));
    const moved = openingById(result.room, 'balcony-door');
    expect(moved.footprint.x).toBeCloseTo(-2, 12);
    expect(moved.footprint.z).toBeCloseTo(2.25, 12); // south wall plane
  });

  it('is a no-op success for the current position', () => {
    const result = expectOk(moveOpening(DEFAULT_ROOM, 'east-window', -0.6));
    expect(result.changed).toBe(false);
    expect(result.room).toBe(DEFAULT_ROOM);
  });

  it('fails with opening_not_found for unknown ids', () => {
    const failure = expectRejected(moveOpening(DEFAULT_ROOM, 'ghost-window', 0));
    expect(failure.code).toBe('opening_not_found');
  });

  it('fails with invalid_opening_position for non-finite centers and unusable walls', () => {
    const nan = expectRejected(moveOpening(DEFAULT_ROOM, 'east-window', Number.NaN));
    expect(nan.code).toBe('invalid_opening_position');
    // A snapshot-sized room whose 2.0 m depth cannot host the 1.6 m window.
    const window = openingById(DEFAULT_ROOM, 'east-window');
    const cramped = {
      ...DEFAULT_ROOM,
      dimensions: { width: 6, depth: 2.0, height: 2.8 },
      openings: [window],
    };
    const impossible = expectRejected(moveOpening(cramped, 'east-window', 0));
    expect(impossible.code).toBe('invalid_opening_position');
  });

  it('refuses a move that would collide with another opening on the same wall', () => {
    const entry = openingById(DEFAULT_ROOM, 'entry-door');
    const second = {
      ...entry,
      id: 'entry-door-second',
      footprint: { ...entry.footprint, z: 1.2 },
    };
    const twoDoors = { ...DEFAULT_ROOM, openings: [entry, second] };
    // Requested center -1 sits within 0.05 m margins of the first door at z -1.
    const failure = expectRejected(moveOpening(twoDoors, 'entry-door-second', -1.0));
    expect(failure.code).toBe('opening_overlap');
    // A clear spot keeps the wall usable.
    const clear = expectOk(moveOpening(twoDoors, 'entry-door-second', 0.8));
    expect(openingAlongWallCenter(openingById(clear.room, 'entry-door-second'))).toBeCloseTo(0.8, 12);
  });

  it('exposes the movable range and reports null for too-short walls', () => {
    const window = openingById(DEFAULT_ROOM, 'east-window');
    const limits = openingAlongWallLimits(window, DEFAULT_ROOM.dimensions);
    expect(limits).toEqual({ min: -1.4, max: 1.4 }); // 2.25 - 0.8 - 0.05
    const short = expectOk(resizeRoom(DEFAULT_ROOM, { width: 6, depth: 2.0, height: 2.8 }));
    expect(openingAlongWallLimits(window, short.room.dimensions)).toBeNull();
  });

  it('never mutates the caller room', () => {
    const snapshot = JSON.parse(JSON.stringify(DEFAULT_ROOM)) as RoomData;
    moveOpening(DEFAULT_ROOM, 'entry-door', 1.2);
    expect(DEFAULT_ROOM).toEqual(snapshot);
  });
});


describe('addOpening', () => {
  it('adds a standard door to an empty wall with preset geometry', () => {
    const result = expectOk(
      addOpening(DEFAULT_ROOM, { kind: 'door', wall: 'north', center: 0 }, 'opening-1'),
    );
    expect(result.changed).toBe(true);
    expect(result.room.openings).toHaveLength(4);
    expect(result.room.openings[3].id).toBe('opening-1');
    const added = openingById(result.room, 'opening-1');
    expect(added.kind).toBe('door');
    expect(added.wall).toBe('north');
    expect(added.footprint).toEqual({ x: 0, z: -2.25, width: 0.9, depth: 0.2 });
    expect(added.height).toBe(2.1);
    expect(added.sillHeight).toBe(0);
    // Existing openings are untouched and keep their order.
    expect(result.room.openings.slice(0, 3).map((o) => o.id)).toEqual([
      'entry-door',
      'east-window',
      'balcony-door',
    ]);
  });

  it('defaults to the leftmost free span on a wall that already has an opening', () => {
    // East wall: window at z -0.6 (half 0.8). A second window's center must
    // stay >= -0.6 + 0.8 + 0.05 + 0.8 + 0.05 = 1.1 (or <= -2.3, outside range).
    const result = expectOk(
      addOpening(DEFAULT_ROOM, { kind: 'window', wall: 'east' }, 'opening-1'),
    );
    const added = openingById(result.room, 'opening-1');
    expect(added.footprint.z).toBeCloseTo(1.1, 12);

    // West wall: door at z -1. A new door must land at z 0 or farther left.
    const door = expectOk(
      addOpening(DEFAULT_ROOM, { kind: 'door', wall: 'west' }, 'opening-1'),
    );
    expect(openingById(door.room, 'opening-1').footprint.z).toBeCloseTo(0, 12);
  });

  it('clamps an explicit center onto the movable range of the wall', () => {
    const result = expectOk(
      addOpening(DEFAULT_ROOM, { kind: 'door', wall: 'north', center: 5 }, 'opening-1'),
    );
    expect(openingById(result.room, 'opening-1').footprint.x).toBeCloseTo(2.5, 12); // 3 - 0.45 - 0.05
  });

  it('rejects a placement colliding with another opening on the same wall', () => {
    const failure = expectRejected(
      addOpening(DEFAULT_ROOM, { kind: 'door', wall: 'west', center: -1 }, 'opening-1'),
    );
    expect(failure.code).toBe('opening_overlap');
    expect(failure.details['otherOpeningId']).toBe('entry-door');
  });

  it('rejects duplicate opening ids and unusable walls', () => {
    const dup = expectRejected(
      addOpening(DEFAULT_ROOM, { kind: 'door', wall: 'north', center: 0 }, 'entry-door'),
    );
    expect(dup.code).toBe('duplicate_opening_id');

    // A 2.0 m deep wall cannot host the 1.6 m window preset.
    const cramped = { ...DEFAULT_ROOM, dimensions: { width: 6, depth: 2.0, height: 2.8 } };
    const short = expectRejected(
      addOpening(cramped, { kind: 'window', wall: 'east', center: 0 }, 'opening-1'),
    );
    expect(short.code).toBe('invalid_opening_position');
  });

  it('caps the added opening below the ceiling on low rooms', () => {
    const low = { ...DEFAULT_ROOM, dimensions: { width: 6, depth: 4.5, height: 2.4 } };
    const window = expectOk(
      addOpening(low, { kind: 'window', wall: 'north', center: 0 }, 'opening-1'),
    );
    const added = openingById(window.room, 'opening-1');
    // Top kept at 2.25 (2.4 - 0.15): 0.9 sill + 1.35 height.
    expect(added.sillHeight + added.height).toBeCloseTo(2.25, 12);
    expect(added.height).toBeCloseTo(1.35, 12);
  });

  it('never mutates the caller room', () => {
    const snapshot = JSON.parse(JSON.stringify(DEFAULT_ROOM)) as RoomData;
    addOpening(DEFAULT_ROOM, { kind: 'door', wall: 'north', center: 0 }, 'opening-1');
    expect(DEFAULT_ROOM).toEqual(snapshot);
  });
});

describe('removeOpening', () => {
  it('removes a seeded opening and keeps the rest stable', () => {
    const result = expectOk(removeOpening(DEFAULT_ROOM, 'balcony-door'));
    expect(result.changed).toBe(true);
    expect(result.room.openings.map((o) => o.id)).toEqual(['entry-door', 'east-window']);
    expect(result.opening.id).toBe('balcony-door');
    expect(result.room.dimensions).toBe(DEFAULT_ROOM.dimensions);
    expect(result.room.placementZones).toBe(DEFAULT_ROOM.placementZones);
  });

  it('fails with opening_not_found for unknown ids', () => {
    const failure = expectRejected(removeOpening(DEFAULT_ROOM, 'ghost-door'));
    expect(failure.code).toBe('opening_not_found');
  });

  it('never mutates the caller room', () => {
    const snapshot = JSON.parse(JSON.stringify(DEFAULT_ROOM)) as RoomData;
    removeOpening(DEFAULT_ROOM, 'entry-door');
    expect(DEFAULT_ROOM).toEqual(snapshot);
  });
});

describe('moveOpening across walls', () => {
  it('relocates a west-wall door onto the north wall, re-orienting its footprint', () => {
    const result = expectOk(moveOpening(DEFAULT_ROOM, 'entry-door', 0.4, 'north'));
    const moved = openingById(result.room, 'entry-door');
    expect(moved.wall).toBe('north');
    expect(moved.footprint).toEqual({ x: 0.4, z: -2.25, width: 0.9, depth: 0.2 });
    expect(moved.height).toBe(2.1);
    expect(moved.sillHeight).toBe(0);
    expect(result.room.openings).toHaveLength(3);
  });

  it('rejects a relocation onto a wall position occupied by another opening', () => {
    const failure = expectRejected(
      moveOpening(DEFAULT_ROOM, 'entry-door', -0.6, 'east'),
    );
    expect(failure.code).toBe('opening_overlap');
    expect(failure.details['otherOpeningId']).toBe('east-window');
  });

  it('clamps the relocated center onto the target wall', () => {
    // Balcony door (1.8 m wide) onto the west wall: limit 2.25 - 0.9 - 0.05.
    const result = expectOk(moveOpening(DEFAULT_ROOM, 'balcony-door', 5, 'west'));
    const moved = openingById(result.room, 'balcony-door');
    expect(moved.wall).toBe('west');
    expect(moved.footprint.x).toBeCloseTo(-3, 12);
    expect(moved.footprint.z).toBeCloseTo(1.3, 12);
    expect(moved.footprint).toEqual({ x: -3, z: 1.3, width: 0.2, depth: 1.8 });
  });

  it('is a no-op when wall and center are unchanged', () => {
    const result = expectOk(moveOpening(DEFAULT_ROOM, 'entry-door', -1, 'west'));
    expect(result.changed).toBe(false);
    expect(result.room).toBe(DEFAULT_ROOM);
  });

  it('never mutates the caller room', () => {
    const snapshot = JSON.parse(JSON.stringify(DEFAULT_ROOM)) as RoomData;
    moveOpening(DEFAULT_ROOM, 'entry-door', 0.4, 'north');
    expect(DEFAULT_ROOM).toEqual(snapshot);
  });
});


describe('setOpeningDimensions', () => {
  it('resizes a window: width, height, and sill (vertical position)', () => {
    const result = expectOk(
      setOpeningDimensions(DEFAULT_ROOM, 'east-window', {
        alongSize: 2.0,
        height: 1.6,
        sillHeight: 0.8,
      }),
    );
    expect(result.changed).toBe(true);
    const window = openingById(result.room, 'east-window');
    expect(window.footprint.depth).toBe(2.0); // along-wall size on the east wall
    expect(window.footprint.z).toBeCloseTo(-0.6, 12); // center unchanged
    expect(window.footprint.x).toBeCloseTo(3, 12);
    expect(window.height).toBe(1.6);
    expect(window.sillHeight).toBe(0.8);
    // Other openings untouched.
    expect(openingById(result.room, 'entry-door').height).toBe(2.1);
    expect(openingById(result.room, 'balcony-door').footprint.width).toBe(1.8);
  });

  it('resizes a door in width and height with the sill fixed at 0', () => {
    const result = expectOk(
      setOpeningDimensions(DEFAULT_ROOM, 'entry-door', { alongSize: 1.1, height: 2.3 }),
    );
    const door = openingById(result.room, 'entry-door');
    expect(door.footprint.depth).toBe(1.1);
    expect(door.height).toBe(2.3);
    expect(door.sillHeight).toBe(0);
  });

  it('rejects a non-zero door sill with invalid_opening_size', () => {
    const failure = expectRejected(
      setOpeningDimensions(DEFAULT_ROOM, 'entry-door', { sillHeight: 0.3 }),
    );
    expect(failure.code).toBe('invalid_opening_size');
  });

  it('rejects dimensions beyond the wall or ceiling limits with details', () => {
    // West wall span 4.5: along width max 4.0; and the east window cannot
    // be 1.9 m tall at a 0.9 m sill (top 2.8 > 2.65).
    const wide = expectRejected(
      setOpeningDimensions(DEFAULT_ROOM, 'entry-door', { alongSize: 4.5 }),
    );
    expect(wide.code).toBe('invalid_opening_size');
    expect(wide.details['field']).toBe('alongSize');

    const tall = expectRejected(
      setOpeningDimensions(DEFAULT_ROOM, 'east-window', { height: 1.9 }),
    );
    expect(tall.code).toBe('invalid_opening_size');
    expect(tall.details['field']).toBe('height');

    const nan = expectRejected(
      setOpeningDimensions(DEFAULT_ROOM, 'east-window', { alongSize: Number.NaN }),
    );
    expect(nan.code).toBe('invalid_opening_size');
  });

  it('is a no-op success when the requested size equals the current one', () => {
    const result = expectOk(
      setOpeningDimensions(DEFAULT_ROOM, 'east-window', {
        alongSize: 1.6,
        height: 1.4,
        sillHeight: 0.9,
      }),
    );
    expect(result.changed).toBe(false);
    expect(result.room).toBe(DEFAULT_ROOM);
  });

  it('rejects widening an opening into another opening on the same wall', () => {
    const entry = openingById(DEFAULT_ROOM, 'entry-door');
    const second = {
      ...entry,
      id: 'entry-door-second',
      footprint: { ...entry.footprint, z: 1.2 },
    };
    const twoDoors = { ...DEFAULT_ROOM, openings: [entry, second] };
    // First door at z -1 widened to 3.5 m reaches z 0.75; the second door's
    // left edge sits at 1.2 - 0.45 = 0.75, so margins are violated.
    const failure = expectRejected(
      setOpeningDimensions(twoDoors, 'entry-door', { alongSize: 3.5 }),
    );
    expect(failure.code).toBe('opening_overlap');
    expect(failure.details['otherOpeningId']).toBe('entry-door-second');
  });

  it('fails with opening_not_found for unknown ids and never mutates the room', () => {
    const failure = expectRejected(
      setOpeningDimensions(DEFAULT_ROOM, 'ghost-window', { alongSize: 1.9 }),
    );
    expect(failure.code).toBe('opening_not_found');

    const snapshot = JSON.parse(JSON.stringify(DEFAULT_ROOM)) as RoomData;
    setOpeningDimensions(DEFAULT_ROOM, 'east-window', { sillHeight: 0.6 });
    expect(DEFAULT_ROOM).toEqual(snapshot);
  });
});


describe('emptyRoom', () => {
  it('returns the default-sized shell with no openings and every zone', () => {
    const room = emptyRoom();
    expect(room.dimensions).toEqual(DEFAULT_ROOM.dimensions);
    expect(room.openings).toEqual([]);
    expect(room.placementZones.map((zone) => zone.id)).toEqual(
      DEFAULT_ROOM.placementZones.map((zone) => zone.id),
    );
    // Scaled at ratio 1 the footprints match the authored zones exactly.
    expect(room.placementZones[0].footprint).toEqual(DEFAULT_ROOM.placementZones[0].footprint);
  });

  it('keeps the caller dimensions and scales zones onto them', () => {
    const room = emptyRoom({ width: 8, depth: 6, height: 3.2 });
    expect(room.dimensions).toEqual({ width: 8, depth: 6, height: 3.2 });
    expect(room.openings).toEqual([]);
    const living = room.placementZones.find((zone) => zone.id === 'living-area');
    expect(living?.footprint.width).toBeCloseTo(3.0 * (8 / 6), 12);
    expect(living?.footprint.x).toBeCloseTo(0 * (8 / 6), 12);
    expect(room.placementZones.length).toBeGreaterThanOrEqual(5);
  });

  it('drops zones too small for a minimal room, mirroring resizeRoom', () => {
    const room = emptyRoom({ width: 2.0, depth: 2.0, height: 2.4 });
    expect(room.placementZones.map((zone) => zone.id)).toEqual([
      'reading-corner',
      'living-area',
      'center-table',
    ]);
    for (const zone of room.placementZones) {
      expect(zone.footprint.width).toBeGreaterThanOrEqual(0.35);
      expect(zone.footprint.depth).toBeGreaterThanOrEqual(0.35);
    }
  });

  it('returns fresh, independent zone objects on every call', () => {
    const first = emptyRoom();
    const second = emptyRoom();
    expect(first.placementZones).not.toBe(second.placementZones);
    expect(first.placementZones[0]).not.toBe(second.placementZones[0]);
    expect(first.placementZones[0].footprint).toEqual(second.placementZones[0].footprint);
    expect(first.placementZones[0].footprint.x).toBeCloseTo(2.25, 12);
  });
});
