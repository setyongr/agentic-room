import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM } from '@/data/demoRoom';
import {
  moveProduct,
  placeProduct,
  removeProduct,
  replaceProduct,
  rotateProduct,
  setItemElevation,
  setItemLocked,
  setItemSource,
} from '@/domain/placement';
import type { PlacedFurniture } from '@/domain/types';

/**
 * Fresh, isolated fixture per call: a locked existing sofa and an unlocked
 * marketplace lamp, both real catalog products.
 */
function buildItems(): readonly PlacedFurniture[] {
  return [
    {
      instanceId: 'locked-sofa',
      productId: 'fjord-3-seat-sofa',
      position: { x: 0, y: 0, z: 0.7 },
      rotation: 180,
      locked: true,
      source: 'existing',
      variant: { color: 'linen', material: 'linen' },
    },
    {
      instanceId: 'market-lamp',
      productId: 'budget-rescue-lamp-premium',
      position: { x: 1.75, y: 0, z: -1.5 },
      rotation: 0,
      locked: false,
      source: 'marketplace',
      variant: { color: 'cream', material: 'brass' },
    },
  ];
}

describe('removeProduct', () => {
  it('rejects removal of a locked item with the stable item_locked code', () => {
    const items = buildItems();
    const result = removeProduct('locked-sofa', items);
    if (result.ok) throw new Error('expected locked removal to fail');
    expect(result.code).toBe('item_locked');
    expect(result.details?.instanceId).toBe('locked-sofa');
    expect(result.message).toContain('locked-sofa');
  });

  it('leaves the caller-owned input untouched when removal is rejected', () => {
    const items = buildItems();
    const [sofa, lamp] = items;
    const result = removeProduct('locked-sofa', items);
    if (result.ok) throw new Error('expected locked removal to fail');
    expect(items).toHaveLength(2);
    expect(items[0]).toBe(sofa);
    expect(items[1]).toBe(lamp);
  });

  it('removes an unlocked item without mutating the caller-owned input', () => {
    const items = buildItems();
    const [sofa, lamp] = items;
    const result = removeProduct('market-lamp', items);
    if (!result.ok) throw new Error(`expected removal to succeed, got ${result.code}`);
    expect(result.data.item.instanceId).toBe('market-lamp');
    expect(result.data.items.map((item) => item.instanceId)).toEqual(['locked-sofa']);
    expect(items).toHaveLength(2);
    expect(items[0]).toBe(sofa);
    expect(items[1]).toBe(lamp);
  });
});

describe('locked items', () => {
  it('reject replacement with the stable item_locked code', () => {
    const items = buildItems();
    const result = replaceProduct('locked-sofa', items, 'gable-2-seat-sofa');
    if (result.ok) throw new Error('expected locked replacement to fail');
    expect(result.code).toBe('item_locked');
    expect(result.details?.instanceId).toBe('locked-sofa');
    expect(items).toHaveLength(2);
    expect(items[0].locked).toBe(true);
  });

  it('remain movable', () => {
    const items = buildItems();
    const result = moveProduct('locked-sofa', items, 1.5, -2);
    if (!result.ok) throw new Error(`expected move to succeed, got ${result.code}`);
    const { item } = result.data;
    expect(item.instanceId).toBe('locked-sofa');
    expect(item.productId).toBe('fjord-3-seat-sofa');
    expect(item.position).toEqual({ x: 1.5, y: 0, z: -2 });
    expect(item.rotation).toBe(180);
    expect(item.locked).toBe(true);
    expect(item.source).toBe('existing');
  });

  it('remain rotatable with normalized rotation', () => {
    const items = buildItems();
    const result = rotateProduct('locked-sofa', items, 450);
    if (!result.ok) throw new Error(`expected rotate to succeed, got ${result.code}`);
    const { item } = result.data;
    expect(item.instanceId).toBe('locked-sofa');
    expect(item.productId).toBe('fjord-3-seat-sofa');
    expect(item.position).toEqual({ x: 0, y: 0, z: 0.7 });
    expect(item.rotation).toBe(90);
    expect(item.locked).toBe(true);
    expect(item.source).toBe('existing');
  });
});

describe('placeProduct variants', () => {
  it('resolves the catalog default variant when none is requested', () => {
    const result = placeProduct('budget-rescue-lamp-premium', DEFAULT_ROOM, [], { x: 0, z: 0 });
    if (!result.ok) throw new Error(`expected placement to succeed: ${result.code}`);
    expect(result.data.item.variant).toEqual({ color: 'cream', material: 'brass' });
  });

  it('stores an authored color and material pair', () => {
    const items: readonly PlacedFurniture[] = [];
    const result = placeProduct('budget-rescue-lamp-premium', DEFAULT_ROOM, items, {
      x: 0,
      z: 0,
      variant: { color: 'honey', material: 'brass' },
    });
    if (!result.ok) throw new Error(`expected placement to succeed: ${result.code}`);
    expect(result.data.item.variant).toEqual({ color: 'honey', material: 'brass' });
    expect(items).toHaveLength(0); // caller-owned input untouched
  });

  it('rejects an unavailable color with invalid_variant and available details', () => {
    const items = buildItems();
    const result = placeProduct('budget-rescue-lamp-premium', DEFAULT_ROOM, items, {
      x: 0,
      z: 0,
      variant: { color: 'lime', material: 'brass' },
    });
    if (result.ok) throw new Error('expected invalid color to fail');
    expect(result.code).toBe('invalid_variant');
    expect(result.details?.productId).toBe('budget-rescue-lamp-premium');
    expect(result.details?.availableColors).toEqual(['cream', 'honey']);
    expect(result.details?.availableMaterials).toEqual(['brass']);
    expect(items).toHaveLength(2); // unchanged
  });

  it('rejects a mismatched material with invalid_variant', () => {
    const result = placeProduct('budget-rescue-lamp-premium', DEFAULT_ROOM, [], {
      x: 0,
      z: 0,
      variant: { color: 'cream', material: 'plastic' },
    });
    if (result.ok) throw new Error('expected mismatched material to fail');
    expect(result.code).toBe('invalid_variant');
    expect(result.details?.availableMaterials).toEqual(['brass']);
  });
});

describe('variant preservation', () => {
  it('preserves the variant across move, rotate, and lock changes', () => {
    const items = buildItems();
    const expected = { color: 'cream', material: 'brass' };

    const moved = moveProduct('market-lamp', items, 2, 2);
    if (!moved.ok) throw new Error('expected move to succeed');
    expect(moved.data.item.variant).toEqual(expected);

    const rotated = rotateProduct('market-lamp', items, 90);
    if (!rotated.ok) throw new Error('expected rotation to succeed');
    expect(rotated.data.item.variant).toEqual(expected);

    const locked = setItemLocked('market-lamp', items, true);
    if (!locked.ok) throw new Error('expected lock to succeed');
    expect(locked.data.item.variant).toEqual(expected);
    expect(items.map((item) => item.variant)).toEqual([
      { color: 'linen', material: 'linen' },
      { color: 'cream', material: 'brass' },
    ]);
  });

  it('keeps the color when the replacement offers it, with the replacement material', () => {
    const items = buildItems();
    const result = replaceProduct('market-lamp', items, 'budget-rescue-lamp-value');
    if (!result.ok) throw new Error(`expected replacement to succeed: ${result.code}`);
    expect(result.data.item.productId).toBe('budget-rescue-lamp-value');
    expect(result.data.item.variant).toEqual({ color: 'cream', material: 'steel' });
  });

  it('resets to the replacement first color when the old color is unavailable', () => {
    const items = buildItems();
    const result = replaceProduct('market-lamp', items, 'arc-dome-floor-lamp');
    if (!result.ok) throw new Error(`expected replacement to succeed: ${result.code}`);
    expect(result.data.item.productId).toBe('arc-dome-floor-lamp');
    expect(result.data.item.variant).toEqual({ color: 'mustard', material: 'steel' });
  });
});


describe('setItemSource', () => {
  it('re-tags an existing item as a marketplace purchase', () => {
    const items = buildItems();
    const result = setItemSource('locked-sofa', items, 'marketplace');
    if (!result.ok) throw new Error(`expected re-tag to succeed: ${result.code}`);
    expect(result.data.item.source).toBe('marketplace');
    expect(result.data.item.instanceId).toBe('locked-sofa');
    expect(result.data.item.locked).toBe(true); // lock is not ownership
    // The caller's array is never mutated.
    expect(items[0].source).toBe('existing');
  });

  it('re-tags a marketplace item as already owned', () => {
    const items = buildItems();
    const result = setItemSource('market-lamp', items, 'existing');
    if (!result.ok) throw new Error(`expected re-tag to succeed: ${result.code}`);
    expect(result.data.item.source).toBe('existing');
  });

  it('preserves position, rotation, and variant when re-tagging', () => {
    const items = buildItems();
    const result = setItemSource('market-lamp', items, 'existing');
    if (!result.ok) throw new Error(`expected re-tag to succeed: ${result.code}`);
    expect(result.data.item.position).toEqual({ x: 1.75, y: 0, z: -1.5 });
    expect(result.data.item.rotation).toBe(0);
    expect(result.data.item.variant).toEqual({ color: 'cream', material: 'brass' });
  });

  it('is a no-op success when the source is unchanged', () => {
    const items = buildItems();
    const result = setItemSource('locked-sofa', items, 'existing');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.data.items).toBe(items); // same reference: nothing changed
  });

  it('fails with item_not_found for an unknown instance and leaves state intact', () => {
    const items = buildItems();
    const result = setItemSource('ghost-item', items, 'marketplace');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('item_not_found');
    expect(items.map((item) => item.source)).toEqual(['existing', 'marketplace']);
  });
});


describe('setItemElevation', () => {
  it('raises an item above the floor and preserves every other field', () => {
    const items = buildItems();
    const result = setItemElevation('market-lamp', items, 1.2);
    if (!result.ok) throw new Error(`expected elevation to succeed: ${result.code}`);
    expect(result.data.item.position.y).toBe(1.2);
    expect(result.data.item.position.x).toBe(1.75);
    expect(result.data.item.position.z).toBe(-1.5);
    expect(result.data.item.rotation).toBe(0);
    expect(result.data.item.variant).toEqual({ color: 'cream', material: 'brass' });
    expect(result.data.item.source).toBe('marketplace');
    // Caller array untouched.
    expect(items[1].position.y).toBe(0);
  });

  it('allows raising locked items', () => {
    const items = buildItems();
    const result = setItemElevation('locked-sofa', items, 0.4);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.data.item.locked).toBe(true);
  });

  it('is a no-op success when the height is unchanged', () => {
    const items = buildItems();
    const result = setItemElevation('market-lamp', items, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.data.items).toBe(items);
  });

  it('rejects negative and non-finite heights with invalid_elevation', () => {
    const items = buildItems();
    for (const y of [-0.1, Number.NaN, Infinity]) {
      const result = setItemElevation('market-lamp', items, y);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.code).toBe('invalid_elevation');
    }
    expect(items[1].position.y).toBe(0);
  });

  it('fails with item_not_found for unknown instances', () => {
    const result = setItemElevation('ghost-item', buildItems(), 1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.code).toBe('item_not_found');
  });
});

describe('moveProduct preserves elevation', () => {
  it('keeps the raised height when sliding an item', () => {
    const items = buildItems();
    const raised = setItemElevation('market-lamp', items, 1.3);
    if (!raised.ok) throw new Error('expected elevation to succeed');
    const moved = moveProduct('market-lamp', raised.data.items, 2, 2);
    if (!moved.ok) throw new Error('expected move to succeed');
    expect(moved.data.item.position).toEqual({ x: 2, y: 1.3, z: 2 });
  });
});
