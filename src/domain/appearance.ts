/**
 * Room appearance — pure, deterministic updates for the room's visual
 * styling. Appearance is store/design state but never geometry: placement,
 * validation, and pricing never read it. Only the stable finish ids are
 * stored; colors and pattern metadata live in `src/data/appearance.ts`.
 */

import type { RoomAppearance, SerializableResult } from './types';
import { FLOOR_FINISH_IDS, WALL_FINISH_IDS, WALLPAPER_IDS } from './types';

function isWallFinishId(value: unknown): value is RoomAppearance['wallFinishId'] {
  return (WALL_FINISH_IDS as readonly unknown[]).includes(value);
}

function isFloorFinishId(value: unknown): value is RoomAppearance['floorFinishId'] {
  return (FLOOR_FINISH_IDS as readonly unknown[]).includes(value);
}

function isWallpaperId(value: unknown): value is RoomAppearance['wallpaperId'] {
  return (WALLPAPER_IDS as readonly unknown[]).includes(value);
}

/**
 * Apply a partial styling change to the current appearance.
 *
 * Fields are validated in wall → floor → wallpaper order against the
 * stable id vocabularies; the first invalid value fails with
 * `invalid_room_appearance` and details `{ field, value, allowedValues }`,
 * leaving the input untouched. An empty patch or a patch that resolves to
 * the exact current ids is a successful no-op that returns the original
 * `current` reference.
 */
export function updateRoomAppearance(
  current: RoomAppearance,
  patch: Partial<RoomAppearance>,
): SerializableResult<RoomAppearance> {
  const patchWall = patch.wallFinishId;
  if (patchWall !== undefined && !isWallFinishId(patchWall)) {
    return {
      ok: false,
      code: 'invalid_room_appearance',
      message: `"${patchWall}" is not an available wall finish.`,
      details: { field: 'wallFinishId', value: patchWall, allowedValues: WALL_FINISH_IDS },
    };
  }
  const wallFinishId = patchWall ?? current.wallFinishId;

  const patchFloor = patch.floorFinishId;
  if (patchFloor !== undefined && !isFloorFinishId(patchFloor)) {
    return {
      ok: false,
      code: 'invalid_room_appearance',
      message: `"${patchFloor}" is not an available floor finish.`,
      details: { field: 'floorFinishId', value: patchFloor, allowedValues: FLOOR_FINISH_IDS },
    };
  }
  const floorFinishId = patchFloor ?? current.floorFinishId;

  const patchWallpaper = patch.wallpaperId;
  if (patchWallpaper !== undefined && !isWallpaperId(patchWallpaper)) {
    return {
      ok: false,
      code: 'invalid_room_appearance',
      message: `"${patchWallpaper}" is not an available wallpaper.`,
      details: { field: 'wallpaperId', value: patchWallpaper, allowedValues: WALLPAPER_IDS },
    };
  }
  const wallpaperId = patchWallpaper ?? current.wallpaperId;

  const unchanged =
    wallFinishId === current.wallFinishId &&
    floorFinishId === current.floorFinishId &&
    wallpaperId === current.wallpaperId;
  if (unchanged) {
    return { ok: true, data: current };
  }
  return { ok: true, data: { wallFinishId, floorFinishId, wallpaperId } };
}
