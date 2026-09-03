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
import { ROOM_SIZE_LIMITS, resizeRoom } from './resize';
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
