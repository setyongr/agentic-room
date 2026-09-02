/**
 * Design snapshots — save/restore fidelity and alias-isolation tests.
 *
 * Covers the pure domain contract of `createDesignSnapshot` and
 * `loadDesignSnapshot` against real catalog products and room data:
 * snapshots round-trip furniture (product, position, rotation, locked
 * flag, source), budget, and room geometry; saved, restored, and live
 * state never share mutable references with one another; malformed
 * snapshots and duplicate instance ids fail as structured errors.
 */

import { describe, expect, it } from 'vitest';
import { createDesignSnapshot, loadDesignSnapshot } from './designs';
import { DEFAULT_DEMO_SNAPSHOT, DEFAULT_ROOM_ITEMS } from '@/data/demoRoom';
import { DEMO_BUDGET } from '@/data/products';
import type { PlacedFurniture, RoomData, SerializableResult } from './types';

const META = {
  id: 'snapshot-test-1',
  name: 'Test Design',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  thumbnailGradient: 'linear-gradient(135deg, #F3E9DC, #C96F4A)',
};

/** A room with real demo geometry: openings with footprints and zones with/without optional fields. */
function makeRoom(): RoomData {
  return {
    dimensions: { width: 6, depth: 4.5, height: 2.8 },
    openings: [
      {
        id: 'entry-door',
        kind: 'door',
        wall: 'west',
        footprint: { x: -3, z: -1, width: 0.2, depth: 0.9 },
        height: 2.1,
        sillHeight: 0,
      },
      {
        id: 'east-window',
        kind: 'window',
        wall: 'east',
        footprint: { x: 3, z: -0.6, width: 0.2, depth: 1.6 },
        height: 1.4,
        sillHeight: 0.9,
      },
    ],
    placementZones: [
      {
        id: 'living-area',
        kind: 'seating',
        name: 'Living Area',
        footprint: { x: 0, z: 0.2, width: 3, depth: 2.2 },
        allowedCategories: ['sofa', 'rug', 'coffee_table'],
        maxItems: 4,
      },
      {
        id: 'media-wall',
        kind: 'media',
        name: 'Media Wall',
        footprint: { x: -0.1, z: -2, width: 3.2, depth: 0.5 },
      },
    ],
  };
}

/** Placed items referencing real catalog products, mixing sources, locks, and rotations. */
function makeItems(): PlacedFurniture[] {
  return [
    {
      instanceId: 'existing-sofa',
      productId: 'fjord-3-seat-sofa',
      position: { x: 0, y: 0, z: 0.7 },
      rotation: 180,
      locked: true,
      source: 'existing',
    },
    {
      instanceId: 'existing-rug',
      productId: 'cloud-wool-rug',
      position: { x: 0, y: 0, z: 0.2 },
      rotation: 90,
      locked: true,
      source: 'existing',
    },
    {
      instanceId: 'rescue-coffee-table',
      productId: 'budget-rescue-table-premium',
      position: { x: 0.25, y: 0, z: -0.45 },
      rotation: 0,
      locked: false,
      source: 'marketplace',
    },
    {
      instanceId: 'rescue-floor-lamp',
      productId: 'budget-rescue-lamp-premium',
      position: { x: 1.75, y: 0.4, z: -1.5 },
      rotation: 270,
      locked: true,
      source: 'marketplace',
    },
  ];
}

function expectSuccess<T>(result: SerializableResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected a structured success');
  return result.data;
}

function expectRejected<T>(
  result: SerializableResult<T>,
): Extract<SerializableResult<T>, { ok: false }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a structured failure');
  return result;
}

describe('createDesignSnapshot + loadDesignSnapshot', () => {
  it('restores furniture, budget, room, and meta faithfully', () => {
    const room = makeRoom();
    const items = makeItems();
    const snapshot = expectSuccess(createDesignSnapshot(room, items, 1250.5, META));

    expect(snapshot.id).toBe(META.id);
    expect(snapshot.name).toBe(META.name);
    expect(snapshot.createdAt).toBe(META.createdAt);
    expect(snapshot.updatedAt).toBe(META.updatedAt);
    expect(snapshot.thumbnailGradient).toBe(META.thumbnailGradient);
    expect(snapshot.budget).toBe(1250.5);

    const restored = expectSuccess(loadDesignSnapshot(snapshot));
    expect(restored.budget).toBe(1250.5);
    expect(restored.room).toEqual(room);
    expect(restored.items).toEqual(items);
    for (let i = 0; i < items.length; i++) {
      expect(restored.items[i].instanceId).toBe(items[i].instanceId);
      expect(restored.items[i].productId).toBe(items[i].productId);
      expect(restored.items[i].position).toEqual(items[i].position);
      expect(restored.items[i].rotation).toBe(items[i].rotation);
      expect(restored.items[i].locked).toBe(items[i].locked);
      expect(restored.items[i].source).toBe(items[i].source);
    }
  });

  it('keeps the snapshot isolated from the live design it was saved from', () => {
    const room = makeRoom();
    const items = makeItems();
    const snapshot = expectSuccess(createDesignSnapshot(room, items, 1250.5, META));

    // Mutate every mutable layer of the live design after saving.
    room.dimensions.width = 99;
    room.openings[0].height = 99;
    room.placementZones[0].footprint.x = 99;
    items[0].position.x = 99;
    items[0].rotation = 45;
    items[0].locked = false;
    items[1].source = 'marketplace';

    const restored = expectSuccess(loadDesignSnapshot(snapshot));
    expect(restored.room).toEqual(makeRoom());
    expect(restored.items).toEqual(makeItems());
    expect(restored.budget).toBe(1250.5);
  });

  it('keeps the snapshot isolated from the restored design', () => {
    const snapshot = expectSuccess(createDesignSnapshot(makeRoom(), makeItems(), 1250.5, META));
    const first = expectSuccess(loadDesignSnapshot(snapshot));

    // Mutating the restored state must not leak back into the snapshot.
    first.room.dimensions.depth = 99;
    first.room.openings[0].footprint.z = 99;
    first.items[0].position.z = 99;
    first.items[0].locked = false;
    first.budget = 1;

    const again = expectSuccess(loadDesignSnapshot(snapshot));
    expect(again.room).toEqual(makeRoom());
    expect(again.items).toEqual(makeItems());
    expect(again.budget).toBe(1250.5);
  });

  it('never shares mutable references with the caller', () => {
    const room = makeRoom();
    const items = makeItems();
    const snapshot = expectSuccess(createDesignSnapshot(room, items, 1250.5, META));

    expect(snapshot.room).not.toBe(room);
    expect(snapshot.items).not.toBe(items);
    expect(snapshot.room.openings[0]).not.toBe(room.openings[0]);
    expect(snapshot.room.placementZones[0]).not.toBe(room.placementZones[0]);
    expect(snapshot.room.placementZones[0].allowedCategories).not.toBe(
      room.placementZones[0].allowedCategories,
    );
    expect(snapshot.items[0]).not.toBe(items[0]);
    expect(snapshot.items[0].position).not.toBe(items[0].position);

    const restored = expectSuccess(loadDesignSnapshot(snapshot));
    expect(restored.room).not.toBe(snapshot.room);
    expect(restored.items).not.toBe(snapshot.items);
    expect(restored.items[0]).not.toBe(snapshot.items[0]);
    expect(restored.items[0].position).not.toBe(snapshot.items[0].position);
  });

  it('restores the seeded demo design with real catalog products', () => {
    const restored = expectSuccess(loadDesignSnapshot(DEFAULT_DEMO_SNAPSHOT));
    expect(restored.budget).toBe(DEMO_BUDGET);
    expect(restored.room).toEqual(DEFAULT_DEMO_SNAPSHOT.room);
    expect(restored.items).toEqual(DEFAULT_ROOM_ITEMS);
    expect(restored.items.map((item) => item.locked)).toEqual([true, true, false]);
    expect(restored.items.map((item) => item.source)).toEqual([
      'existing',
      'existing',
      'existing',
    ]);
  });

  it('rejects duplicate instance ids when saving', () => {
    const items = makeItems();
    items.push({ ...items[0] });
    const error = expectRejected(createDesignSnapshot(makeRoom(), items, 1250.5, META));
    expect(error.code).toBe('duplicate_instance_ids');
    expect(error.details).toEqual({ instanceIds: ['existing-sofa'] });
  });

  it('rejects a non-finite budget when saving', () => {
    const error = expectRejected(createDesignSnapshot(makeRoom(), makeItems(), Number.NaN, META));
    expect(error.code).toBe('invalid_budget');
    expect(error.details).toEqual({ budget: Number.NaN });
  });

  it('rejects malformed snapshots when restoring', () => {
    const valid = expectSuccess(createDesignSnapshot(makeRoom(), makeItems(), 1250.5, META));

    const badBudget = expectRejected(loadDesignSnapshot({ ...valid, budget: Number.NaN }));
    expect(badBudget.code).toBe('invalid_snapshot');

    const badRotation = expectRejected(
      loadDesignSnapshot({ ...valid, items: [{ ...valid.items[0], rotation: Number.NaN }] }),
    );
    expect(badRotation.code).toBe('invalid_snapshot');

    const badSource = expectRejected(
      loadDesignSnapshot({
        ...valid,
        items: [{ ...valid.items[0], source: 'rented' as PlacedFurniture['source'] }],
      }),
    );
    expect(badSource.code).toBe('invalid_snapshot');

    const missingItems = expectRejected(
      loadDesignSnapshot({
        ...valid,
        items: undefined as unknown as readonly PlacedFurniture[],
      }),
    );
    expect(missingItems.code).toBe('invalid_snapshot');
  });

  it('rejects duplicate instance ids when restoring', () => {
    const valid = expectSuccess(createDesignSnapshot(makeRoom(), makeItems(), 1250.5, META));
    const error = expectRejected(
      loadDesignSnapshot({ ...valid, items: [valid.items[0], { ...valid.items[0] }] }),
    );
    expect(error.code).toBe('duplicate_instance_ids');
    expect(error.details).toEqual({ instanceIds: ['existing-sofa'] });
  });
});
