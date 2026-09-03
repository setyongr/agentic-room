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
import { addToCart, checkoutCart, clearCart, removeCartItem } from './cart';
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


describe('removeCartItem', () => {
  /** Cart with the four Budget Rescue marketplace items, like the UI builds it. */
  function fullCart(): Cart {
    const requested = [
      'rescue-coffee-table',
      'rescue-floor-lamp',
      'rescue-accent-chair',
      'rescue-shelf',
    ];
    const result = addToCart(BASE_CART, requested, BUDGET_RESCUE_ITEMS, makeMeta());
    if (!result.ok) throw new Error(`fixture cart failed: ${result.message}`);
    return result.data;
  }

  it('removes one line and recalculates the total from the rest', () => {
    const cart = fullCart();
    const lampPrice = getProduct('budget-rescue-lamp-premium')?.price ?? 0;
    const result = removeCartItem(cart, 'rescue-floor-lamp', SECOND_ADD_AT);
    const updated = expectSuccess(result);

    expect(updated.items).toHaveLength(3);
    expect(updated.items.map((line) => line.instanceId)).toEqual([
      'rescue-coffee-table',
      'rescue-accent-chair',
      'rescue-shelf',
    ]);
    // Ids and captured prices of the survivors are untouched.
    expect(updated.items[0].id).toBe('line-rescue-coffee-table');
    expect(updated.items[0].unitPrice).toBe(getProduct('budget-rescue-table-premium')!.price);
    expect(updated.total).toBe(cart.total - lampPrice);
    expect(updated.updatedAt).toBe(SECOND_ADD_AT);
    // The input cart is not mutated.
    expect(cart.items).toHaveLength(4);
  });

  it('supports removing lines until the cart is empty', () => {
    let cart = fullCart();
    for (const instanceId of ['rescue-coffee-table', 'rescue-floor-lamp', 'rescue-accent-chair', 'rescue-shelf']) {
      const result = removeCartItem(cart, instanceId, SECOND_ADD_AT);
      cart = expectSuccess(result);
    }
    expect(cart.items).toEqual([]);
    expect(cart.total).toBe(0);
  });

  it('fails with cart_item_not_found for unknown instances, leaving the cart untouched', () => {
    const cart = fullCart();
    const error = expectRejected(removeCartItem(cart, 'ghost-instance', SECOND_ADD_AT));
    expect(error.code).toBe('cart_item_not_found');
    expect(error.details?.instanceId).toBe('ghost-instance');
    expect(cart.items).toHaveLength(4);
  });

  it('rejects changes to a checked-out cart', () => {
    const cart = fullCart();
    const checkedOut: Cart = { ...cart, status: 'checked_out' };
    const error = expectRejected(removeCartItem(checkedOut, 'rescue-shelf', SECOND_ADD_AT));
    expect(error.code).toBe('cart_checked_out');
  });

  it('never mutates the caller cart', () => {
    const cart = fullCart();
    const snapshot = JSON.parse(JSON.stringify(cart)) as Cart;
    removeCartItem(cart, 'rescue-shelf', SECOND_ADD_AT);
    expect(cart).toEqual(snapshot);
  });
});


describe('checkoutCart', () => {
  /** Cart with the four Budget Rescue marketplace items. */
  function fullCart(): Cart {
    const requested = [
      'rescue-coffee-table',
      'rescue-floor-lamp',
      'rescue-accent-chair',
      'rescue-shelf',
    ];
    const result = addToCart(BASE_CART, requested, BUDGET_RESCUE_ITEMS, makeMeta());
    if (!result.ok) throw new Error(`fixture cart failed: ${result.message}`);
    return result.data;
  }

  it('marks the cart checked out and returns a deterministic order summary', () => {
    const cart = fullCart();
    const order = expectSuccess(
      checkoutCart(cart, { orderId: 'order-7', timestamp: SECOND_ADD_AT }),
    );
    expect(order.orderId).toBe('order-7');
    expect(order.total).toBe(cart.total);
    expect(order.completedAt).toBe(SECOND_ADD_AT);
    expect(order.cart.status).toBe('checked_out');
    expect(order.cart.items).toHaveLength(4); // lines kept for reference
    expect(order.cart.updatedAt).toBe(SECOND_ADD_AT);
    // The input cart is untouched.
    expect(cart.status).toBe('active');
  });

  it('rejects checking out an empty cart with cart_empty', () => {
    const error = expectRejected(
      checkoutCart(BASE_CART, { orderId: 'order-1', timestamp: SECOND_ADD_AT }),
    );
    expect(error.code).toBe('cart_empty');
  });

  it('rejects a second checkout with cart_checked_out', () => {
    const cart = fullCart();
    const first = expectSuccess(
      checkoutCart(cart, { orderId: 'order-1', timestamp: SECOND_ADD_AT }),
    );
    const error = expectRejected(
      checkoutCart(first.cart, { orderId: 'order-2', timestamp: SECOND_ADD_AT }),
    );
    expect(error.code).toBe('cart_checked_out');
  });
});

describe('clearCart', () => {
  it('restarts a checked-out cart as empty and active', () => {
    const cart = (() => { const r = addToCart(BASE_CART, ['rescue-coffee-table', 'rescue-floor-lamp', 'rescue-accent-chair', 'rescue-shelf'], BUDGET_RESCUE_ITEMS, makeMeta()); if (!r.ok) throw new Error(r.message); return r.data; })();
    const first = expectSuccess(
      checkoutCart(cart, { orderId: 'order-3', timestamp: SECOND_ADD_AT }),
    );
    const fresh = expectSuccess(clearCart(first.cart, '2026-09-02T12:00:00.000Z'));
    expect(fresh.status).toBe('active');
    expect(fresh.items).toEqual([]);
    expect(fresh.total).toBe(0);
    expect(fresh.updatedAt).toBe('2026-09-02T12:00:00.000Z');
  });

  it('works from an active cart too and never mutates the input', () => {
    const cart = (() => { const r = addToCart(BASE_CART, ['rescue-coffee-table', 'rescue-floor-lamp', 'rescue-accent-chair', 'rescue-shelf'], BUDGET_RESCUE_ITEMS, makeMeta()); if (!r.ok) throw new Error(r.message); return r.data; })();
    const snapshot = JSON.parse(JSON.stringify(cart)) as Cart;
    const fresh = expectSuccess(clearCart(cart, '2026-09-02T12:00:00.000Z'));
    expect(fresh.items).toEqual([]);
    expect(cart).toEqual(snapshot);
  });

  it('resets an already-empty cart harmlessly', () => {
    const fresh = expectSuccess(clearCart(BASE_CART, '2026-09-02T12:00:00.000Z'));
    expect(fresh.status).toBe('active');
    expect(fresh.items).toEqual([]);
  });
});
