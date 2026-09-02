/**
 * Shopping cart — marketplace-only line management tests.
 *
 * Covers the pure domain contract of `addToCart` against a mixed room
 * (pre-existing sofa/rug plus marketplace additions) built from real
 * catalog products: only marketplace-sourced items can be added, existing
 * items are rejected with the cart left untouched, requests are
 * all-or-nothing, line ids stay unique, and the subtotal always equals the
 * catalog prices of the added instances.
 */

import { describe, expect, it } from 'vitest';
import { addToCart } from './cart';
import { BUDGET_RESCUE_ITEMS, DEFAULT_ROOM_ITEMS } from '@/data/demoRoom';
import { getProduct } from '@/data/products';
import type { AddToCartMeta } from './cart';
import type { Cart, PlacedFurniture, SerializableResult } from './types';

const BASE_CART: Cart = {
  id: 'cart-test-1',
  status: 'active',
  items: [],
  total: 0,
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const FIRST_ADD_AT = '2026-09-02T10:00:00.000Z';
const SECOND_ADD_AT = '2026-09-02T11:00:00.000Z';

function makeMeta(timestamp = FIRST_ADD_AT): AddToCartMeta {
  return {
    timestamp,
    makeLineId: (instanceId) => `line-${instanceId}`,
  };
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

describe('addToCart', () => {
  it('adds only marketplace items from a mixed room and totals their catalog prices', () => {
    const requested = [
      'rescue-coffee-table',
      'rescue-floor-lamp',
      'rescue-accent-chair',
      'rescue-shelf',
    ];
    const cart = expectSuccess(addToCart(BASE_CART, requested, BUDGET_RESCUE_ITEMS, makeMeta()));

    expect(cart.id).toBe(BASE_CART.id);
    expect(cart.status).toBe('active');
    expect(cart.items).toHaveLength(4);

    let expectedTotal = 0;
    cart.items.forEach((line, index) => {
      const placed = BUDGET_RESCUE_ITEMS.find((item) => item.instanceId === requested[index]);
      expect(placed).toBeDefined();
      const product = getProduct(placed!.productId);
      expect(product).toBeDefined();
      expect(line.id).toBe(`line-${placed!.instanceId}`);
      expect(line.instanceId).toBe(placed!.instanceId);
      expect(line.productId).toBe(placed!.productId);
      expect(line.quantity).toBe(1);
      expect(line.unitPrice).toBe(product!.price);
      expect(line.addedAt).toBe(FIRST_ADD_AT);
      expectedTotal += product!.price;
    });

    expect(cart.total).toBe(expectedTotal);
    expect(cart.updatedAt).toBe(FIRST_ADD_AT);
  });

  it('rejects the existing sofa and rug, leaving the cart untouched', () => {
    const cart = BASE_CART;
    const error = expectRejected(
      addToCart(cart, ['existing-sofa', 'existing-rug'], DEFAULT_ROOM_ITEMS, makeMeta()),
    );
    expect(error.code).toBe('cart_add_rejected');
    expect(error.details?.rejected).toEqual([
      { instanceId: 'existing-sofa', productId: 'fjord-3-seat-sofa', reason: 'existing_item' },
      { instanceId: 'existing-rug', productId: 'cloud-wool-rug', reason: 'existing_item' },
    ]);
    expect(cart).toEqual(BASE_CART);
  });

  it('rejects the entire update when any requested instance cannot be added', () => {
    const error = expectRejected(
      addToCart(BASE_CART, ['rescue-coffee-table', 'existing-sofa'], BUDGET_RESCUE_ITEMS, makeMeta()),
    );
    expect(error.code).toBe('cart_add_rejected');
    expect(error.details?.rejected).toEqual([
      { instanceId: 'existing-sofa', productId: 'fjord-3-seat-sofa', reason: 'existing_item' },
    ]);
    // The valid marketplace item must not be added as part of a rejected update.
    expect(BASE_CART.items).toEqual([]);
    expect(BASE_CART.total).toBe(0);
  });

  it('collapses duplicate instance ids within one request', () => {
    const calls: string[] = [];
    const cart = expectSuccess(
      addToCart(
        BASE_CART,
        ['rescue-coffee-table', 'rescue-coffee-table', 'rescue-shelf'],
        BUDGET_RESCUE_ITEMS,
        {
          timestamp: FIRST_ADD_AT,
          makeLineId: (instanceId) => {
            calls.push(instanceId);
            return `line-${instanceId}`;
          },
        },
      ),
    );
    expect(cart.items.map((line) => line.instanceId)).toEqual([
      'rescue-coffee-table',
      'rescue-shelf',
    ]);
    // The id factory runs exactly once per added instance, in caller order.
    expect(calls).toEqual(['rescue-coffee-table', 'rescue-shelf']);
  });

  it('keeps line identifiers unique when adding multiple items across updates', () => {
    const first = expectSuccess(
      addToCart(BASE_CART, ['rescue-coffee-table', 'rescue-floor-lamp'], BUDGET_RESCUE_ITEMS, makeMeta()),
    );
    const second = expectSuccess(
      addToCart(first, ['rescue-shelf'], BUDGET_RESCUE_ITEMS, makeMeta(SECOND_ADD_AT)),
    );

    expect(second.items).toHaveLength(3);
    const ids = second.items.map((line) => line.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'line-rescue-coffee-table',
      'line-rescue-floor-lamp',
      'line-rescue-shelf',
    ]);

    const added = BUDGET_RESCUE_ITEMS.filter((item) =>
      ['rescue-coffee-table', 'rescue-floor-lamp', 'rescue-shelf'].includes(item.instanceId),
    );
    const expectedTotal = added.reduce((sum, item) => sum + getProduct(item.productId)!.price, 0);
    expect(second.total).toBe(expectedTotal);
    expect(second.updatedAt).toBe(SECOND_ADD_AT);
  });

  it('rejects an instance that is not among the placed items', () => {
    const error = expectRejected(
      addToCart(BASE_CART, ['ghost-instance'], BUDGET_RESCUE_ITEMS, makeMeta()),
    );
    expect(error.code).toBe('cart_add_rejected');
    expect(error.details?.rejected).toEqual([
      { instanceId: 'ghost-instance', reason: 'unknown_instance' },
    ]);
  });

  it('rejects an instance already present in the cart', () => {
    const cart = expectSuccess(
      addToCart(BASE_CART, ['rescue-shelf'], BUDGET_RESCUE_ITEMS, makeMeta()),
    );
    const error = expectRejected(
      addToCart(cart, ['rescue-shelf'], BUDGET_RESCUE_ITEMS, makeMeta(SECOND_ADD_AT)),
    );
    expect(error.code).toBe('cart_add_rejected');
    expect(error.details?.rejected).toEqual([
      {
        instanceId: 'rescue-shelf',
        productId: 'budget-rescue-shelf-premium',
        reason: 'duplicate_instance',
      },
    ]);
    expect(cart.items).toHaveLength(1);
    expect(cart.total).toBe(getProduct('budget-rescue-shelf-premium')!.price);
    expect(cart.updatedAt).toBe(FIRST_ADD_AT);
  });

  it('rejects a marketplace item whose product is absent from the catalog', () => {
    const ghostItem: PlacedFurniture = {
      instanceId: 'ghost-lamp',
      productId: 'no-such-product-in-catalog',
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      locked: false,
      source: 'marketplace',
      variant: { color: 'ghost', material: 'unknown' },
    };
    const error = expectRejected(addToCart(BASE_CART, ['ghost-lamp'], [ghostItem], makeMeta()));
    expect(error.code).toBe('cart_add_rejected');
    expect(error.details?.rejected).toEqual([
      {
        instanceId: 'ghost-lamp',
        productId: 'no-such-product-in-catalog',
        reason: 'missing_product',
      },
    ]);
  });
});
