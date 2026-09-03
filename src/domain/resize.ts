/**
 * Room resizing — pure, deterministic geometry rescaling for the editor.
 *
 * The room's width/depth/height are live state (the demo ships 6 × 4.5 ×
 * 2.8 m, but a user designs against their own real measurements). Resizing
 * rebuilds the room shell deterministically:
 *
 * - **Openings stay on their wall.** Each door/window keeps its wall, its
 *   real along-wall width and its height; its along-wall center scales
 *   proportionally with the wall span (so the east window stays a window on
 *   the east wall, roughly where it was relative to the room), clamped so
 *   the opening never runs off the end of a wall. An opening wider than the
 *   wall can no longer host is removed from the room and reported.
 *   Opening heights are capped so an opening's top never comes closer than
 *   {@link OPENING_TOP_CLEARANCE} below the ceiling.
 * - **Placement zones scale with the room**, keeping their relative
 *   position and their category/occupancy rules. Zones that shrink below a
 *   usable size are dropped, since no product can meaningfully target them.
 * - **Furniture is never moved.** Every placed item keeps its exact
 *   coordinates; pieces that end up outside the new walls surface as
 *   `out_of_bounds` validation errors (and `outside_zone`/`zone_mismatch`
 *   warnings where zones moved away) so the user can re-arrange with the
 *   layout feedback they already get for every other change.
 *
 * Every function here is pure: inputs are never mutated, output payloads
 * are JSON-serializable, and identical inputs produce byte-identical
 * results. `RoomData` from a snapshot with any positive dimensions is
 * accepted; guards avoid divide-by-zero on corrupt data.
 *
 * Stable error code: `invalid_room_size`.
 */

import type {
  PlacementZone,
  RoomData,
  RoomDimensions,
  RoomOpening,
  SerializableResult,
  WallSide,
} from './types';

/* ------------------------------------------------------------------ */
/* Supported size ranges (meters)                                      */
/* ------------------------------------------------------------------ */

/** Smallest supported room width/depth, meters. */
export const ROOM_LENGTH_MIN = 2.0;
/** Largest supported room width/depth, meters. */
export const ROOM_LENGTH_MAX = 10.0;
/** Smallest supported wall height, meters (clears the tallest opening tops). */
export const ROOM_HEIGHT_MIN = 2.4;
/** Largest supported wall height, meters. */
export const ROOM_HEIGHT_MAX = 4.0;

/** Per-axis size limits, shared by the domain, the UI, and WebMCP schemas. */
export const ROOM_SIZE_LIMITS = {
  width: { min: ROOM_LENGTH_MIN, max: ROOM_LENGTH_MAX },
  depth: { min: ROOM_LENGTH_MIN, max: ROOM_LENGTH_MAX },
  height: { min: ROOM_HEIGHT_MIN, max: ROOM_HEIGHT_MAX },
} as const;

/** Type of {@link ROOM_SIZE_LIMITS}. */
export type RoomSizeLimits = typeof ROOM_SIZE_LIMITS;

/**
 * Opening tops are kept at least this far below the ceiling when the wall
 * height changes, so a lintel and frame header always have room to render.
 */
export const OPENING_TOP_CLEARANCE = 0.15;

/**
 * Along-wall slack (m) an opening needs beyond its own width to stay cut
 * into a wall: at least ~0.25 m of solid wall on each side. Walls shorter
 * than this drop the opening instead of rendering slivers.
 */
const OPENING_WALL_SLACK = 0.5;

/** Distance (m) kept between an opening's edge and the end of its wall. */
const OPENING_EDGE_MARGIN = 0.05;

/** Zones whose scaled width or depth falls below this are dropped as unusable. */
const ZONE_MIN_EXTENT = 0.35;

/* ------------------------------------------------------------------ */
/* Result helpers                                                      */
/* ------------------------------------------------------------------ */

/** Successful payload of {@link resizeRoom}. */
export interface ResizeRoomResult {
  /** the resized room (openings and zones rebuilt; furniture untouched) */
  room: RoomData;
  /** ids of openings that no longer fit a wall and were removed */
  removedOpeningIds: readonly string[];
  /** false when the requested dimensions equal the current ones (no-op) */
  changed: boolean;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/** Axis the wall runs along: x for north/south walls, z for east/west walls. */
function wallAxis(side: WallSide): 'x' | 'z' {
  return side === 'north' || side === 'south' ? 'x' : 'z';
}

/** Center coordinate perpendicular to the wall an opening sits in. */
function wallPerp(side: WallSide, width: number, depth: number): number {
  switch (side) {
    case 'north':
      return -depth / 2;
    case 'south':
      return depth / 2;
    case 'west':
      return -width / 2;
    case 'east':
      return width / 2;
  }
}

/** Resize one opening onto the new room shell; undefined when it no longer fits. */
function resizeOpening(opening: RoomOpening, oldSpan: number, newSpan: number, newPerp: number): RoomOpening | undefined {
  const axis = wallAxis(opening.wall);
  const sizeAlongWall = axis === 'x' ? opening.footprint.width : opening.footprint.depth;
  // An opening needs its own width plus slack to remain a real cut in the wall.
  if (newSpan < sizeAlongWall + OPENING_WALL_SLACK) {
    return undefined;
  }
  const ratio = oldSpan > 0 ? newSpan / oldSpan : 1;
  const scaledCenter = (axis === 'x' ? opening.footprint.x : opening.footprint.z) * ratio;
  const limit = newSpan / 2 - sizeAlongWall / 2 - OPENING_EDGE_MARGIN;
  const centered = Math.min(limit, Math.max(-limit, scaledCenter));
  const footprint =
    axis === 'x'
      ? { x: centered, z: newPerp, width: opening.footprint.width, depth: opening.footprint.depth }
      : { x: newPerp, z: centered, width: opening.footprint.width, depth: opening.footprint.depth };
  return { ...opening, footprint };
}

/** Resize one placement zone onto the new footprint; undefined when it becomes unusable. */
function resizeZone(
  zone: PlacementZone,
  ratioW: number,
  ratioD: number,
): PlacementZone | undefined {
  const width = zone.footprint.width * ratioW;
  const depth = zone.footprint.depth * ratioD;
  if (width < ZONE_MIN_EXTENT || depth < ZONE_MIN_EXTENT) {
    return undefined;
  }
  return {
    ...zone,
    footprint: {
      x: zone.footprint.x * ratioW,
      z: zone.footprint.z * ratioD,
      width,
      depth,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Resize the room shell to the requested dimensions.
 *
 * Validates each dimension against {@link ROOM_SIZE_LIMITS}; out-of-range,
 * non-finite, or non-positive values fail with `invalid_room_size` and
 * leave the caller's room untouched. Returns the resized `RoomData` with
 * openings and placement zones rebuilt (furniture, budget, and appearance
 * are outside this module's scope — the store re-validates the layout after
 * a resize). Requesting the current dimensions is a no-op success with
 * `changed: false` and the input room returned unchanged.
 */
export function resizeRoom(
  room: RoomData,
  dimensions: RoomDimensions,
): SerializableResult<ResizeRoomResult> {
  const { width, depth, height } = dimensions;
  const limits = ROOM_SIZE_LIMITS;
  const invalid =
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    !Number.isFinite(height) ||
    width < limits.width.min ||
    width > limits.width.max ||
    depth < limits.depth.min ||
    depth > limits.depth.max ||
    height < limits.height.min ||
    height > limits.height.max;
  if (invalid) {
    return {
      ok: false,
      code: 'invalid_room_size',
      message: `Room dimensions must be within width/depth ${ROOM_LENGTH_MIN}–${ROOM_LENGTH_MAX} m and height ${ROOM_HEIGHT_MIN}–${ROOM_HEIGHT_MAX} m, got ${width} × ${depth} × ${height} m`,
      details: { dimensions: { width, depth, height }, limits },
    };
  }
  const current = room.dimensions;
  if (width === current.width && depth === current.depth && height === current.height) {
    return { ok: true, data: { room, removedOpeningIds: [], changed: false } };
  }

  const openings: RoomOpening[] = [];
  const removedOpeningIds: string[] = [];
  for (const opening of room.openings) {
    const axis = wallAxis(opening.wall);
    const oldSpan = axis === 'x' ? current.width : current.depth;
    const newSpan = axis === 'x' ? width : depth;
    const resized = resizeOpening(opening, oldSpan, newSpan, wallPerp(opening.wall, width, depth));
    if (resized === undefined) {
      removedOpeningIds.push(opening.id);
      continue;
    }
    // Keep an opening's top clear of the ceiling when the wall got lower.
    const top = resized.sillHeight + resized.height;
    const ceilingClearance = height - OPENING_TOP_CLEARANCE;
    if (top > ceilingClearance) {
      const cappedHeight = ceilingClearance - resized.sillHeight;
      if (cappedHeight <= 0.05) {
        removedOpeningIds.push(opening.id);
        continue;
      }
      openings.push({ ...resized, height: cappedHeight });
    } else {
      openings.push(resized);
    }
  }

  const ratioW = current.width > 0 ? width / current.width : 1;
  const ratioD = current.depth > 0 ? depth / current.depth : 1;
  const placementZones: PlacementZone[] = [];
  for (const zone of room.placementZones) {
    const resized = resizeZone(zone, ratioW, ratioD);
    if (resized !== undefined) placementZones.push(resized);
  }

  return {
    ok: true,
    data: {
      room: {
        dimensions: { width, depth, height },
        openings,
        placementZones,
      },
      removedOpeningIds,
      changed: true,
    },
  };
}
