/**
 * Placement domain — pure, deterministic operations for managing placed
 * furniture in a room.
 *
 * Conventions (shared with the catalog, seeds, and validation):
 * - Room coordinates are centered on x = 0, z = 0; x/z are the footprint
 *   center and y is the floor-base elevation (0 for items on the floor).
 * - Rotations are yaw degrees around the y axis, normalized to [0, 360).
 * - Zone placement positions an item at the zone footprint center, honors
 *   the zone's allowed categories and item limit, and requires the product's
 *   rotated footprint to fit entirely inside the zone.
 * - Explicit placement accepts arbitrary x/z and does not validate the
 *   resulting layout; bounds, overlap, and opening checks are performed
 *   separately by the validation layer.
 * - Locked items may be moved or rotated but cannot be removed or replaced.
 * - Every function is pure: inputs are never mutated and payloads are
 *   JSON-serializable.
 *
 * Stable error codes:
 *   missing_product / out_of_stock / zone_not_found / zone_mismatch /
 *   zone_full / does_not_fit / missing_position / conflicting_options /
 *   duplicate_instance_id / item_not_found / item_locked / category_mismatch
 *   / invalid_variant
 */

import { PRODUCTS } from '@/data/products';
import type {
  FurnitureCategory,
  FurnitureProduct,
  FurnitureSource,
  FurnitureVariant,
  PlacedFurniture,
  PlacementZone,
  RectFootprint,
  RoomData,
  SerializableError,
  SerializableResult,
  SerializableSuccess,
  SerializableValue,
  Vec3,
} from '@/domain/types';

/* ------------------------------------------------------------------ */
/* Catalog lookup                                                      */
/* ------------------------------------------------------------------ */

const PRODUCTS_BY_ID: Readonly<Record<string, FurnitureProduct>> = Object.fromEntries(
  PRODUCTS.map((p) => [p.id, p]),
);

/** Look up a catalog product by id. */
function findProduct(id: string): FurnitureProduct | undefined {
  return PRODUCTS_BY_ID[id];
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/** Normalize a yaw rotation to the canonical [0, 360) range. */
function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

/**
 * Axis-aligned footprint extents of `width` x `depth` (meters) rotated by
 * `rotation` degrees around y. Quarter turns are handled exactly so 90°
 * rotations never accumulate floating-point error.
 */
function rotatedExtents(
  width: number,
  depth: number,
  rotation: number,
): { width: number; depth: number } {
  const degrees = normalizeRotation(rotation);
  if (degrees % 90 === 0) {
    return (degrees / 90) % 2 === 0 ? { width, depth } : { width: depth, depth: width };
  }
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return { width: width * cos + depth * sin, depth: width * sin + depth * cos };
}

/** True when the point lies on or inside the footprint's edges. */
function pointInFootprint(x: number, z: number, footprint: RectFootprint): boolean {
  return (
    x >= footprint.x - footprint.width / 2 &&
    x <= footprint.x + footprint.width / 2 &&
    z >= footprint.z - footprint.depth / 2 &&
    z <= footprint.z + footprint.depth / 2
  );
}

/** Number of placed items whose center lies inside the zone footprint. */
function occupantCount(zone: PlacementZone, items: readonly PlacedFurniture[]): number {
  let count = 0;
  for (const item of items) {
    if (pointInFootprint(item.position.x, item.position.z, zone.footprint)) {
      count += 1;
    }
  }
  return count;
}

/** True when the zone permits the category (empty/absent list = any). */
function categoryAllowed(zone: PlacementZone, category: FurnitureCategory): boolean {
  const allowed = zone.allowedCategories;
  return allowed === undefined || allowed.length === 0 || allowed.includes(category);
}

/* ------------------------------------------------------------------ */
/* Result helpers                                                      */
/* ------------------------------------------------------------------ */

function ok<T>(data: T): SerializableSuccess<T> {
  return { ok: true, data };
}

function fail(
  code: string,
  message: string,
  details?: Readonly<Record<string, SerializableValue>>,
): SerializableError {
  return details === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, details };
}

/* ------------------------------------------------------------------ */
/* Zone placement                                                      */
/* ------------------------------------------------------------------ */

/** A product checked against a placement zone. */
interface ZonePlacementPlan {
  product: FurnitureProduct;
  zone: PlacementZone;
  /** yaw applied to the product, normalized to [0, 360) */
  rotation: number;
  /** rotated footprint centered on the zone center */
  footprint: RectFootprint;
}

/**
 * Validate a product against a zone without mutating anything. Checks run
 * in stable order: product existence, stock, zone existence, category
 * allowance, occupancy, then footprint fit.
 */
function zonePlacementPlan(
  productId: string,
  room: RoomData,
  zoneId: string,
  rotation: number,
  items: readonly PlacedFurniture[],
): SerializableResult<ZonePlacementPlan> {
  const product = findProduct(productId);
  if (product === undefined) {
    return fail('missing_product', `Product "${productId}" is not in the catalog.`, {
      productIds: [productId],
    });
  }
  if (product.stock <= 0) {
    return fail('out_of_stock', `"${product.name}" is out of stock and cannot be placed.`, {
      productId,
    });
  }
  const zone = room.placementZones.find((z) => z.id === zoneId);
  if (zone === undefined) {
    return fail('zone_not_found', `Placement zone "${zoneId}" does not exist in this room.`, {
      zoneId,
    });
  }
  if (!categoryAllowed(zone, product.category)) {
    return fail(
      'zone_mismatch',
      `Zone "${zone.name}" does not allow ${product.category} items.`,
      { zoneId, category: product.category },
    );
  }
  const occupied = occupantCount(zone, items);
  if (zone.maxItems !== undefined && occupied >= zone.maxItems) {
    return fail(
      'zone_full',
      `Zone "${zone.name}" is full (${occupied} of ${zone.maxItems} slots used).`,
      { zoneId, occupied, maxItems: zone.maxItems },
    );
  }
  const normalized = normalizeRotation(rotation);
  const extents = rotatedExtents(product.width, product.depth, normalized);
  if (extents.width > zone.footprint.width || extents.depth > zone.footprint.depth) {
    return fail(
      'does_not_fit',
      `"${product.name}" (${extents.width} x ${extents.depth} m at ${normalized}\u00b0) does not fit in zone "${zone.name}" (${zone.footprint.width} x ${zone.footprint.depth} m).`,
      {
        zoneId,
        productId,
        rotation: normalized,
        width: extents.width,
        depth: extents.depth,
      },
    );
  }
  return ok({
    product,
    zone,
    rotation: normalized,
    footprint: {
      x: zone.footprint.x,
      z: zone.footprint.z,
      width: extents.width,
      depth: extents.depth,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Public placement API                                                */
/* ------------------------------------------------------------------ */

/** A zone that can still receive items of a category. */
export interface AvailablePlacementZone {
  zone: PlacementZone;
  /** items whose center currently lies inside the zone footprint */
  occupied: number;
  /** remaining slots; null when the zone has no item limit */
  remaining: number | null;
}

/** Result payload of getAvailablePlacementZones. */
export interface AvailablePlacementZonesResult {
  zones: readonly AvailablePlacementZone[];
}

/**
 * Zones in the room that accept `category` and still have capacity, in room
 * order. A zone with an empty/absent allowedCategories list accepts any
 * category. Occupancy counts placed items whose center lies in the zone
 * footprint.
 */
export function getAvailablePlacementZones(
  category: FurnitureCategory,
  room: RoomData,
  items: readonly PlacedFurniture[],
): SerializableResult<AvailablePlacementZonesResult> {
  const zones: AvailablePlacementZone[] = [];
  for (const zone of room.placementZones) {
    if (!categoryAllowed(zone, category)) continue;
    const occupied = occupantCount(zone, items);
    const remaining = zone.maxItems === undefined ? null : zone.maxItems - occupied;
    if (remaining !== null && remaining <= 0) continue;
    zones.push({ zone, occupied, remaining });
  }
  return ok({ zones });
}

/** Options for the fitProductInZone preview. */
export interface FitProductInZoneOptions {
  /** yaw to apply; defaults to the product's defaultRotation (0 if absent) */
  rotation?: number;
  /** current items, used to account for zone occupancy; defaults to none */
  items?: readonly PlacedFurniture[];
}

/** Result payload of fitProductInZone. */
export interface FitProductInZoneResult {
  productId: string;
  zoneId: string;
  /** yaw the product would be placed at */
  rotation: number;
  /** rotated footprint centered on the zone center */
  footprint: RectFootprint;
  /** items whose center currently lies inside the zone footprint */
  occupied: number;
  /** total slot capacity; null when the zone has no limit */
  capacity: number | null;
}

/**
 * Preview whether a product can be placed in a zone: product existence,
 * stock, category allowance, occupancy, and footprint fit with the given
 * rotation. Never mutates state.
 */
export function fitProductInZone(
  productId: string,
  room: RoomData,
  zoneId: string,
  options: FitProductInZoneOptions = {},
): SerializableResult<FitProductInZoneResult> {
  const product = findProduct(productId);
  if (product === undefined) {
    return fail('missing_product', `Product "${productId}" is not in the catalog.`, {
      productIds: [productId],
    });
  }
  const rotation = options.rotation ?? product.defaultRotation ?? 0;
  const items = options.items ?? [];
  const plan = zonePlacementPlan(productId, room, zoneId, rotation, items);
  if (!plan.ok) return plan;
  const zone = plan.data.zone;
  return ok({
    productId,
    zoneId,
    rotation: plan.data.rotation,
    footprint: plan.data.footprint,
    occupied: occupantCount(zone, items),
    capacity: zone.maxItems ?? null,
  });
}

/** Options for placeProduct. */
export interface PlaceProductOptions {
  /** place into this zone at its center; mutually exclusive with x/z */
  zoneId?: string;
  /** explicit center x in room coordinates; mutually exclusive with zoneId */
  x?: number;
  /** explicit center z in room coordinates; mutually exclusive with zoneId */
  z?: number;
  /** yaw in degrees; defaults to the product's defaultRotation (0 if absent) */
  rotation?: number;
  /** instance id; generated deterministically when omitted */
  instanceId?: string;
  /** provenance of the new item; defaults to "marketplace" */
  source?: FurnitureSource;
  /**
   * Chosen visual finish. Omitted fields resolve to the product's first
   * color and authored material; an invalid color/material fails with
   * `invalid_variant` before anything is placed.
   */
  variant?: Partial<FurnitureVariant>;
}

/** Result payload of placement mutations: the new items and the affected item. */
export interface PlacementMutationResult {
  items: readonly PlacedFurniture[];
  item: PlacedFurniture;
}

/**
 * Add a product to the room. Zone placement (`zoneId`) checks category
 * allowance, occupancy, and footprint fit, then centers the item in the
 * zone; explicit placement (`x`/`z`) is unvalidated beyond product
 * existence and stock. The item's y is its floor-base elevation (0), so it
 * rests on the floor.
 */
export function placeProduct(
  productId: string,
  room: RoomData,
  items: readonly PlacedFurniture[],
  options: PlaceProductOptions = {},
): SerializableResult<PlacementMutationResult> {
  const { zoneId, x, z, rotation, instanceId, source, variant } = options;
  const hasZone = zoneId !== undefined;
  const hasPosition = x !== undefined || z !== undefined;
  if (hasZone && hasPosition) {
    return fail('conflicting_options', 'Specify either a zoneId or explicit x/z coordinates, not both.');
  }
  const product = findProduct(productId);
  if (product === undefined) {
    return fail('missing_product', `Product "${productId}" is not in the catalog.`, {
      productIds: [productId],
    });
  }
  if (product.stock <= 0) {
    return fail('out_of_stock', `"${product.name}" is out of stock and cannot be placed.`, {
      productId,
    });
  }
  const variantColor = variant?.color ?? product.colors[0];
  const variantMaterial = variant?.material ?? product.material;
  const requestedVariant: Record<string, string> = {
    ...(variant?.color !== undefined ? { color: variant.color } : {}),
    ...(variant?.material !== undefined ? { material: variant.material } : {}),
  };
  if (variantColor === undefined || !product.colors.includes(variantColor)) {
    return fail('invalid_variant', `"${variantColor ?? ''}" is not an available color for "${product.name}".`, {
      productId,
      requestedVariant,
      availableColors: product.colors,
      availableMaterials: [product.material],
    });
  }
  if (variantMaterial !== product.material) {
    return fail('invalid_variant', `"${variantMaterial}" is not the material of "${product.name}".`, {
      productId,
      requestedVariant,
      availableColors: product.colors,
      availableMaterials: [product.material],
    });
  }
  const yaw = normalizeRotation(rotation ?? product.defaultRotation ?? 0);
  let position: Vec3;
  if (hasZone) {
    const plan = zonePlacementPlan(productId, room, zoneId, yaw, items);
    if (!plan.ok) return plan;
    position = {
      x: plan.data.zone.footprint.x,
      y: 0,
      z: plan.data.zone.footprint.z,
    };
  } else {
    if (x === undefined || z === undefined) {
      return fail('missing_position', 'Explicit placement requires both x and z coordinates.');
    }
    position = { x, y: 0, z };
  }
  const newInstanceId = instanceId ?? nextInstanceId(items, productId);
  if (items.some((item) => item.instanceId === newInstanceId)) {
    return fail(
      'duplicate_instance_id',
      `An item with instance id "${newInstanceId}" already exists.`,
      { instanceId: newInstanceId },
    );
  }
  const item: PlacedFurniture = {
    instanceId: newInstanceId,
    productId,
    position,
    rotation: yaw,
    locked: false,
    source: source ?? 'marketplace',
    variant: { color: variantColor, material: variantMaterial },
  };
  const updated = items.slice();
  updated.push(item);
  return ok({ items: updated, item });
}

/**
 * Deterministic, collision-free instance id for a new placement of
 * `productId`: `${productId}-<n>` where n is one past the largest existing
 * numeric suffix for that product.
 */
export function nextInstanceId(items: readonly PlacedFurniture[], productId: string): string {
  const prefix = `${productId}-`;
  let max = 0;
  for (const item of items) {
    if (!item.instanceId.startsWith(prefix)) continue;
    const suffix = Number(item.instanceId.slice(prefix.length));
    if (Number.isFinite(suffix) && suffix > max) {
      max = suffix;
    }
  }
  return `${prefix}${max + 1}`;
}

/**
 * Move an item to new x/z footprint-center coordinates at floor base
 * (y = 0). All other fields (instanceId, productId, rotation, locked,
 * source) are preserved. Locked items may be moved.
 */
export function moveProduct(
  instanceId: string,
  items: readonly PlacedFurniture[],
  x: number,
  z: number,
): SerializableResult<PlacementMutationResult> {
  const index = items.findIndex((item) => item.instanceId === instanceId);
  if (index === -1) {
    return fail('item_not_found', `No placed item with instance id "${instanceId}".`, {
      instanceId,
    });
  }
  const current = items[index];
  const moved: PlacedFurniture = {
    instanceId: current.instanceId,
    productId: current.productId,
    position: { x, y: 0, z },
    rotation: current.rotation,
    locked: current.locked,
    source: current.source,
    variant: { color: current.variant.color, material: current.variant.material },
  };
  const updated = items.slice();
  updated[index] = moved;
  return ok({ items: updated, item: moved });
}

/**
 * Set an item's yaw rotation (degrees around y, normalized to [0, 360)).
 * All other fields are preserved. Locked items may be rotated.
 */
export function rotateProduct(
  instanceId: string,
  items: readonly PlacedFurniture[],
  rotation: number,
): SerializableResult<PlacementMutationResult> {
  const index = items.findIndex((item) => item.instanceId === instanceId);
  if (index === -1) {
    return fail('item_not_found', `No placed item with instance id "${instanceId}".`, {
      instanceId,
    });
  }
  const current = items[index];
  const rotated: PlacedFurniture = { ...current, rotation: normalizeRotation(rotation) };
  const updated = items.slice();
  updated[index] = rotated;
  return ok({ items: updated, item: rotated });
}

/**
 * Remove an item from the room. Locked items cannot be removed. The removed
 * item is returned as `item` in the payload.
 */
export function removeProduct(
  instanceId: string,
  items: readonly PlacedFurniture[],
): SerializableResult<PlacementMutationResult> {
  const index = items.findIndex((item) => item.instanceId === instanceId);
  if (index === -1) {
    return fail('item_not_found', `No placed item with instance id "${instanceId}".`, {
      instanceId,
    });
  }
  const current = items[index];
  if (current.locked) {
    return fail('item_locked', `Item "${instanceId}" is locked and cannot be removed.`, {
      instanceId,
    });
  }
  const updated = items.slice();
  updated.splice(index, 1);
  return ok({ items: updated, item: current });
}

/**
 * Set the locked flag on an item. All other fields are preserved; setting
 * the current value again is a no-op success.
 */
export function setItemLocked(
  instanceId: string,
  items: readonly PlacedFurniture[],
  locked: boolean,
): SerializableResult<PlacementMutationResult> {
  const index = items.findIndex((item) => item.instanceId === instanceId);
  if (index === -1) {
    return fail('item_not_found', `No placed item with instance id "${instanceId}".`, {
      instanceId,
    });
  }
  const current = items[index];
  if (current.locked === locked) {
    return ok({ items, item: current });
  }
  const updatedItem: PlacedFurniture = { ...current, locked };
  const updated = items.slice();
  updated[index] = updatedItem;
  return ok({ items: updated, item: updatedItem });
}

/** Result payload of replaceProduct. */
export interface ReplaceProductResult extends PlacementMutationResult {
  /** current catalog price minus replacement price; negative when pricier */
  savings: number;
}

/**
 * Replace the product backing an item. The replacement must exist, be in
 * stock, and share the item's current category. The item keeps its
 * instanceId, center position, rotation, and source, and its variant color
 * when the replacement offers it (otherwise the replacement's first
 * color), always with the replacement's material. Locked items cannot be
 * replaced.
 */
export function replaceProduct(
  instanceId: string,
  items: readonly PlacedFurniture[],
  newProductId: string,
): SerializableResult<ReplaceProductResult> {
  const index = items.findIndex((item) => item.instanceId === instanceId);
  if (index === -1) {
    return fail('item_not_found', `No placed item with instance id "${instanceId}".`, {
      instanceId,
    });
  }
  const current = items[index];
  if (current.locked) {
    return fail('item_locked', `Item "${instanceId}" is locked and cannot be replaced.`, {
      instanceId,
    });
  }
  const currentProduct = findProduct(current.productId);
  if (currentProduct === undefined) {
    return fail('missing_product', `Product "${current.productId}" is not in the catalog.`, {
      productIds: [current.productId],
    });
  }
  const replacement = findProduct(newProductId);
  if (replacement === undefined) {
    return fail('missing_product', `Product "${newProductId}" is not in the catalog.`, {
      productIds: [newProductId],
    });
  }
  if (replacement.category !== currentProduct.category) {
    return fail(
      'category_mismatch',
      `"${replacement.name}" (${replacement.category}) cannot replace "${currentProduct.name}" (${currentProduct.category}); categories must match.`,
      {
        instanceId,
        currentCategory: currentProduct.category,
        requestedCategory: replacement.category,
      },
    );
  }
  if (replacement.stock <= 0) {
    return fail(
      'out_of_stock',
      `"${replacement.name}" is out of stock and cannot be used as a replacement.`,
      { productId: newProductId },
    );
  }
  const replaced: PlacedFurniture = {
    instanceId: current.instanceId,
    productId: replacement.id,
    position: current.position,
    rotation: current.rotation,
    locked: false,
    source: current.source,
    variant: {
      color: replacement.colors.includes(current.variant.color) ? current.variant.color : (replacement.colors[0] ?? 'linen'),
      material: replacement.material,
    },
  };
  const updated = items.slice();
  updated[index] = replaced;
  return ok({
    items: updated,
    item: replaced,
    savings: currentProduct.price - replacement.price,
  });
}
