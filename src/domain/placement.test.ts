import { describe, expect, it } from 'vitest';
import { moveProduct, removeProduct, replaceProduct, rotateProduct } from '@/domain/placement';
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
    },
    {
      instanceId: 'market-lamp',
      productId: 'budget-rescue-lamp-premium',
      position: { x: 1.75, y: 0, z: -1.5 },
      rotation: 0,
      locked: false,
      source: 'marketplace',
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
