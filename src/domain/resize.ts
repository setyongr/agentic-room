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
  RectFootprint,
  RoomData,
  RoomDimensions,
  RoomOpening,
  RoomOpeningKind,
  SerializableResult,
  WallSide,
} from './types';
import { DEFAULT_ROOM_DIMENSIONS } from './types';
import { PLACEMENT_ZONES } from '@/data/placementZones';

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

/** Rescale one opening onto the new room shell; undefined when it no longer fits. */
function rescaleOpeningForWall(opening: RoomOpening, oldSpan: number, newSpan: number, newPerp: number): RoomOpening | undefined {
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
    const resized = rescaleOpeningForWall(opening, oldSpan, newSpan, wallPerp(opening.wall, width, depth));
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


/* ------------------------------------------------------------------ */
/* Opening placement: reposition, relocate, add, remove               */
/* ------------------------------------------------------------------ */

/** Perpendicular wall thickness (m) used by every new opening footprint. */
export const OPENING_THICKNESS = 0.2;

/** Smallest supported along-wall width for an opening (meters). */
export const OPENING_SIZE_MIN_ALONG = 0.4;
/** Smallest supported opening height (meters). */
export const OPENING_SIZE_MIN_HEIGHT = 0.3;
/** Smallest supported sill height (meters; 0 = on the floor). */
export const OPENING_SIZE_MIN_SILL = 0;

/** Result payload of {@link moveOpening}. */
export interface MoveOpeningResult {
  /** the room with the opening moved (openings array rebuilt) */
  room: RoomData;
  /** the opening after the move */
  opening: RoomOpening;
  /** false when the requested center equals the current one (no-op) */
  changed: boolean;
}

/** Result payload of {@link addOpening} and {@link removeOpening}. */
export interface OpeningMutationResult {
  /** the updated room (openings array rebuilt) */
  room: RoomData;
  /** the added or removed opening */
  opening: RoomOpening;
  /** false when the request changed nothing (no-op) */
  changed: boolean;
}

/** Standard door/window geometry used when adding new openings (meters). */
export const OPENING_PRESETS: Readonly<
  Record<
    RoomOpeningKind,
    { kind: RoomOpeningKind; alongSize: number; height: number; sillHeight: number; label: string }
  >
> = {
  door: { kind: 'door', alongSize: 0.9, height: 2.1, sillHeight: 0, label: 'Door' },
  window: { kind: 'window', alongSize: 1.6, height: 1.4, sillHeight: 0.9, label: 'Window' },
};

/** Along-wall span (meters) of the wall an opening sits in. */
function wallSpan(side: WallSide, dimensions: RoomDimensions): number {
  return side === 'north' || side === 'south' ? dimensions.width : dimensions.depth;
}

/** The opening's along-wall center coordinate in room coordinates. */
export function openingAlongWallCenter(opening: RoomOpening): number {
  const axis = wallAxis(opening.wall);
  return axis === 'x' ? opening.footprint.x : opening.footprint.z;
}

/** The opening's extent along its wall (meters). */
export function openingAlongWallSize(opening: RoomOpening): number {
  const axis = wallAxis(opening.wall);
  return axis === 'x' ? opening.footprint.width : opening.footprint.depth;
}

/**
 * Movable range (meters) for an opening of `alongSize` on `wall`, in room
 * coordinates (x for north/south walls, z for east/west walls). Returns
 * null when the wall is too short to host the opening at all, mirroring
 * the {@link resizeRoom} drop rule (an opening needs its own width plus
 * {@link OPENING_WALL_SLACK} to remain a real cut).
 */
export function openingLimitsFor(
  wall: WallSide,
  alongSize: number,
  dimensions: RoomDimensions,
): { min: number; max: number } | null {
  const span = wallSpan(wall, dimensions);
  if (span < alongSize + OPENING_WALL_SLACK) {
    return null;
  }
  const limit = span / 2 - alongSize / 2 - OPENING_EDGE_MARGIN;
  return { min: -limit, max: limit };
}

/** Convenience: {@link openingLimitsFor} for an existing opening's own wall. */
export function openingAlongWallLimits(
  opening: RoomOpening,
  dimensions: RoomDimensions,
): { min: number; max: number } | null {
  return openingLimitsFor(opening.wall, openingAlongWallSize(opening), dimensions);
}

/** True when a center would collide with another opening on the same wall. */
function blockedByOtherOpening(
  openings: readonly RoomOpening[],
  wall: WallSide,
  alongSize: number,
  center: number,
  selfId?: string,
): RoomOpening | undefined {
  const half = alongSize / 2 + OPENING_EDGE_MARGIN;
  for (const other of openings) {
    if (other.id === selfId) continue;
    if (other.wall !== wall) continue;
    const otherHalf = openingAlongWallSize(other) / 2 + OPENING_EDGE_MARGIN;
    if (Math.abs(center - openingAlongWallCenter(other)) < half + otherHalf) {
      return other;
    }
  }
  return undefined;
}

/**
 * Default along-wall center for a newly added opening: the leftmost spot in
 * the widest free gap (wall ends and other openings respected, keeping
 * {@link OPENING_EDGE_MARGIN} clearance). Null when the wall has no usable
 * span left for an opening of this size.
 */
function defaultOpeningCenter(
  room: RoomData,
  wall: WallSide,
  alongSize: number,
): number | null {
  const limits = openingLimitsFor(wall, alongSize, room.dimensions);
  if (limits === null) return null;
  const half = alongSize / 2 + OPENING_EDGE_MARGIN;
  const blocked = room.openings
    .filter((o) => o.wall === wall)
    .map((o) => {
      const c = openingAlongWallCenter(o);
      const r = openingAlongWallSize(o) / 2 + OPENING_EDGE_MARGIN;
      return { min: c - r - half, max: c + r + half };
    })
    .sort((a, b) => a.min - b.min);

  let cursor = limits.min;
  for (const interval of blocked) {
    const start = Math.max(interval.min, limits.min);
    const end = Math.min(interval.max, limits.max);
    if (end <= start) continue; // fully outside the movable range
    if (start > cursor) {
      return cursor; // free gap before this blocked interval
    }
    cursor = Math.max(cursor, end);
  }
  return cursor <= limits.max ? cursor : null;
}

/** Build an opening footprint oriented to `wall` at the given along-center. */
function orientedFootprint(
  wall: WallSide,
  alongSize: number,
  center: number,
  dimensions: RoomDimensions,
): RectFootprint {
  const perp = wallPerp(wall, dimensions.width, dimensions.depth);
  return wallAxis(wall) === 'x'
    ? { x: center, z: perp, width: alongSize, depth: OPENING_THICKNESS }
    : { x: perp, z: center, width: OPENING_THICKNESS, depth: alongSize };
}

/** Height capped so the opening top stays {@link OPENING_TOP_CLEARANCE} below the ceiling. */
function capOpeningHeight(sill: number, height: number, wallHeight: number): number {
  const ceilingClearance = wallHeight - OPENING_TOP_CLEARANCE;
  const top = sill + height;
  return top > ceilingClearance ? Math.max(0.05, ceilingClearance - sill) : height;
}

/**
 * Add a standard door or window to any wall.
 *
 * `id` must be unique across the room's openings (else `duplicate_opening_id`).
 * The opening is built from the {@link OPENING_PRESETS} for its kind, sized
 * to the wall's real span: its along-wall size stays fixed, its height is
 * capped below the ceiling (top kept {@link OPENING_TOP_CLEARANCE} below the
 * wall height), and its footprint gets the standard wall thickness. The
 * along-wall center defaults to the leftmost free spot on the wall (see
 * {@link defaultOpeningCenter}) or clamps to the movable range when given
 * explicitly; placements that collide with another opening fail with
 * `opening_overlap`, and walls that cannot host the opening at all fail with
 * `invalid_opening_position`.
 */
export function addOpening(
  room: RoomData,
  draft: { kind: RoomOpeningKind; wall: WallSide; center?: number },
  id: string,
): SerializableResult<OpeningMutationResult> {
  if (id === '') {
    return { ok: false, code: 'duplicate_opening_id', message: 'Opening id must not be empty.', details: {} };
  }
  if (room.openings.some((o) => o.id === id)) {
    return {
      ok: false,
      code: 'duplicate_opening_id',
      message: `An opening with id "${id}" already exists in this room.`,
      details: { openingId: id },
    };
  }
  const preset = OPENING_PRESETS[draft.kind];
  const alongSize = preset.alongSize;
  if (draft.center === undefined) {
    const suggested = defaultOpeningCenter(room, draft.wall, alongSize);
    if (suggested === null) {
      return {
        ok: false,
        code: 'invalid_opening_position',
        message: `The ${draft.wall} wall has no free span left for another ${preset.label.toLowerCase()}.`,
        details: { wall: draft.wall, kind: draft.kind, alongSize },
      };
    }
    return addOpeningAt(room, draft, id, preset, alongSize, suggested);
  }
  const limits = openingLimitsFor(draft.wall, alongSize, room.dimensions);
  if (limits === null) {
    return {
      ok: false,
      code: 'invalid_opening_position',
      message: `Cannot add a ${preset.label.toLowerCase()} here: the ${draft.wall} wall is too short to host it.`,
      details: { wall: draft.wall, kind: draft.kind, alongSize },
    };
  }
  if (!Number.isFinite(draft.center)) {
    return {
      ok: false,
      code: 'invalid_opening_position',
      message: 'The along-wall center must be a finite number of meters.',
      details: { wall: draft.wall, center: String(draft.center) },
    };
  }
  const clamped = Math.min(limits.max, Math.max(limits.min, draft.center));
  return addOpeningAt(room, draft, id, preset, alongSize, clamped);
}

/** Shared add path after the center has been resolved and pre-validated. */
function addOpeningAt(
  room: RoomData,
  draft: { kind: RoomOpeningKind; wall: WallSide; center?: number },
  id: string,
  preset: (typeof OPENING_PRESETS)[RoomOpeningKind],
  alongSize: number,
  center: number,
): SerializableResult<OpeningMutationResult> {
  const collides = blockedByOtherOpening(room.openings, draft.wall, alongSize, center);
  if (collides !== undefined) {
    return {
      ok: false,
      code: 'opening_overlap',
      message: `Cannot add a ${preset.label.toLowerCase()} here: it would collide with opening "${collides.id}" on the same wall.`,
      details: { openingId: id, otherOpeningId: collides.id, center },
    };
  }
  const height = capOpeningHeight(
    preset.sillHeight,
    preset.height,
    room.dimensions.height,
  );
  if (height <= 0.05) {
    return {
      ok: false,
      code: 'invalid_opening_position',
      message: `The ${draft.wall} wall is too low to host a ${preset.label.toLowerCase()}.`,
      details: { wall: draft.wall, kind: draft.kind },
    };
  }
  const opening: RoomOpening = {
    id,
    kind: preset.kind,
    wall: draft.wall,
    footprint: orientedFootprint(draft.wall, alongSize, center, room.dimensions),
    height,
    sillHeight: preset.sillHeight,
  };
  const openings = room.openings.slice();
  openings.push(opening);
  return {
    ok: true,
    data: { room: { ...room, openings }, opening, changed: true },
  };
}

/**
 * Remove a door or window from the room. Furniture that used to block it is
 * re-validated in the same store write, so removal only ever clears
 * clearance issues. Unknown ids fail with `opening_not_found`.
 */
export function removeOpening(
  room: RoomData,
  openingId: string,
): SerializableResult<OpeningMutationResult> {
  const index = room.openings.findIndex((opening) => opening.id === openingId);
  if (index === -1) {
    return {
      ok: false,
      code: 'opening_not_found',
      message: `No room opening with id "${openingId}".`,
      details: { openingId },
    };
  }
  const removed = room.openings[index];
  const openings = room.openings.slice();
  openings.splice(index, 1);
  return {
    ok: true,
    data: { room: { ...room, openings }, opening: removed, changed: true },
  };
}

/**
 * Move one door or window along its wall — or onto a different wall when
 * `wall` is given.
 *
 * The opening keeps its real size, height, and sill; moving along the same
 * wall only changes the along-wall center, while relocating re-orients the
 * footprint to the target wall (width/depth swap so the real along-wall
 * width stays constant). The requested center is clamped to the movable
 * range of the target wall, and a request that would push the opening onto
 * another opening of the same wall fails with `opening_overlap`. Unknown ids
 * fail with `opening_not_found`; walls too short to host the opening, and
 * non-finite centers, fail with `invalid_opening_position`. Requesting the
 * current position (center and wall) is a no-op success with
 * `changed: false` and the input room returned unchanged.
 */
export function moveOpening(
  room: RoomData,
  openingId: string,
  alongCenter: number,
  wall?: WallSide,
): SerializableResult<MoveOpeningResult> {
  const index = room.openings.findIndex((opening) => opening.id === openingId);
  if (index === -1) {
    return {
      ok: false,
      code: 'opening_not_found',
      message: `No room opening with id "${openingId}".`,
      details: { openingId },
    };
  }
  if (!Number.isFinite(alongCenter)) {
    return {
      ok: false,
      code: 'invalid_opening_position',
      message: 'The along-wall center must be a finite number of meters.',
      details: { openingId, alongCenter: String(alongCenter) },
    };
  }
  const current = room.openings[index];
  const targetWall = wall ?? current.wall;
  const alongSize = openingAlongWallSize(current);
  const limits = openingLimitsFor(targetWall, alongSize, room.dimensions);
  if (limits === null) {
    return {
      ok: false,
      code: 'invalid_opening_position',
      message: 'This opening cannot be placed there: the wall is too short to host it.',
      details: { openingId, wall: targetWall },
    };
  }
  const clamped = Math.min(limits.max, Math.max(limits.min, alongCenter));

  // Reject requests that collide with another opening cut into the same wall.
  const collides = blockedByOtherOpening(room.openings, targetWall, alongSize, clamped, openingId);
  if (collides !== undefined) {
    return {
      ok: false,
      code: 'opening_overlap',
      message: `Cannot move this opening here: it would collide with opening "${collides.id}" on the same wall.`,
      details: { openingId, otherOpeningId: collides.id, center: clamped },
    };
  }

  const currentCenter = openingAlongWallCenter(current);
  if (targetWall === current.wall && Math.abs(clamped - currentCenter) <= 1e-9) {
    return { ok: true, data: { room, opening: current, changed: false } };
  }

  const opening: RoomOpening = {
    ...current,
    wall: targetWall,
    footprint: orientedFootprint(targetWall, alongSize, clamped, room.dimensions),
  };
  const openings = room.openings.slice();
  openings[index] = opening;
  return {
    ok: true,
    data: { room: { ...room, openings }, opening, changed: true },
  };
}


/* ------------------------------------------------------------------ */
/* Opening sizing: width, height, sill                                 */
/* ------------------------------------------------------------------ */

/** Requested dimension changes for one opening (at least one field). */
export interface OpeningDimensionPatch {
  /** along-wall width in meters (x for north/south walls, z for east/west) */
  alongSize?: number;
  /** opening height above its sill in meters */
  height?: number;
  /** sill height above the floor in meters (doors stay at 0) */
  sillHeight?: number;
}

/** Feasible ranges for every dimension of one opening on its current wall. */
export interface OpeningDimensionLimits {
  alongSize: { min: number; max: number };
  height: { min: number; max: number };
  sillHeight: { min: number; max: number };
}

/**
 * Feasible dimension ranges for an opening on its current wall: the
 * along-wall width must leave the wall hostable (wall minus
 * {@link OPENING_WALL_SLACK}), the opening top must stay
 * {@link OPENING_TOP_CLEARANCE} below the ceiling, and door sills are
 * fixed at 0. Window sill edits are the opening's "Y axis" — how high its
 * bottom edge sits above the floor.
 */
export function openingDimensionLimits(
  opening: RoomOpening,
  dimensions: RoomDimensions,
): OpeningDimensionLimits {
  const span = wallSpan(opening.wall, dimensions);
  const ceilingClearance = dimensions.height - OPENING_TOP_CLEARANCE;
  const alongMax = Math.max(OPENING_SIZE_MIN_ALONG, span - OPENING_WALL_SLACK);
  const heightMax = Math.max(
    OPENING_SIZE_MIN_HEIGHT,
    ceilingClearance - opening.sillHeight,
  );
  return {
    alongSize: { min: OPENING_SIZE_MIN_ALONG, max: alongMax },
    height: { min: OPENING_SIZE_MIN_HEIGHT, max: heightMax },
    sillHeight: {
      min: OPENING_SIZE_MIN_SILL,
      max: Math.max(
        OPENING_SIZE_MIN_SILL,
        opening.kind === 'door' ? 0 : ceilingClearance - OPENING_SIZE_MIN_HEIGHT,
      ),
    },
  };
}

/**
 * Change an opening's size in place on its wall: along-wall width, height,
 * and (for windows) sill height — the vertical placement of the opening.
 *
 * Every supplied field must be finite and inside the ranges of
 * {@link openingDimensionLimits}; a door's sill is fixed at 0. Requests
 * that would make the opening collide with another opening on the same
 * wall fail with `opening_overlap`; out-of-range or non-finite values fail
 * with `invalid_opening_size`; unknown ids fail with `opening_not_found`.
 * Resizing never moves the opening's center. Requesting the current size
 * is a no-op success.
 */
export function setOpeningDimensions(
  room: RoomData,
  openingId: string,
  patch: OpeningDimensionPatch,
): SerializableResult<OpeningMutationResult> {
  const index = room.openings.findIndex((opening) => opening.id === openingId);
  if (index === -1) {
    return {
      ok: false,
      code: 'opening_not_found',
      message: `No room opening with id "${openingId}".`,
      details: { openingId },
    };
  }
  const current = room.openings[index];
  const alongSize = patch.alongSize ?? openingAlongWallSize(current);
  const height = patch.height ?? current.height;
  const sillHeight = patch.sillHeight ?? current.sillHeight;

  if (current.kind === 'door' && sillHeight !== 0) {
    return {
      ok: false,
      code: 'invalid_opening_size',
      message: 'Doors must sit on the floor: their sill height stays at 0 m.',
      details: { openingId, kind: current.kind, sillHeight },
    };
  }

  const limits = openingDimensionLimits(current, room.dimensions);
  const alongValid =
    Number.isFinite(alongSize) &&
    alongSize >= limits.alongSize.min &&
    alongSize <= limits.alongSize.max;
  const heightValid =
    Number.isFinite(height) && height >= limits.height.min && height <= limits.height.max;
  const sillValid =
    Number.isFinite(sillHeight) &&
    sillHeight >= limits.sillHeight.min &&
    sillHeight <= limits.sillHeight.max;
  const invalidField: 'alongSize' | 'height' | 'sillHeight' | undefined = alongValid
    ? heightValid
      ? sillValid
        ? undefined
        : 'sillHeight'
      : 'height'
    : 'alongSize';
  if (invalidField !== undefined) {
    const range =
      invalidField === 'alongSize'
        ? limits.alongSize
        : invalidField === 'height'
          ? limits.height
          : limits.sillHeight;
    return {
      ok: false,
      code: 'invalid_opening_size',
      message:
        invalidField === 'alongSize'
          ? `The along-wall width must be between ${limits.alongSize.min} and ${limits.alongSize.max} m for this wall`
          : invalidField === 'height'
            ? `The height must be between ${limits.height.min} and ${limits.height.max} m (the opening top stays below the ceiling)`
            : `The sill height must be between ${limits.sillHeight.min} and ${limits.sillHeight.max} m`,
      details: { openingId, field: invalidField, min: range.min, max: range.max },
    };
  }

  // Wider openings must not push into another opening on the same wall.
  const collides = blockedByOtherOpening(
    room.openings,
    current.wall,
    alongSize,
    openingAlongWallCenter(current),
    openingId,
  );
  if (collides !== undefined) {
    return {
      ok: false,
      code: 'opening_overlap',
      message: `Cannot resize this opening: it would collide with opening "${collides.id}" on the same wall.`,
      details: { openingId, otherOpeningId: collides.id, alongSize },
    };
  }

  const same =
    Math.abs(alongSize - openingAlongWallSize(current)) <= 1e-9 &&
    height === current.height &&
    sillHeight === current.sillHeight;
  if (same) {
    return { ok: true, data: { room, opening: current, changed: false } };
  }

  const opening: RoomOpening = {
    ...current,
    height,
    sillHeight,
    footprint: orientedFootprint(current.wall, alongSize, openingAlongWallCenter(current), room.dimensions),
  };
  const openings = room.openings.slice();
  openings[index] = opening;
  return {
    ok: true,
    data: { room: { ...room, openings }, opening, changed: true },
  };
}


/**
 * Build an empty project room shell: the requested (or default) real
 * dimensions, no doors or windows, and the standard placement zones
 * scaled/dropped for that footprint (the zones give the Furnish rail its
 * placement guidance once furniture is added back).
 */
export function emptyRoom(dimensions: RoomDimensions = DEFAULT_ROOM_DIMENSIONS): RoomData {
  const baseline = DEFAULT_ROOM_DIMENSIONS;
  const ratioW = baseline.width > 0 ? dimensions.width / baseline.width : 1;
  const ratioD = baseline.depth > 0 ? dimensions.depth / baseline.depth : 1;
  const placementZones: PlacementZone[] = [];
  for (const zone of PLACEMENT_ZONES) {
    const resized = resizeZone(zone, ratioW, ratioD);
    if (resized !== undefined) placementZones.push(resized);
  }
  return {
    dimensions: { ...dimensions },
    openings: [],
    placementZones,
  };
}
