/**
 * Shopping cart — pure line management for the marketplace flow.
 *
 * Only marketplace-sourced placed items can be added; pre-existing room
 * furniture is never purchasable. Lines are deduplicated by placed
 * instance, prices are captured from the catalog at add time, and totals
 * are always recalculated from the line contents — never carried over.
 * Lines can be removed again (per placed instance) so a shopper can prune
 * the cart to exactly the handful of items they intend to buy; removing a
 * line never touches the placed furniture, and the instance can be added
 * back later while it remains a marketplace piece. Payment and checkout
 * are out of scope for this module.
 *
 * The caller supplies the update timestamp and a deterministic line-id
 * factory so tests, replay, and WebMCP tool calls stay fully deterministic.
 * Expected invalid input (unknown instance, existing item, duplicate
 * instance, missing product) fails as a structured error and leaves the
 * cart untouched.
 */

import type {
  Cart,
  CartItem,
  CheckoutResult,
  PlacedFurniture,
  SerializableResult,
} from './types';
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


/**
 * Remove the cart line for one placed instance.
 *
 * Only the cart changes: the placed furniture stays in the room, and the
 * instance can be added to the cart again later while it is still a
 * marketplace piece. The total is recalculated from the remaining lines.
 * Unknown instances fail with `cart_item_not_found`; checked-out carts
 * reject any change with `cart_checked_out`.
 */
export function removeCartItem(
  currentCart: Cart,
  instanceId: string,
  timestamp: string,
): SerializableResult<Cart> {
  if (currentCart.status === 'checked_out') {
    return {
      ok: false,
      code: 'cart_checked_out',
      message: 'Cannot remove items from a checked-out cart',
    };
  }
  const index = currentCart.items.findIndex((line) => line.instanceId === instanceId);
  if (index === -1) {
    return {
      ok: false,
      code: 'cart_item_not_found',
      message: `No cart line for placed instance "${instanceId}"`,
      details: { instanceId },
    };
  }
  const lines = currentCart.items.filter((line) => line.instanceId !== instanceId);
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
      updatedAt: timestamp,
    },
  };
}


/** Caller-provided identity and timestamp for one mock checkout. */
export interface CheckoutMeta {
  /** deterministic order id, e.g. "order-7" */
  orderId: string;
  /** ISO 8601 completion timestamp */
  timestamp: string;
}

/**
 * Complete a mock checkout for the cart.
 *
 * Marks the cart `checked_out` (keeps every line for reference; additions
 * and removals are refused afterwards until a new cart is started), and
 * returns the deterministic order summary. Checked-out carts fail with
 * `cart_checked_out`; empty carts fail with `cart_empty`. Payment is out
 * of scope — this is the mock boundary of the shopping story.
 */
export function checkoutCart(
  currentCart: Cart,
  meta: CheckoutMeta,
): SerializableResult<CheckoutResult> {
  if (currentCart.status === 'checked_out') {
    return {
      ok: false,
      code: 'cart_checked_out',
      message: 'This cart is already checked out; start a new cart to shop again',
    };
  }
  if (currentCart.items.length === 0) {
    return {
      ok: false,
      code: 'cart_empty',
      message: 'Add at least one item to the cart before checking out',
    };
  }
  return {
    ok: true,
    data: {
      orderId: meta.orderId,
      cart: { ...currentCart, status: 'checked_out', updatedAt: meta.timestamp },
      total: currentCart.total,
      completedAt: meta.timestamp,
    },
  };
}

/**
 * Start a fresh, empty, active cart (the restart after a mock checkout, or
 * a manual reset). Always succeeds and returns a new cart object; the
 * input cart is never mutated.
 */
export function clearCart(currentCart: Cart, timestamp: string): SerializableResult<Cart> {
  return {
    ok: true,
    data: {
      id: currentCart.id,
      status: 'active',
      items: [],
      total: 0,
      updatedAt: timestamp,
    },
  };
}
