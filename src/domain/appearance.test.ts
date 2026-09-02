/**
 * Room appearance updates — pure domain contract tests.
 *
 * Covers `updateRoomAppearance`: single-field immutable updates, same-value
 * no-ops that preserve the caller's reference, and deterministic rejection
 * of unknown finish/wallpaper ids with exact field/allowed details.
 */

import { describe, expect, it } from 'vitest';
import { updateRoomAppearance } from './appearance';
import { DEFAULT_ROOM_APPEARANCE } from '@/data/appearance';
import type { RoomAppearance } from './types';

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

const STYLED: RoomAppearance = {
  wallFinishId: 'clay-plaster',
  floorFinishId: 'walnut',
  wallpaperId: 'arched-geo',
};

describe('updateRoomAppearance', () => {
  it('updates a single field immutably, preserving the others', () => {
    const updated = expectOk(updateRoomAppearance(DEFAULT_ROOM_APPEARANCE, { wallFinishId: 'soft-sage' }));
    expect(updated).toEqual({
      wallFinishId: 'soft-sage',
      floorFinishId: 'natural-oak',
      wallpaperId: 'none',
    });
    expect(updated).not.toBe(DEFAULT_ROOM_APPEARANCE);
    expect(DEFAULT_ROOM_APPEARANCE.wallFinishId).toBe('gallery-white');
  });

  it('applies a full three-field restyle', () => {
    const updated = expectOk(updateRoomAppearance(DEFAULT_ROOM_APPEARANCE, STYLED));
    expect(updated).toEqual(STYLED);
  });

  it('returns the original reference for an empty patch and for unchanged values', () => {
    const fromEmpty = expectOk(updateRoomAppearance(STYLED, {}));
    expect(fromEmpty).toBe(STYLED);

    const fromSame = expectOk(
      updateRoomAppearance(STYLED, {
        wallFinishId: STYLED.wallFinishId,
        floorFinishId: 'walnut',
      }),
    );
    expect(fromSame).toBe(STYLED);
  });

  it.each([
    { field: 'wallFinishId', value: 'neon-pink', allowed: ['gallery-white', 'warm-sand', 'soft-sage', 'clay-plaster'] },
    { field: 'floorFinishId', value: 'shag-carpet', allowed: ['natural-oak', 'white-oak', 'walnut', 'slate-tile'] },
    { field: 'wallpaperId', value: 'lava-lamp', allowed: ['none', 'linen-stripe', 'botanical-line', 'arched-geo'] },
  ] as const)('rejects an invalid $field with exact details and an untouched input', ({ field, value, allowed }) => {
    const before = { ...STYLED };
    const result = expectRejected(updateRoomAppearance(STYLED, { [field]: value }));
    expect(result.code).toBe('invalid_room_appearance');
    expect(result.details.field).toBe(field);
    expect(result.details.value).toBe(value);
    expect(result.details.allowedValues).toEqual(allowed);
    expect(STYLED).toEqual(before);
  });

  it('validates in wall, floor, wallpaper order and fails on the first bad field', () => {
    const result = expectRejected(
      updateRoomAppearance(STYLED, {
        wallFinishId: 'no-such-wall' as RoomAppearance['wallFinishId'],
        floorFinishId: 'no-such-floor' as RoomAppearance['floorFinishId'],
      }),
    );
    expect(result.details.field).toBe('wallFinishId');
  });
});
