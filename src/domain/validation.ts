/**
 * Deterministic layout validation for the living-room design editor.
 *
 * Pure functions shared by the Zustand store and the WebMCP-facing tool
 * actions. All geometry runs in the room's centered coordinate system with
 * x/z-centered axis-aligned footprints. An item's footprint is the
 * axis-aligned bounding box of its catalog extents rotated by its yaw
 * (rotation in degrees about +y): `|w·cos θ| + |d·sin θ|` along x,
 * `|w·sin θ| + |d·cos θ|` along z, centered on the item position.
 *
 * Semantics:
 * - Locked and existing items are validated exactly like any other item;
 *   only the budget ignores existing-source items (they never count).
 * - Rug/curtain/decor/plant items are never hard blockers: they are skipped
 *   by furniture collision checks and by placement-zone accounting, so a rug
 *   may lie under a sofa and a curtain may hang beside a window.
 * - Furniture overlap areas up to 0.02 m² are tolerated (contact/trim noise);
 *   opening clearance instead reports ANY positive overlap, because opening
 *   footprints represent required interior clearance.
 * - A balcony opening is identified by its id metadata: any opening whose id
 *   contains "balcony" is treated as a balcony door.
 * - Zone membership is the item's center point inside the zone footprint,
 *   inclusive edges; every containing zone is evaluated independently, so an
 *   item inside nested/overlapping zones counts toward each zone's checks.
 * - Zone placement (category/footprint/occupancy gates) happens before
 *   mutation in the placement actions; full-design validation still flags
 *   arbitrary-coordinate placements that end up zone-incompatible.
 *
 * Issues are emitted in a fixed order matching VALIDATION_ISSUE_KINDS:
 * out_of_bounds, overlap, blocks_opening, zone_mismatch, outside_zone,
 * budget_exceeded, out_of_stock, missing_product.
 */

import { getProduct } from '@/data/products';
import type {
  FurnitureCategory,
  FurnitureProduct,
  PlacedFurniture,
  RectFootprint,
  RoomData,
  RoomOpening,
  ValidationIssue,
  ValidationResult,
  WallSide,
} from './types';
import { WALL_SIDES } from './types';

/** Furniture categories whose footprints never hard-block other items. */
export const SOFT_CATEGORIES: readonly FurnitureCategory[] = [
  'rug',
  'curtain',
  'decor',
  'plant',
];

/**
 * Overlap areas at or below this many square meters are treated as contact
 * or trim tolerance and are not reported as furniture collisions.
 */
export const OVERLAP_TOLERANCE_M2 = 0.02;

/** Openings whose id contains this marker are treated as balcony doors. */
export const BALCONY_ID_MARKER = 'balcony';

/** True for rug/curtain/decor/plant categories. */
export function isSoftCategory(category: FurnitureCategory): boolean {
  return (
    category === 'rug' ||
    category === 'curtain' ||
    category === 'decor' ||
    category === 'plant'
  );
}

/** True when the opening is identified as a balcony (by its id metadata). */
export function isBalconyOpening(opening: RoomOpening): boolean {
  return opening.id.toLowerCase().includes(BALCONY_ID_MARKER);
}

/** Rotated axis-aligned extents of a width × depth footprint, in meters. */
export function rotateExtents(
  width: number,
  depth: number,
  rotationDeg: number,
): { width: number; depth: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { width: width * cos + depth * sin, depth: width * sin + depth * cos };
}

/**
 * The x/z-centered footprint of a placed item: the axis-aligned bounding
 * box of its catalog extents rotated by the item's yaw.
 */
export function footprintFor(
  item: PlacedFurniture,
  product: Pick<FurnitureProduct, 'width' | 'depth'>,
): RectFootprint {
  const ext = rotateExtents(product.width, product.depth, item.rotation);
  return { x: item.position.x, z: item.position.z, width: ext.width, depth: ext.depth };
}

/** True when two vertical bands [a0, a1] and [b0, b1] (meters above floor)
 * overlap by more than zero; bands that merely touch do not overlap.
 * Floor-anchored furniture spans [0, height]; elevated pieces span
 * [y, y + height]; openings span [sillHeight, sillHeight + height]. */
export function verticalBandsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

/** Overlap area of two axis-aligned footprints in m²; 0 when disjoint. */
export function overlapArea(a: RectFootprint, b: RectFootprint): number {
  const ox =
    Math.min(a.x + a.width / 2, b.x + b.width / 2) -
    Math.max(a.x - a.width / 2, b.x - b.width / 2);
  const oz =
    Math.min(a.z + a.depth / 2, b.z + b.depth / 2) -
    Math.max(a.z - a.depth / 2, b.z - b.depth / 2);
  return ox > 0 && oz > 0 ? ox * oz : 0;
}

/** Intersection rectangle of two footprints, or null when they are disjoint. */
export function intersection(a: RectFootprint, b: RectFootprint): RectFootprint | null {
  const minX = Math.max(a.x - a.width / 2, b.x - b.width / 2);
  const maxX = Math.min(a.x + a.width / 2, b.x + b.width / 2);
  const minZ = Math.max(a.z - a.depth / 2, b.z - b.depth / 2);
  const maxZ = Math.min(a.z + a.depth / 2, b.z + b.depth / 2);
  if (maxX <= minX || maxZ <= minZ) return null;
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ };
}

/** Options controlling which checks checkLayout runs. */
export interface CheckLayoutOptions {
  /**
   * Include the budget check. Defaults to true when a budget is provided;
   * pass false to force the budget check off even when a budget is given.
   */
  includeBudget?: boolean;
}

/** Resolved per-item validation context. */
interface ItemInfo {
  item: PlacedFurniture;
  /** catalog product; undefined when the id is unknown to the catalog */
  product?: FurnitureProduct;
  /** rotated footprint; undefined while the product is unknown */
  footprint?: RectFootprint;
  /** vertical band above the floor [itemY, itemY + productHeight] */
  band?: { bottom: number; top: number };
  /** display label: product name, or the raw product id when unknown */
  name: string;
}

/** Walls the footprint crosses, in canonical WALL_SIDES order. */
function wallsExceeded(footprint: RectFootprint, room: RoomData): WallSide[] {
  const halfW = room.dimensions.width / 2;
  const halfD = room.dimensions.depth / 2;
  const minX = footprint.x - footprint.width / 2;
  const maxX = footprint.x + footprint.width / 2;
  const minZ = footprint.z - footprint.depth / 2;
  const maxZ = footprint.z + footprint.depth / 2;
  const exceeded: WallSide[] = [];
  for (const wall of WALL_SIDES) {
    const beyond =
      (wall === 'north' && minZ < -halfD) ||
      (wall === 'south' && maxZ > halfD) ||
      (wall === 'east' && maxX > halfW) ||
      (wall === 'west' && minX < -halfW);
    if (beyond) exceeded.push(wall);
  }
  return exceeded;
}

/** True when the point lies inside the footprint, inclusive edges. */
function pointInFootprint(x: number, z: number, fp: RectFootprint): boolean {
  return (
    x >= fp.x - fp.width / 2 &&
    x <= fp.x + fp.width / 2 &&
    z >= fp.z - fp.depth / 2 &&
    z <= fp.z + fp.depth / 2
  );
}

/**
 * Validate a full design against the room, its openings and zones, the
 * catalog, and (optionally) the budget.
 *
 * `budget` is optional: when provided, the marketplace total is checked
 * against it unless `options.includeBudget` is explicitly false. Items whose
 * product is missing from the catalog are reported via `missing_product` and
 * skipped by all geometric checks (their extents are unknowable); they also
 * never contribute to the marketplace total.
 *
 * The result is deterministic: for identical inputs the issue list is
 * identical, ordered as documented at the top of this module.
 */
export function checkLayout(
  room: RoomData,
  items: readonly PlacedFurniture[],
  budget?: number,
  options: CheckLayoutOptions = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Resolve every item once: catalog product, rotated footprint, label.
  const info: ItemInfo[] = [];
  for (const item of items) {
    const product = getProduct(item.productId);
    info.push({
      item,
      product,
      footprint: product ? footprintFor(item, product) : undefined,
      band:
        product !== undefined
          ? { bottom: item.position.y, top: item.position.y + product.height }
          : undefined,
      name: product ? product.name : item.productId,
    });
  }

  // 1. Room boundary (error): the rotated footprint must fit inside the room.
  for (const entry of info) {
    const { footprint, item, name } = entry;
    if (!footprint) continue;
    const walls = wallsExceeded(footprint, room);
    if (walls.length > 0) {
      const wallText =
        walls.length <= 1
          ? walls[0]
          : `${walls.slice(0, -1).join(', ')} and ${walls[walls.length - 1]}`;
      issues.push({
        kind: 'out_of_bounds',
        severity: 'error',
        message: `“${name}” extends past the ${wallText} ${
          walls.length === 1 ? 'wall' : 'walls'
        } of the room`,
        instanceIds: [item.instanceId],
        footprint,
      });
    }
  }

  // 1b. Height bounds (error): the piece must rest on/above the floor and
  //     its top must stay below the ceiling.
  for (const entry of info) {
    const { item, band, name } = entry;
    if (!band) continue;
    if (band.bottom < -1e-9) {
      issues.push({
        kind: 'height_bounds',
        severity: 'error',
        message: `\u201c${name}\u201d sits below the floor (base ${band.bottom.toFixed(2)} m)`,
        instanceIds: [item.instanceId],
      });
      continue;
    }
    const ceiling = room.dimensions.height;
    if (band.top > ceiling + 1e-9) {
      issues.push({
        kind: 'height_bounds',
        severity: 'error',
        message: `\u201c${name}\u201d extends above the ceiling (top ${band.top.toFixed(2)} m > ${ceiling.toFixed(2)} m)`,
        instanceIds: [item.instanceId],
      });
    }
  }

  // 2. Furniture collisions (warning): significant overlaps between hard
  //    items; rug/curtain/decor/plant never block.
  for (let i = 0; i < info.length; i++) {
    const a = info[i];
    if (!a.footprint || !a.product || isSoftCategory(a.product.category)) continue;
    for (let j = i + 1; j < info.length; j++) {
      const b = info[j];
      if (!b.footprint || !b.product || isSoftCategory(b.product.category)) continue;
      const area = overlapArea(a.footprint, b.footprint);
      const sameBand =
        a.band !== undefined &&
        b.band !== undefined &&
        verticalBandsOverlap(a.band.bottom, a.band.top, b.band.bottom, b.band.top);
      if (area > OVERLAP_TOLERANCE_M2 && sameBand) {
        const region = intersection(a.footprint, b.footprint);
        if (region) {
          issues.push({
            kind: 'overlap',
            severity: 'warning',
            message: `“${a.name}” overlaps “${b.name}” by ${area.toFixed(2)} m²`,
            instanceIds: [a.item.instanceId, b.item.instanceId],
            footprint: region,
          });
        }
      }
    }
  }

  // 3. Opening clearance (error): any positive overlap with a door, window,
  //    or balcony opening footprint blocks required interior clearance.
  for (const entry of info) {
    const { footprint, item, name } = entry;
    if (!footprint) continue;
    for (const opening of room.openings) {
      const area = overlapArea(footprint, opening.footprint);
      const clearsBand =
        entry.band === undefined ||
        verticalBandsOverlap(
          entry.band.bottom,
          entry.band.top,
          opening.sillHeight,
          opening.sillHeight + opening.height,
        );
      if (area > 0 && clearsBand) {
        const region = intersection(footprint, opening.footprint);
        if (region) {
          const label = isBalconyOpening(opening)
            ? 'balcony door'
            : opening.kind === 'door'
              ? 'doorway'
              : 'window';
          issues.push({
            kind: 'blocks_opening',
            severity: 'error',
            message: `“${name}” blocks the ${label} “${opening.id}”`,
            instanceIds: [item.instanceId],
            refId: opening.id,
            footprint: region,
          });
        }
      }
    }
  }

  // 4. Zone compatibility (warning): category mismatch and occupancy limits,
  //    per containing zone, in zone array order.
  for (const zone of room.placementZones) {
    const occupants: string[] = [];
    const allowed = zone.allowedCategories;
    for (const entry of info) {
      if (!entry.footprint || !entry.product || isSoftCategory(entry.product.category)) continue;
      if (!pointInFootprint(entry.item.position.x, entry.item.position.z, zone.footprint)) continue;
      occupants.push(entry.item.instanceId);
      if (allowed && allowed.length > 0 && !allowed.includes(entry.product.category)) {
        issues.push({
          kind: 'zone_mismatch',
          severity: 'warning',
          message: `“${entry.name}” is not allowed in the “${zone.name}” zone`,
          instanceIds: [entry.item.instanceId],
          refId: zone.id,
        });
      }
    }
    if (zone.maxItems !== undefined && occupants.length > zone.maxItems) {
      issues.push({
        kind: 'zone_mismatch',
        severity: 'warning',
        message: `Zone “${zone.name}” contains ${occupants.length} items, exceeding its ${zone.maxItems} item limit`,
        instanceIds: occupants,
        refId: zone.id,
      });
    }
  }

  // 5. Zone membership (warning): every hard item's center must lie inside
  //    at least one placement zone.
  for (const entry of info) {
    if (!entry.footprint || !entry.product || isSoftCategory(entry.product.category)) continue;
    let contained = false;
    for (const zone of room.placementZones) {
      if (pointInFootprint(entry.item.position.x, entry.item.position.z, zone.footprint)) {
        contained = true;
        break;
      }
    }
    if (!contained) {
      issues.push({
        kind: 'outside_zone',
        severity: 'warning',
        message: `“${entry.name}” is placed outside all placement zones`,
        instanceIds: [entry.item.instanceId],
      });
    }
  }

  // 6. Budget (error, optional): marketplace-sourced items only.
  if (budget !== undefined && options.includeBudget !== false) {
    let total = 0;
    const marketIds: string[] = [];
    for (const entry of info) {
      if (entry.product && entry.item.source === 'marketplace') {
        total += entry.product.price;
        marketIds.push(entry.item.instanceId);
      }
    }
    if (total > budget) {
      issues.push({
        kind: 'budget_exceeded',
        severity: 'error',
        message: `Marketplace total $${total.toFixed(2)} exceeds the $${budget.toFixed(2)} budget`,
        instanceIds: marketIds,
        budget,
        total,
      });
    }
  }

  // 7. Out of stock (error): placed products with no units left, aggregated
  //    by product id in first-occurrence order.
  const outOfStockIds: string[] = [];
  const outOfStockNames: string[] = [];
  const outOfStockInstances: string[] = [];
  const seenOutOfStock = new Set<string>();
  for (const entry of info) {
    if (entry.product && entry.product.stock === 0) {
      if (!seenOutOfStock.has(entry.product.id)) {
        seenOutOfStock.add(entry.product.id);
        outOfStockIds.push(entry.product.id);
        outOfStockNames.push(entry.product.name);
      }
      outOfStockInstances.push(entry.item.instanceId);
    }
  }
  if (outOfStockIds.length > 0) {
    issues.push({
      kind: 'out_of_stock',
      severity: 'error',
      message: `Out of stock: ${outOfStockNames.map((n) => `“${n}”`).join(', ')}`,
      instanceIds: outOfStockInstances,
      productIds: outOfStockIds,
    });
  }

  // 8. Missing product (error): placed ids absent from the catalog,
  //    aggregated by id in first-occurrence order.
  const missingIds: string[] = [];
  const missingInstances: string[] = [];
  const seenMissing = new Set<string>();
  for (const entry of info) {
    if (!entry.product) {
      if (!seenMissing.has(entry.item.productId)) {
        seenMissing.add(entry.item.productId);
        missingIds.push(entry.item.productId);
      }
      missingInstances.push(entry.item.instanceId);
    }
  }
  if (missingIds.length > 0) {
    issues.push({
      kind: 'missing_product',
      severity: 'error',
      message: `Unknown product${missingIds.length === 1 ? '' : 's'}: ${missingIds
        .map((id) => `“${id}”`)
        .join(', ')}`,
      instanceIds: missingInstances,
      productIds: missingIds,
    });
  }

  return { valid: !issues.some((issue) => issue.severity === 'error'), issues };
}
