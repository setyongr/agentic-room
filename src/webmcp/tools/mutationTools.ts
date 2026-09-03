/**
 * Mutating WebMCP tools over the shared room store.
 *
 * Every mutation routes through the exact same Zustand store action the
 * human UI uses, with `origin='agent'`, so state, the visible Three scene,
 * pricing/validation, and the fixed activity feed all update synchronously
 * and identically. Inputs are validated at runtime through the shared
 * serialize helpers; domain rules (stock, zone fit, lock protection,
 * same-category replacement, design existence, marketplace-only cart adds)
 * are enforced by the store/domain, and their error code/message/details
 * are preserved verbatim in `{success:false,error,code,...}` failures that
 * never throw and never partially mutate. Success payloads are compact:
 * the affected item plus refreshed pricing and layout validity.
 *
 * Tools are stateless: each call reads live store state at execution time,
 * so the returned array can be created per registration and never caches
 * stale data.
 */

import * as pricing from '@/domain/pricing';
import { ROOM_SIZE_LIMITS, openingAlongWallCenter, openingAlongWallSize } from '@/domain/resize';
import type { FurnitureProduct, PlacedFurniture, RoomOpening, SerializableError } from '@/domain/types';
import {
  FLOOR_FINISH_IDS,
  FURNITURE_SOURCES,
  ROOM_OPENING_KINDS,
  WALL_FINISH_IDS,
  WALL_SIDES,
  WALLPAPER_IDS,
} from '@/domain/types';
import { DEFAULT_ROOM_APPEARANCE } from '@/data/appearance';
import { useRoomStore } from '@/store/roomStore';
import type { RoomStore } from '@/store/roomStore';
import {
  isPlainObject,
  readObjectInput,
  readOptionalBoolean,
  readOptionalEnum,
  readOptionalNumber,
  readOptionalString,
  readOptionalStringArray,
  readRequiredEnum,
  readRequiredNumber,
  readRequiredString,
  toolFail,
  toolOk,
} from '@/webmcp/serialize';
import type { ReadResult } from '@/webmcp/serialize';
import type { ModelContextJsonSchema, ModelContextTool } from '@/webmcp/types';
import { MAX_LIST_ITEMS, condenseIssues, placedItemCard, truncatedFlag } from './readTools';

/**
 * Build one mutation tool: never read-only, never untrusted content, an
 * explicit object input schema, and the given execute callback.
 */
function mutationTool(
  name: string,
  description: string,
  execute: ModelContextTool['execute'],
  inputSchema: ModelContextJsonSchema,
  destructive = false,
): ModelContextTool {
  return {
    name,
    description,
    inputSchema,
    annotations: {
      readOnlyHint: false,
      untrustedContentHint: false,
      ...(destructive ? { destructiveHint: true } : {}),
    },
    execute,
  };
}

/** Read a nested `position` object as `{x, z}`; absent yields undefined. */
function readPositionArg(
  args: Readonly<Record<string, unknown>>,
): ReadResult<{ x: number; z: number } | undefined> {
  const raw = args['position'];
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      code: 'invalid_args',
      message: `Argument "position" must be an object with x and z, got ${
        raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw
      }`,
    };
  }
  const x = readRequiredNumber(raw, 'x');
  if (!x.ok) return x;
  const z = readRequiredNumber(raw, 'z');
  if (!z.ok) return z;
  return { ok: true, value: { x: x.value, z: z.value } };
}

/** Compact pricing block: budget-relevant totals from live state. */
function pricingBlock(state: RoomStore): Record<string, unknown> {
  return {
    newTotal: state.pricing.newTotal,
    budget: state.pricing.budget,
    remaining: state.pricing.remaining,
    overBudget: state.pricing.overBudget,
  };
}

/** Compact layout block: validity plus condensed issues from live state. */
function layoutBlock(state: RoomStore): Record<string, unknown> {
  const condensed = condenseIssues(state.validation.issues);
  return {
    valid: state.validation.valid,
    issueCount: state.validation.issues.length,
    ...truncatedFlag(condensed.truncated),
    issues: condensed.issues,
  };
}

/** Success payload for item mutations: the affected item plus refreshed pricing and layout. */
function itemMutationOk(item: PlacedFurniture, product: FurnitureProduct | undefined): string {
  const state = useRoomStore.getState();
  return toolOk({
    item: placedItemCard(item, product),
    pricing: pricingBlock(state),
    layout: layoutBlock(state),
  });
}

/** Structured failure payload preserving the domain's code, message, and details. */
function resultFail(result: SerializableError): string {
  return toolFail(result.code, result.message, result.details);
}

/** Add a product to the room, in a placement zone or at explicit coordinates. */
function placeProductTool(): ModelContextTool {
  return mutationTool(
    'place_product',
    'Place a product through the same store action as the UI: zoneId centers it in a placement zone (category, capacity, and fit are domain-enforced), or position x/z places it explicitly (unvalidated geometry); optional rotation; optional color (one of the product\u2019s authored colors) with the product\u2019s material. Returns the new item with its stored variant, refreshed pricing (newTotal, budget, remaining, overBudget), and current layout validity and issues. Failures (missing/out-of-stock product, unknown/full/incompatible zone, unavailable color or material) leave the room unchanged.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const productId = readRequiredString(args.value, 'productId', { maxLength: 80 });
      const zoneId = readOptionalString(args.value, 'zoneId', { maxLength: 60 });
      const position = readPositionArg(args.value);
      const rotation = readOptionalNumber(args.value, 'rotation');
      const color = readOptionalString(args.value, 'color', { maxLength: 40 });
      const material = readOptionalString(args.value, 'material', { maxLength: 40 });
      if (!productId.ok) return toolFail(productId.code, productId.message);
      if (!zoneId.ok) return toolFail(zoneId.code, zoneId.message);
      if (!position.ok) return toolFail(position.code, position.message);
      if (!rotation.ok) return toolFail(rotation.code, rotation.message);
      if (!color.ok) return toolFail(color.code, color.message);
      if (!material.ok) return toolFail(material.code, material.message);
      if (zoneId.value === undefined && position.value === undefined) {
        return toolFail('invalid_args', 'Specify either "zoneId" or "position" (an object with x and z) to place the product');
      }
      const result = useRoomStore.getState().placeProduct(
        productId.value,
        {
          ...(zoneId.value !== undefined ? { zoneId: zoneId.value } : {}),
          ...(position.value !== undefined ? { x: position.value.x, z: position.value.z } : {}),
          ...(rotation.value !== undefined ? { rotation: rotation.value } : {}),
          ...(color.value !== undefined || material.value !== undefined
            ? { variant: { ...(color.value !== undefined ? { color: color.value } : {}), ...(material.value !== undefined ? { material: material.value } : {}) } }
            : {}),
        },
        'agent',
      );
      if (!result.ok) return resultFail(result);
      const state = useRoomStore.getState();
      return itemMutationOk(result.data.item, state.getProductById(result.data.item.productId));
    },
    {
      type: 'object',
      properties: {
        productId: {
          type: 'string',
          description: 'Catalog product id to place, e.g. "drift-oak-coffee-table".',
        },
        zoneId: {
          type: 'string',
          description: 'Place into this zone at its center (e.g. "living-area"); exclusive with position.',
        },
        position: {
          type: 'object',
          description: 'Explicit footprint center in room coordinates; exclusive with zoneId.',
          properties: {
            x: {
              type: 'number',
              description: 'Center x in meters; the room spans x in [-3, 3].',
            },
            z: {
              type: 'number',
              description: 'Center z in meters; the room spans z in [-2.25, 2.25].',
            },
          },
          required: ['x', 'z'],
          additionalProperties: false,
        },
        rotation: {
          type: 'number',
          description: 'Yaw in degrees; normalized to [0, 360). Defaults to the product default (0).',
        },
        color: {
          type: 'string',
          description: 'Chosen colorway, one of the product\u2019s authored colors (see get_product). Defaults to the first color.',
        },
        material: {
          type: 'string',
          description: 'The product\u2019s authored material; mismatched values fail with invalid_variant.',
        },
      },
      required: ['productId'],
      oneOf: [
        { type: 'object', required: ['zoneId'] },
        { type: 'object', required: ['position'] },
      ],
      additionalProperties: false,
    },
  );
}

/** Move a placed item to new x/z coordinates. */
function moveProductTool(): ModelContextTool {
  return mutationTool(
    'move_product',
    'Move a placed item to a new x/z footprint-center position (floor base, y stays 0) through the same store action as the UI. Locked items may be moved. The move itself is not geometry-checked; validation refreshes immediately and reports out-of-bounds, overlap, opening, and zone issues. Returns the moved item, refreshed pricing (newTotal, budget, remaining, overBudget), and current layout validity and issues.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceId = readRequiredString(args.value, 'instanceId', { maxLength: 80 });
      const position = readPositionArg(args.value);
      if (!instanceId.ok) return toolFail(instanceId.code, instanceId.message);
      if (!position.ok) return toolFail(position.code, position.message);
      if (position.value === undefined) {
        return toolFail('invalid_args', 'Argument "position" is required');
      }
      const result = useRoomStore
        .getState()
        .moveProduct(instanceId.value, position.value.x, position.value.z, 'agent');
      if (!result.ok) return resultFail(result);
      const state = useRoomStore.getState();
      return itemMutationOk(result.data.item, state.getProductById(result.data.item.productId));
    },
    {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance id of the placed item to act on, e.g. "existing-sofa" or "drift-oak-coffee-table-1".',
        },
        position: {
          type: 'object',
          description: 'New footprint center in room coordinates; the item stays at floor base.',
          properties: {
            x: {
              type: 'number',
              description: 'Center x in meters; the room spans x in [-3, 3].',
            },
            z: {
              type: 'number',
              description: 'Center z in meters; the room spans z in [-2.25, 2.25].',
            },
          },
          required: ['x', 'z'],
          additionalProperties: false,
        },
      },
      required: ['instanceId', 'position'],
      additionalProperties: false,
    },
  );
}

/** Set a placed item's yaw rotation. */
function rotateProductTool(): ModelContextTool {
  return mutationTool(
    'rotate_product',
    'Set a placed item\u2019s yaw rotation in degrees through the same store action as the UI; the value is normalized to [0, 360). Position, lock, and source are unchanged, and locked items may be rotated. Returns the rotated item, refreshed pricing (newTotal, budget, remaining, overBudget), and current layout validity and issues. Unknown instances fail with item_not_found.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceId = readRequiredString(args.value, 'instanceId', { maxLength: 80 });
      const rotation = readRequiredNumber(args.value, 'rotation');
      if (!instanceId.ok) return toolFail(instanceId.code, instanceId.message);
      if (!rotation.ok) return toolFail(rotation.code, rotation.message);
      const result = useRoomStore
        .getState()
        .rotateProduct(instanceId.value, rotation.value, 'agent');
      if (!result.ok) return resultFail(result);
      const state = useRoomStore.getState();
      return itemMutationOk(result.data.item, state.getProductById(result.data.item.productId));
    },
    {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance id of the placed item to act on, e.g. "existing-sofa" or "drift-oak-coffee-table-1".',
        },
        rotation: {
          type: 'number',
          description: 'New yaw in degrees around y; normalized to [0, 360).',
        },
      },
      required: ['instanceId', 'rotation'],
      additionalProperties: false,
    },
  );
}

/** Set a placed item's height above the floor (wall mounting). */
function setItemElevationTool(): ModelContextTool {
  return mutationTool(
    'set_item_elevation',
    'Set how high a placed item\u2019s base sits above the floor (meters) through the same store action as the UI: raise TVs, wall art, shelves, and curtains to hang them instead of resting on the floor. y=0 puts the piece back on the floor. Locked items may be raised (like move/rotate); negative or non-finite heights fail with invalid_elevation. The layout refreshes immediately, so a piece whose top crosses the ceiling surfaces as a height_bounds error. Moving the piece later keeps its height. Returns the item with its updated position, refreshed pricing (newTotal, budget, remaining, overBudget), and current layout validity and issues. Unknown instances fail with item_not_found.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceId = readRequiredString(args.value, 'instanceId', { maxLength: 80 });
      const y = readRequiredNumber(args.value, 'y', { min: 0 });
      if (!instanceId.ok) return toolFail(instanceId.code, instanceId.message);
      if (!y.ok) return toolFail(y.code, y.message);
      const result = useRoomStore
        .getState()
        .setItemElevation(instanceId.value, y.value, 'agent');
      if (!result.ok) return resultFail(result);
      const state = useRoomStore.getState();
      return itemMutationOk(result.data.item, state.getProductById(result.data.item.productId));
    },
    {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance id of the placed item to act on, e.g. "existing-sofa" or "aria-55-oled-tv-1".',
        },
        y: {
          type: 'number',
          description: 'Height of the piece base above the floor in meters, 0 or greater (0 = on the floor). The piece top must stay below the ceiling.',
          minimum: 0,
        },
      },
      required: ['instanceId', 'y'],
      additionalProperties: false,
    },
  );
}

/** Remove a placed item from the room. */
function removeProductTool(): ModelContextTool {
  return mutationTool(
    'remove_product',
    'Remove a placed item from the room through the same store action as the UI. Locked items cannot be removed (item_locked). Destructive: the item is permanently gone from the current design. Returns the removed item as it was, refreshed pricing (newTotal, budget, remaining, overBudget), and current layout validity and issues. Unknown instances fail with item_not_found.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceId = readRequiredString(args.value, 'instanceId', { maxLength: 80 });
      if (!instanceId.ok) return toolFail(instanceId.code, instanceId.message);
      const result = useRoomStore.getState().removeProduct(instanceId.value, 'agent');
      if (!result.ok) return resultFail(result);
      const state = useRoomStore.getState();
      return itemMutationOk(result.data.item, state.getProductById(result.data.item.productId));
    },
    {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance id of the placed item to act on, e.g. "existing-sofa" or "drift-oak-coffee-table-1".',
        },
      },
      required: ['instanceId'],
      additionalProperties: false,
    },
    true,
  );
}

/** Lock or unlock a placed item. */
function setItemLockedTool(): ModelContextTool {
  return mutationTool(
    'set_item_locked',
    'Lock or unlock a placed item through the same store action as the UI. Locked items cannot be removed or replaced but can still be moved and rotated; setting the current value is a no-op success. Returns the item with its updated lock state, refreshed pricing (newTotal, budget, remaining, overBudget), and current layout validity and issues.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceId = readRequiredString(args.value, 'instanceId', { maxLength: 80 });
      const locked = readOptionalBoolean(args.value, 'locked');
      if (!instanceId.ok) return toolFail(instanceId.code, instanceId.message);
      if (!locked.ok) return toolFail(locked.code, locked.message);
      if (locked.value === undefined) return toolFail('invalid_args', 'Argument "locked" is required');
      const result = useRoomStore
        .getState()
        .setItemLocked(instanceId.value, locked.value, 'agent');
      if (!result.ok) return resultFail(result);
      const state = useRoomStore.getState();
      return itemMutationOk(result.data.item, state.getProductById(result.data.item.productId));
    },
    {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance id of the placed item to act on, e.g. "existing-sofa" or "drift-oak-coffee-table-1".',
        },
        locked: {
          type: 'boolean',
          description: 'True locks the item (cannot be removed or replaced); false unlocks it.',
        },
      },
      required: ['instanceId', 'locked'],
      additionalProperties: false,
    },
  );
}

/** Set the design budget. */
function setBudgetTool(): ModelContextTool {
  return mutationTool(
    'set_budget',
    'Set the design budget in USD through the same store action as the UI; only marketplace items count against it. Pricing and validation refresh immediately, so a budget below the current marketplace total surfaces a budget_exceeded error. Returns the status (budget_updated, or unchanged for a no-op), the new budget, refreshed pricing (newTotal, remaining, overBudget), and current layout validity and issues.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const budget = readRequiredNumber(args.value, 'budget', { min: 0 });
      if (!budget.ok) return toolFail(budget.code, budget.message);
      const state = useRoomStore.getState();
      const previousBudget = state.budget;
      const result = state.setBudget(budget.value, 'agent');
      if (!result.ok) return resultFail(result);
      const fresh = useRoomStore.getState();
      return toolOk({
        status: previousBudget === budget.value ? 'unchanged' : 'budget_updated',
        budget: fresh.budget,
        pricing: pricingBlock(fresh),
        layout: layoutBlock(fresh),
      });
    },
    {
      type: 'object',
      properties: {
        budget: {
          type: 'number',
          description: 'New design budget in USD; only marketplace items count against it.',
          minimum: 0,
        },
      },
      required: ['budget'],
      additionalProperties: false,
    },
  );
}

/** Resize the room shell to real measured dimensions. */
function resizeRoomTool(): ModelContextTool {
  const { width, depth, height } = ROOM_SIZE_LIMITS;
  return mutationTool(
    'resize_room',
"Resize the room to real measured dimensions: width, depth, and height in meters (supported ranges: see get_room_state room.resizeLimits). Openings stay on their walls and placement zones rebuild with the room; an opening whose wall became too short is removed and reported. Furniture is never moved - pieces left outside the new walls become out-of-bounds layout errors. Returns the new dimensions, floor area in m2, removed opening ids, pricing, and layout validity.",
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const widthArg = readRequiredNumber(args.value, 'width');
      const depthArg = readRequiredNumber(args.value, 'depth');
      const heightArg = readRequiredNumber(args.value, 'height');
      if (!widthArg.ok) return toolFail(widthArg.code, widthArg.message);
      if (!depthArg.ok) return toolFail(depthArg.code, depthArg.message);
      if (!heightArg.ok) return toolFail(heightArg.code, heightArg.message);
      const state = useRoomStore.getState();
      const result = state.setRoomDimensions(
        { width: widthArg.value, depth: depthArg.value, height: heightArg.value },
        'agent',
      );
      if (!result.ok) return resultFail(result);
      const fresh = useRoomStore.getState();
      const resized = result.data.room.dimensions;
      return toolOk({
        status: result.data.changed ? 'resized' : 'unchanged',
        dimensions: {
          width: resized.width,
          depth: resized.depth,
          height: resized.height,
        },
        floorAreaM2: resized.width * resized.depth,
        removedOpeningIds: [...result.data.removedOpeningIds],
        pricing: pricingBlock(fresh),
        layout: layoutBlock(fresh),
      });
    },
    {
      type: 'object',
      properties: {
        width: {
          type: 'number',
          description: `Room width along x in meters (${width.min}-${width.max}).`,
        },
        depth: {
          type: 'number',
          description: `Room depth along z in meters (${depth.min}-${depth.max}).`,
        },
        height: {
          type: 'number',
          description: `Wall height in meters (${height.min}-${height.max}).`,
        },
      },
      required: ['width', 'depth', 'height'],
      additionalProperties: false,
    },
  );
}

/** Replace the product backing a placed item. */
function replaceProductTool(): ModelContextTool {
  return mutationTool(
    'replace_product',
    'Swap the product backing a placed item through the same store action as the UI. The replacement must exist, be in stock, and match the item\u2019s category; locked items cannot be replaced. The item keeps its instance id, position, rotation, and source. Destructive: the previous product is dropped from the item. Returns the replaced item, the price savings (negative when pricier), refreshed pricing, and current layout validity and issues.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceId = readRequiredString(args.value, 'instanceId', { maxLength: 80 });
      const replacementProductId = readRequiredString(args.value, 'replacementProductId', { maxLength: 80 });
      if (!instanceId.ok) return toolFail(instanceId.code, instanceId.message);
      if (!replacementProductId.ok) return toolFail(replacementProductId.code, replacementProductId.message);
      const result = useRoomStore
        .getState()
        .replaceProduct(instanceId.value, replacementProductId.value, 'agent');
      if (!result.ok) return resultFail(result);
      const state = useRoomStore.getState();
      return toolOk({
        item: placedItemCard(result.data.item, state.getProductById(result.data.item.productId)),
        savings: result.data.savings,
        pricing: pricingBlock(state),
        layout: layoutBlock(state),
      });
    },
    {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance id of the placed item to act on, e.g. "existing-sofa" or "drift-oak-coffee-table-1".',
        },
        replacementProductId: {
          type: 'string',
          description: 'Replacement catalog product id; must exist, be in stock, and match the item\u2019s category.',
        },
      },
      required: ['instanceId', 'replacementProductId'],
      additionalProperties: false,
    },
    true,
  );
}

/** Save the current design as a snapshot. */
function saveDesignTool(): ModelContextTool {
  return mutationTool(
    'save_design',
    'Capture the current design (room, placed items with their color variants, budget, room appearance) as a saved snapshot with the given name through the same store action as the UI; saved designs can be restored later with load_design. The live design is unchanged. Returns the snapshot metadata: id, name, creation and update timestamps, budget, item count, marketplace total and room appearance at save time, and the number of designs saved this session.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const name = readRequiredString(args.value, 'name', { maxLength: 80 });
      const thumbnailGradient = readOptionalString(args.value, 'thumbnailGradient', {
        maxLength: 200,
      });
      if (!name.ok) return toolFail(name.code, name.message);
      if (!thumbnailGradient.ok) return toolFail(thumbnailGradient.code, thumbnailGradient.message);
      const result = useRoomStore.getState().saveDesign(
        name.value,
        thumbnailGradient.value !== undefined ? { thumbnailGradient: thumbnailGradient.value } : {},
        'agent',
      );
      if (!result.ok) return resultFail(result);
      const snapshot = result.data;
      const state = useRoomStore.getState();
      return toolOk({
        design: {
          id: snapshot.id,
          name: snapshot.name,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
          budget: snapshot.budget,
          itemCount: snapshot.items.length,
          newTotal: pricing.calculateTotal(snapshot.items, snapshot.budget).newTotal,
          appearance: {
            wallFinishId: snapshot.appearance.wallFinishId,
            floorFinishId: snapshot.appearance.floorFinishId,
            wallpaperId: snapshot.appearance.wallpaperId,
          },
        },
        savedDesignCount: state.savedDesigns.length,
      });
    },
    {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Human-readable name for the saved design snapshot.',
        },
        thumbnailGradient: {
          type: 'string',
          description: 'Optional CSS gradient for the snapshot thumbnail, e.g. "linear-gradient(135deg, #E6DFD2, #8FA3A0)".',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  );
}

/** Restore a design saved earlier this session. */
function loadDesignTool(): ModelContextTool {
  return mutationTool(
    'load_design',
    'Restore a design saved earlier this session (see get_saved_designs) through the same store action as the UI, replacing the current room, placed items (with their color variants), budget, and room appearance. Destructive: the current unsaved design is discarded. Returns the design id and name, restored item count, budget, appearance, refreshed marketplace total and remaining, and current layout validity and issues. Unknown ids fail with design_not_found.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const designId = readRequiredString(args.value, 'designId', { maxLength: 80 });
      if (!designId.ok) return toolFail(designId.code, designId.message);
      const state = useRoomStore.getState();
      const saved = state.savedDesigns.find((design) => design.id === designId.value);
      const result = state.loadDesign(designId.value, 'agent');
      if (!result.ok) return resultFail(result);
      const fresh = useRoomStore.getState();
      return toolOk({
        design: { id: designId.value, name: saved?.name ?? designId.value },
        restored: {
          itemCount: fresh.furniture.length,
          budget: fresh.budget,
          newTotal: fresh.pricing.newTotal,
          remaining: fresh.pricing.remaining,
          appearance: {
            wallFinishId: fresh.roomAppearance.wallFinishId,
            floorFinishId: fresh.roomAppearance.floorFinishId,
            wallpaperId: fresh.roomAppearance.wallpaperId,
          },
        },
        layout: layoutBlock(fresh),
      });
    },
    {
      type: 'object',
      properties: {
        designId: {
          type: 'string',
          description: 'Id of a design saved this session (see get_saved_designs), e.g. "snapshot-1".',
        },
      },
      required: ['designId'],
      additionalProperties: false,
    },
    true,
  );
}

/** Remove one placed instance's cart line. */
function removeCartItemTool(): ModelContextTool {
  return mutationTool(
    'remove_cart_item',
    'Remove the cart line for one placed instance through the same store action as the UI. Only the cart changes: the furniture stays in the room and can be re-added while it remains a marketplace piece. Useful when a shopper wants to check out only a handful of the room items. Returns the updated cart (status, itemCount, total, lines) and how many lines remain. Unknown instance ids fail with cart_item_not_found; checked-out carts fail with cart_checked_out.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceId = readRequiredString(args.value, 'instanceId', { maxLength: 80 });
      if (!instanceId.ok) return toolFail(instanceId.code, instanceId.message);
      const state = useRoomStore.getState();
      const result = state.removeCartItem(instanceId.value, 'agent');
      if (!result.ok) return resultFail(result);
      const fresh = useRoomStore.getState();
      const cart = result.data;
      const truncated = cart.items.length > MAX_LIST_ITEMS;
      return toolOk({
        cart: {
          id: cart.id,
          status: cart.status,
          itemCount: cart.items.length,
          total: cart.total,
          ...truncatedFlag(truncated),
          lines: cart.items.slice(-MAX_LIST_ITEMS).map((line) => ({
            id: line.id,
            productId: line.productId,
            name: fresh.getProductById(line.productId)?.name ?? line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            ...(line.instanceId !== undefined ? { instanceId: line.instanceId } : {}),
          })),
        },
        removed: true,
      });
    },
    {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Placed instance id whose cart line should be removed, e.g. "aria-55-oled-tv-1".',
        },
      },
      required: ['instanceId'],
      additionalProperties: false,
    },
    true,
  );
}

/** Add placed marketplace items to the shopping cart. */
function addToCartTool(): ModelContextTool {
  return mutationTool(
    'add_to_cart',
    'Add placed marketplace items to the shopping cart through the same store action as the UI, one line per instance at the current catalog price. Any unknown instance, pre-existing (non-marketplace) item, instance already in the cart, or missing product rejects the whole request with per-instance reasons and leaves the cart untouched. Returns cart status, each line (id, product, quantity, unit price, instance id), the cart total, and how many lines were added.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceIds = readOptionalStringArray(args.value, 'instanceIds', { maxLength: 50 });
      if (!instanceIds.ok) return toolFail(instanceIds.code, instanceIds.message);
      if (instanceIds.value === undefined || instanceIds.value.length === 0) {
        return toolFail('invalid_args', 'Argument "instanceIds" must contain at least one instance id');
      }
      const state = useRoomStore.getState();
      const previousLineCount = state.cart.items.length;
      const result = state.addToCart(instanceIds.value, 'agent');
      if (!result.ok) return resultFail(result);
      const fresh = useRoomStore.getState();
      const cart = result.data;
      const truncated = cart.items.length > MAX_LIST_ITEMS;
      return toolOk({
        cart: {
          id: cart.id,
          status: cart.status,
          itemCount: cart.items.length,
          total: cart.total,
          ...truncatedFlag(truncated),
          lines: cart.items.slice(-MAX_LIST_ITEMS).map((line) => ({
            id: line.id,
            productId: line.productId,
            name: fresh.getProductById(line.productId)?.name ?? line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            ...(line.instanceId !== undefined ? { instanceId: line.instanceId } : {}),
          })),
        },
        addedCount: cart.items.length - previousLineCount,
      });
    },
    {
      type: 'object',
      properties: {
        instanceIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Placed marketplace instance ids to add; at least one; duplicates within the request collapse.',
        },
      },
      required: ['instanceIds'],
      additionalProperties: false,
    },
  );
}

/** Set the room appearance (wall finish, floor finish, wallpaper). */
function setRoomAppearanceTool(): ModelContextTool {
  return mutationTool(
    'set_room_appearance',
    'Style the room through the same store action as the UI: either supply all three finish ids (wallFinishId, floorFinishId, wallpaperId) or use preset "default" to restore the defaults (gallery-white walls, natural-oak floor, no wallpaper). Visual only: pricing, layout, and validation are never affected. Returns the resolved appearance and current layout validity and issues.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const wallFinishId = readOptionalEnum(args.value, 'wallFinishId', WALL_FINISH_IDS);
      const floorFinishId = readOptionalEnum(args.value, 'floorFinishId', FLOOR_FINISH_IDS);
      const wallpaperId = readOptionalEnum(args.value, 'wallpaperId', WALLPAPER_IDS);
      const preset = readOptionalEnum(args.value, 'preset', ['default'] as const);
      if (!wallFinishId.ok) return toolFail(wallFinishId.code, wallFinishId.message);
      if (!floorFinishId.ok) return toolFail(floorFinishId.code, floorFinishId.message);
      if (!wallpaperId.ok) return toolFail(wallpaperId.code, wallpaperId.message);
      if (!preset.ok) return toolFail(preset.code, preset.message);

      const explicitCount = [wallFinishId.value, floorFinishId.value, wallpaperId.value].filter(
        (value) => value !== undefined,
      ).length;
      const wantsPreset = preset.value !== undefined;
      if (wantsPreset && explicitCount > 0) {
        return toolFail('invalid_args', 'Specify either "preset" or the three finish ids, not both');
      }
      if (!wantsPreset && explicitCount !== 3) {
        return toolFail(
          'invalid_args',
          'Specify all three of "wallFinishId", "floorFinishId", and "wallpaperId", or "preset": "default"',
        );
      }
      const store = useRoomStore.getState();
      const result = store.setRoomAppearance(
        wantsPreset
          ? DEFAULT_ROOM_APPEARANCE
          : {
              wallFinishId: wallFinishId.value as (typeof WALL_FINISH_IDS)[number],
              floorFinishId: floorFinishId.value as (typeof FLOOR_FINISH_IDS)[number],
              wallpaperId: wallpaperId.value as (typeof WALLPAPER_IDS)[number],
            },
        'agent',
      );
      if (!result.ok) return resultFail(result);
      const fresh = useRoomStore.getState();
      return toolOk({
        appearance: {
          wallFinishId: fresh.roomAppearance.wallFinishId,
          floorFinishId: fresh.roomAppearance.floorFinishId,
          wallpaperId: fresh.roomAppearance.wallpaperId,
        },
        layout: layoutBlock(fresh),
      });
    },
    {
      type: 'object',
      properties: {
        wallFinishId: {
          type: 'string',
          description: 'Wall finish id; one of: gallery-white, warm-sand, soft-sage, clay-plaster.',
          enum: [...WALL_FINISH_IDS],
        },
        floorFinishId: {
          type: 'string',
          description: 'Floor finish id; one of: natural-oak, white-oak, walnut, slate-tile.',
          enum: [...FLOOR_FINISH_IDS],
        },
        wallpaperId: {
          type: 'string',
          description: 'Wallpaper id; one of: none, linen-stripe, botanical-line, arched-geo.',
          enum: [...WALLPAPER_IDS],
        },
        preset: {
          type: 'string',
          description: 'Reset to the default styling.',
          enum: ['default'],
        },
      },
      oneOf: [
        {
          type: 'object',
          required: ['wallFinishId', 'floorFinishId', 'wallpaperId'],
          properties: { wallFinishId: { type: 'string' }, floorFinishId: { type: 'string' }, wallpaperId: { type: 'string' } },
          additionalProperties: false,
        },
        { type: 'object', required: ['preset'], properties: { preset: { type: 'string' } }, additionalProperties: false },
      ],
      additionalProperties: false,
    },
  );
}

/** Compact opening card: identity, wall placement, and real sizes. */
function openingCard(opening: RoomOpening): Record<string, unknown> {
  return {
    id: opening.id,
    kind: opening.kind,
    wall: opening.wall,
    alongCenterM: openingAlongWallCenter(opening),
    alongWidthM: openingAlongWallSize(opening),
    heightM: opening.height,
    sillM: opening.sillHeight,
    footprint: {
      x: opening.footprint.x,
      z: opening.footprint.z,
      width: opening.footprint.width,
      depth: opening.footprint.depth,
    },
  };
}

/** Success payload for opening mutations: the opening plus refreshed layout. */
function openingMutationOk(opening: RoomOpening): string {
  return toolOk({ opening: openingCard(opening), layout: layoutBlock(useRoomStore.getState()) });
}

/** Change a door/window size: width, height, sill (windows only). */
function resizeOpeningTool(): ModelContextTool {
  return mutationTool(
    'resize_opening',
    'Resize a door or window through the same store action as the UI. alongSize is the along-wall width in meters, height is the opening height, and sillHeight (windows only) is how high the opening\u2019s bottom edge sits above the floor — the window\u2019s vertical position. At least one field is required; doors must keep sillHeight 0 (they sit on the floor). Feasible ranges are wall- and ceiling-dependent: out-of-range values fail with invalid_opening_size (details: field, min, max), widening into another opening on the same wall fails with opening_overlap, unknown ids with opening_not_found. The opening keeps its center. Returns the resized opening (id, kind, wall, alongCenterM, alongWidthM, heightM, sillM, footprint) and refreshed layout validity and issues.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const openingId = readRequiredString(args.value, 'openingId', { maxLength: 80 });
      const alongSize = readOptionalNumber(args.value, 'alongSize');
      const height = readOptionalNumber(args.value, 'height');
      const sillHeight = readOptionalNumber(args.value, 'sillHeight');
      if (!openingId.ok) return toolFail(openingId.code, openingId.message);
      if (!alongSize.ok) return toolFail(alongSize.code, alongSize.message);
      if (!height.ok) return toolFail(height.code, height.message);
      if (!sillHeight.ok) return toolFail(sillHeight.code, sillHeight.message);
      if (alongSize.value === undefined && height.value === undefined && sillHeight.value === undefined) {
        return toolFail('invalid_args', 'Specify at least one of "alongSize", "height", or "sillHeight"');
      }
      const result = useRoomStore.getState().setOpeningDimensions(
        openingId.value,
        {
          ...(alongSize.value !== undefined ? { alongSize: alongSize.value } : {}),
          ...(height.value !== undefined ? { height: height.value } : {}),
          ...(sillHeight.value !== undefined ? { sillHeight: sillHeight.value } : {}),
        },
        'agent',
      );
      if (!result.ok) return resultFail(result);
      return openingMutationOk(result.data.opening);
    },
    {
      type: 'object',
      properties: {
        openingId: {
          type: 'string',
          description: 'Opening id, e.g. "entry-door", "east-window", "balcony-door", or "opening-1" for added ones.',
        },
        alongSize: {
          type: 'number',
          description: 'New along-wall width in meters (x for north/south walls, z for east/west).',
          minimum: 0,
        },
        height: {
          type: 'number',
          description: 'New opening height in meters; the top stays below the ceiling.',
          minimum: 0,
        },
        sillHeight: {
          type: 'number',
          description: 'Windows only: how high the bottom edge sits above the floor (the window vertical position). Doors keep 0.',
          minimum: 0,
        },
      },
      required: ['openingId'],
      additionalProperties: false,
    },
  );
}

/** Re-tag a placed item as already owned or a new marketplace purchase. */
function setItemSourceTool(): ModelContextTool {
  return mutationTool(
    'set_item_source',
    'Re-tag a placed item\u2019s ownership through the same store action as the UI: source "existing" marks it as already owned (never counted toward the budget), source "marketplace" marks it as a new purchase (counted). Locked items may be re-tagged (the lock only guards removal and replacement); setting the current source is a no-op success. Budget pricing and validation refresh in the same write. Returns the item with its source, refreshed pricing (newTotal, budget, remaining, overBudget), and current layout validity and issues. Unknown instances fail with item_not_found.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceId = readRequiredString(args.value, 'instanceId', { maxLength: 80 });
      const source = readRequiredEnum(args.value, 'source', FURNITURE_SOURCES);
      if (!instanceId.ok) return toolFail(instanceId.code, instanceId.message);
      if (!source.ok) return toolFail(source.code, source.message);
      const result = useRoomStore
        .getState()
        .setItemSource(instanceId.value, source.value, 'agent');
      if (!result.ok) return resultFail(result);
      const state = useRoomStore.getState();
      return itemMutationOk(result.data.item, state.getProductById(result.data.item.productId));
    },
    {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance id of the placed item to act on, e.g. "existing-sofa" or "drift-oak-coffee-table-1".',
        },
        source: {
          type: 'string',
          description: '"existing" = already owned (never counted toward the budget); "marketplace" = new purchase (counted).',
          enum: [...FURNITURE_SOURCES],
        },
      },
      required: ['instanceId', 'source'],
      additionalProperties: false,
    },
  );
}

/** Move a door or window along its wall, or onto another wall. */
function moveOpeningTool(): ModelContextTool {
  return mutationTool(
    'move_opening',
    'Move a door or window through the same store action as the UI: alongCenter is the opening\u2019s center along its current wall in room coordinates (x for north/south walls, z for east/west walls); pass wall to relocate the opening onto a different wall (its real size is preserved and the footprint re-orients). Centers are clamped to the wall and moves that would collide with another opening on the target wall fail with opening_overlap; unknown ids fail with opening_not_found and unusable walls or non-finite centers with invalid_opening_position. Clearance validation refreshes immediately. Returns the opening (id, kind, wall, alongCenterM, alongWidthM, heightM, sillM, footprint) and current layout validity and issues.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const openingId = readRequiredString(args.value, 'openingId', { maxLength: 80 });
      const alongCenter = readRequiredNumber(args.value, 'alongCenter');
      const wall = readOptionalEnum(args.value, 'wall', WALL_SIDES);
      if (!openingId.ok) return toolFail(openingId.code, openingId.message);
      if (!alongCenter.ok) return toolFail(alongCenter.code, alongCenter.message);
      if (!wall.ok) return toolFail(wall.code, wall.message);
      const result = useRoomStore
        .getState()
        .setOpeningPosition(openingId.value, alongCenter.value, wall.value, 'agent');
      if (!result.ok) return resultFail(result);
      return openingMutationOk(result.data.opening);
    },
    {
      type: 'object',
      properties: {
        openingId: {
          type: 'string',
          description: 'Opening id, e.g. "entry-door", "east-window", "balcony-door", or "opening-1" for added ones.',
        },
        alongCenter: {
          type: 'number',
          description: 'New along-wall center in meters: x for north/south walls, z for east/west walls. Clamped to the wall.',
        },
        wall: {
          type: 'string',
          description: 'Optional target wall to relocate the opening onto; omit to move along the current wall.',
          enum: [...WALL_SIDES],
        },
      },
      required: ['openingId', 'alongCenter'],
      additionalProperties: false,
    },
  );
}

/** Add a standard door or window to any wall. */
function addOpeningTool(): ModelContextTool {
  return mutationTool(
    'add_opening',
    'Add a standard door (0.9 m wide, 2.1 m high) or window (1.6 m wide, 1.4 m high at a 0.9 m sill) to any wall through the same store action as the UI. Without center, the opening lands in the first free span of the wall; an explicit center is clamped to the wall. Heights are capped below the ceiling automatically. Failures: duplicate_opening_id for taken ids (ids are minted for you), opening_overlap when another opening already occupies the spot, invalid_opening_position when the wall is too short or fully occupied. Clearance validation refreshes immediately. Returns the added opening (id, kind, wall, alongCenterM, alongWidthM, heightM, sillM, footprint) and current layout validity and issues.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const kind = readRequiredEnum(args.value, 'kind', ROOM_OPENING_KINDS);
      const wall = readRequiredEnum(args.value, 'wall', WALL_SIDES);
      const center = readOptionalNumber(args.value, 'center');
      if (!kind.ok) return toolFail(kind.code, kind.message);
      if (!wall.ok) return toolFail(wall.code, wall.message);
      if (!center.ok) return toolFail(center.code, center.message);
      const result = useRoomStore.getState().addOpening(
        {
          kind: kind.value,
          wall: wall.value,
          ...(center.value !== undefined ? { center: center.value } : {}),
        },
        'agent',
      );
      if (!result.ok) return resultFail(result);
      return openingMutationOk(result.data.opening);
    },
    {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'What to add: "door" (0.9 m wide, 2.1 m high) or "window" (1.6 m wide, sill 0.9 m).',
          enum: [...ROOM_OPENING_KINDS],
        },
        wall: {
          type: 'string',
          description: 'Wall to cut the opening into.',
          enum: [...WALL_SIDES],
        },
        center: {
          type: 'number',
          description: 'Optional along-wall center in meters (x for north/south walls, z for east/west). Defaults to the first free span.',
        },
      },
      required: ['kind', 'wall'],
      additionalProperties: false,
    },
  );
}

/** Remove a door or window from the room. */
function removeOpeningTool(): ModelContextTool {
  return mutationTool(
    'remove_opening',
    'Remove a door or window from the room through the same store action as the UI (seeded openings included). Destructive: the opening is permanently gone from the current design; clearance validation refreshes immediately, so furniture that used to block it clears. Unknown ids fail with opening_not_found. Returns the removed opening (id, kind, wall, alongCenterM, alongWidthM, heightM, sillM, footprint) and current layout validity and issues.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const openingId = readRequiredString(args.value, 'openingId', { maxLength: 80 });
      if (!openingId.ok) return toolFail(openingId.code, openingId.message);
      const result = useRoomStore.getState().removeOpening(openingId.value, 'agent');
      if (!result.ok) return resultFail(result);
      return openingMutationOk(result.data.opening);
    },
    {
      type: 'object',
      properties: {
        openingId: {
          type: 'string',
          description: 'Opening id, e.g. "entry-door", "east-window", "balcony-door", or "opening-1" for added ones.',
        },
      },
      required: ['openingId'],
      additionalProperties: false,
    },
    true,
  );
}

/**
 * The complete mutating WebMCP tool surface for the room editor.
 *
 * Tools are stateless: each call reads live store state at execution time
 * and routes through the shared store actions with `origin='agent'`, so the
 * UI, scene, pricing, validation, and activity feed stay in lockstep with
 * the human UI.
 */
export function createMutationTools(): readonly ModelContextTool[] {
  return [
    placeProductTool(),
    moveProductTool(),
    rotateProductTool(),
    setItemElevationTool(),
    removeProductTool(),
    setItemLockedTool(),
    setItemSourceTool(),
    setBudgetTool(),
    setRoomAppearanceTool(),
    resizeRoomTool(),
    moveOpeningTool(),
    addOpeningTool(),
    removeOpeningTool(),
    resizeOpeningTool(),
    replaceProductTool(),
    saveDesignTool(),
    loadDesignTool(),
    addToCartTool(),
    removeCartItemTool(),
  ];
}
