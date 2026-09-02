/**
 * Shopping cart — pure line management for the marketplace flow.
 *
 * Only marketplace-sourced placed items can be added; pre-existing room
 * furniture is never purchasable. Lines are deduplicated by placed
 * instance, prices are captured from the catalog at add time, and totals
 * are always recalculated from the line contents — never carried over.
 * Payment and checkout are out of scope for this module.
 *
 * The caller supplies the update timestamp and a deterministic line-id
 * factory so tests, replay, and WebMCP tool calls stay fully deterministic.
 * Expected invalid input (unknown instance, existing item, duplicate
 * instance, missing product) fails as a structured error and leaves the
 * cart untouched.
 */

import type { Cart, CartItem, PlacedFurniture, SerializableResult } from './types';
import { getProduct } from '@/data/products';

/** Caller-provided identity and timestamp for one cart update. */
export interface AddToCartMeta {
  /** ISO 8601 timestamp stamped on new lines (`addedAt`) and the cart (`updatedAt`) */
  timestamp: string;
  /**
   * Deterministic cart-line id factory; called exactly once per added
   * instance, in caller order.
   */
  makeLineId: (instanceId: string) => string;
}

/** Why a requested instance could not be added to the cart. */
export type CartAddRejectionReason =
  | 'unknown_instance'
  | 'existing_item'
  | 'duplicate_instance'
  | 'missing_product';

/** One rejected instance, reported in `details.rejected` of the error. */
export type CartAddRejection = {
  instanceId: string;
  reason: CartAddRejectionReason;
  productId?: string;
};

interface PendingAdd {
  instanceId: string;
  productId: string;
  unitPrice: number;
}

/**
 * Add placed marketplace instances to the cart.
 *
 * All requested instances are validated before anything is added: any
 * unknown instance, existing-sourced item, instance already in the cart,
 * or product missing from the catalog rejects the whole update and leaves
 * `currentCart` untouched. Duplicate ids within one request are collapsed
 * (each instance appears at most once). On success a new cart is returned
 * with the total recalculated from every line.
 */
export function addToCart(
  currentCart: Cart,
  instanceIds: readonly string[],
  items: readonly PlacedFurniture[],
  meta: AddToCartMeta,
): SerializableResult<Cart> {
  if (currentCart.status === 'checked_out') {
    return {
      ok: false,
      code: 'cart_checked_out',
      message: 'Cannot add items to a checked-out cart',
    };
  }

  const itemById = new Map<string, PlacedFurniture>();
  for (const item of items) {
    itemById.set(item.instanceId, item);
  }
  const cartInstanceIds = new Set<string>();
  for (const line of currentCart.items) {
    if (line.instanceId !== undefined) {
      cartInstanceIds.add(line.instanceId);
    }
  }

  const requested = new Set<string>();
  const pending: PendingAdd[] = [];
  const rejected: CartAddRejection[] = [];

  for (const instanceId of instanceIds) {
    if (requested.has(instanceId)) {
      continue; // same instance listed twice in one request: add once
    }
    requested.add(instanceId);

    const item = itemById.get(instanceId);
    if (item === undefined) {
      rejected.push({ instanceId, reason: 'unknown_instance' });
      continue;
    }
    if (item.source !== 'marketplace') {
      rejected.push({ instanceId, productId: item.productId, reason: 'existing_item' });
      continue;
    }
    if (cartInstanceIds.has(instanceId)) {
      rejected.push({ instanceId, productId: item.productId, reason: 'duplicate_instance' });
      continue;
    }
    const product = getProduct(item.productId);
    if (product === undefined) {
      rejected.push({ instanceId, productId: item.productId, reason: 'missing_product' });
      continue;
    }
    pending.push({ instanceId, productId: item.productId, unitPrice: product.price });
  }

  if (rejected.length > 0) {
    return {
      ok: false,
      code: 'cart_add_rejected',
      message: `${rejected.length} of ${pending.length + rejected.length} requested item(s) could not be added to the cart`,
      details: { rejected },
    };
  }
  if (pending.length === 0) {
    return { ok: true, data: currentCart };
  }

  const newLines: CartItem[] = pending.map(({ instanceId, productId, unitPrice }) => ({
    id: meta.makeLineId(instanceId),
    productId,
    quantity: 1,
    unitPrice,
    addedAt: meta.timestamp,
    instanceId,
  }));
  const lines = [...currentCart.items, ...newLines];
  let rawTotal = 0;
  for (const line of lines) {
    rawTotal += line.unitPrice * line.quantity;
  }
  return {
    ok: true,
    data: {
      id: currentCart.id,
      status: currentCart.status,
      items: lines,
      total: Math.round(rawTotal * 100) / 100,
      updatedAt: meta.timestamp,
    },
  };
}
