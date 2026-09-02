/**
 * Design snapshots — pure save/restore helpers for the room editor.
 *
 * Snapshots are fully serializable (plain data, ISO timestamps) and never
 * share mutable references with the live design: saving deep-copies the
 * current room/items/budget, restoring deep-copies the snapshot back out,
 * so restoring preserves exact positions, rotations, locks, and budget.
 *
 * All ids and timestamps are supplied by the caller, keeping the store in
 * control of determinism (tests, replay, and WebMCP tool calls all pass
 * fixed values). Expected invalid input (duplicate instance ids, corrupt
 * snapshot shape) is reported as a structured failure, never thrown.
 */

import type {
  DesignSnapshot,
  PlacedFurniture,
  RectFootprint,
  RoomData,
  SerializableResult,
} from './types';

/** Caller-provided identity and timestamps for a new snapshot. */
export interface DesignSnapshotMeta {
  /** caller-supplied snapshot id (deterministic for tests/replay) */
  id: string;
  /** human-readable snapshot name */
  name: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-modification timestamp */
  updatedAt: string;
  /** CSS gradient string for the snapshot thumbnail */
  thumbnailGradient?: string;
}

/** The mutable design state a snapshot captures and later restores. */
export interface RestoredDesign {
  room: RoomData;
  items: readonly PlacedFurniture[];
  budget: number;
}

/** Returns the first instance id appearing more than once, if any. */
function findDuplicateInstanceId(items: readonly PlacedFurniture[]): string | undefined {
  for (let i = 1; i < items.length; i++) {
    const id = items[i].instanceId;
    for (let j = 0; j < i; j++) {
      if (items[j].instanceId === id) {
        return id;
      }
    }
  }
  return undefined;
}

function cloneFootprint(footprint: RectFootprint): RectFootprint {
  return { x: footprint.x, z: footprint.z, width: footprint.width, depth: footprint.depth };
}

function clonePlacedFurniture(item: PlacedFurniture): PlacedFurniture {
  return {
    instanceId: item.instanceId,
    productId: item.productId,
    position: { x: item.position.x, y: item.position.y, z: item.position.z },
    rotation: item.rotation,
    locked: item.locked,
    source: item.source,
  };
}

function cloneRoomData(room: RoomData): RoomData {
  return {
    dimensions: {
      width: room.dimensions.width,
      depth: room.dimensions.depth,
      height: room.dimensions.height,
    },
    openings: room.openings.map((opening) => ({
      id: opening.id,
      kind: opening.kind,
      wall: opening.wall,
      footprint: cloneFootprint(opening.footprint),
      height: opening.height,
      sillHeight: opening.sillHeight,
    })),
    placementZones: room.placementZones.map((zone) => ({
      id: zone.id,
      kind: zone.kind,
      name: zone.name,
      footprint: cloneFootprint(zone.footprint),
      ...(zone.allowedCategories !== undefined
        ? { allowedCategories: [...zone.allowedCategories] }
        : {}),
      ...(zone.maxItems !== undefined ? { maxItems: zone.maxItems } : {}),
      ...(zone.rank !== undefined ? { rank: zone.rank } : {}),
      ...(zone.hint !== undefined ? { hint: zone.hint } : {}),
    })),
  };
}

/**
 * Capture the current design as a serializable snapshot.
 *
 * The snapshot is a full deep copy: mutating the returned snapshot (or the
 * live room/items) never affects the other side. The store decides when the
 * snapshot is persisted and how ids/timestamps are minted.
 */
export function createDesignSnapshot(
  room: RoomData,
  items: readonly PlacedFurniture[],
  budget: number,
  meta: DesignSnapshotMeta,
): SerializableResult<DesignSnapshot> {
  if (!Number.isFinite(budget)) {
    return {
      ok: false,
      code: 'invalid_budget',
      message: 'Snapshot budget must be a finite number',
      details: { budget },
    };
  }
  const duplicateId = findDuplicateInstanceId(items);
  if (duplicateId !== undefined) {
    return {
      ok: false,
      code: 'duplicate_instance_ids',
      message: `Design contains duplicate instance id "${duplicateId}"`,
      details: { instanceIds: [duplicateId] },
    };
  }
  return {
    ok: true,
    data: {
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      room: cloneRoomData(room),
      items: items.map(clonePlacedFurniture),
      budget,
      ...(meta.thumbnailGradient !== undefined ? { thumbnailGradient: meta.thumbnailGradient } : {}),
    },
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function invalidSnapshot(issue: string): SerializableResult<RestoredDesign> {
  return {
    ok: false,
    code: 'invalid_snapshot',
    message: `Snapshot cannot be restored: ${issue}`,
    details: { issue },
  };
}

/**
 * Restore a design from a snapshot (e.g. loaded from storage).
 *
 * The restored room/items/budget are fresh deep copies — mutating restored
 * state never mutates the snapshot, and re-saving later is independent.
 * Snapshot shape is validated before anything is returned; malformed or
 * duplicate-instance snapshots fail with a structured error instead of
 * throwing.
 */
export function loadDesignSnapshot(snapshot: DesignSnapshot): SerializableResult<RestoredDesign> {
  if (snapshot === null || typeof snapshot !== 'object') {
    return invalidSnapshot('snapshot is not an object');
  }
  const room = snapshot.room;
  if (room === null || typeof room !== 'object') {
    return invalidSnapshot('room data is missing');
  }
  const dimensions = room.dimensions;
  if (dimensions === null || typeof dimensions !== 'object') {
    return invalidSnapshot('room dimensions are missing');
  }
  if (
    !isFiniteNumber(dimensions.width) ||
    !isFiniteNumber(dimensions.depth) ||
    !isFiniteNumber(dimensions.height)
  ) {
    return invalidSnapshot('room dimensions are not finite numbers');
  }
  if (!Array.isArray(room.openings)) {
    return invalidSnapshot('room openings are missing');
  }
  if (!Array.isArray(room.placementZones)) {
    return invalidSnapshot('room placement zones are missing');
  }
  if (!Array.isArray(snapshot.items)) {
    return invalidSnapshot('placed items are missing');
  }
  if (!isFiniteNumber(snapshot.budget)) {
    return invalidSnapshot('budget is not a finite number');
  }
  for (let i = 0; i < snapshot.items.length; i++) {
    const item = snapshot.items[i];
    if (item === null || typeof item !== 'object') {
      return invalidSnapshot(`item ${i} is not an object`);
    }
    const position = item.position;
    if (position === null || typeof position !== 'object') {
      return invalidSnapshot(`item ${i} position is missing`);
    }
    if (
      !isFiniteNumber(position.x) ||
      !isFiniteNumber(position.y) ||
      !isFiniteNumber(position.z)
    ) {
      return invalidSnapshot(`item ${i} position is not finite`);
    }
    if (!isFiniteNumber(item.rotation)) {
      return invalidSnapshot(`item ${i} rotation is not a finite number`);
    }
    if (typeof item.locked !== 'boolean') {
      return invalidSnapshot(`item ${i} locked is not a boolean`);
    }
    if (typeof item.instanceId !== 'string' || typeof item.productId !== 'string') {
      return invalidSnapshot(`item ${i} ids are not strings`);
    }
    if (item.source !== 'existing' && item.source !== 'marketplace') {
      return invalidSnapshot(`item ${i} source is invalid`);
    }
  }
  const duplicateId = findDuplicateInstanceId(snapshot.items);
  if (duplicateId !== undefined) {
    return {
      ok: false,
      code: 'duplicate_instance_ids',
      message: `Snapshot contains duplicate instance id "${duplicateId}"`,
      details: { instanceIds: [duplicateId] },
    };
  }
  return {
    ok: true,
    data: {
      room: cloneRoomData(room),
      items: snapshot.items.map(clonePlacedFurniture),
      budget: snapshot.budget,
    },
  };
}
