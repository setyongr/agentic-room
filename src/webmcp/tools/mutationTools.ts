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
import type { FurnitureProduct, PlacedFurniture, SerializableError } from '@/domain/types';
import { useRoomStore } from '@/store/roomStore';
import type { RoomStore } from '@/store/roomStore';
import {
  isPlainObject,
  readObjectInput,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readOptionalStringArray,
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
    'Place a product through the same store action as the UI: zoneId centers it in a placement zone (category, capacity, and fit are domain-enforced), or position x/z places it explicitly (unvalidated geometry); optional rotation. Returns the new item, refreshed pricing (newTotal, budget, remaining, overBudget), and current layout validity and issues. Failures (missing/out-of-stock product, unknown/full/incompatible zone) leave the room unchanged.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const productId = readRequiredString(args.value, 'productId', { maxLength: 80 });
      const zoneId = readOptionalString(args.value, 'zoneId', { maxLength: 60 });
      const position = readPositionArg(args.value);
      const rotation = readOptionalNumber(args.value, 'rotation');
      if (!productId.ok) return toolFail(productId.code, productId.message);
      if (!zoneId.ok) return toolFail(zoneId.code, zoneId.message);
      if (!position.ok) return toolFail(position.code, position.message);
      if (!rotation.ok) return toolFail(rotation.code, rotation.message);
      if (zoneId.value === undefined && position.value === undefined) {
        return toolFail('invalid_args', 'Specify either "zoneId" or "position" (an object with x and z) to place the product');
      }
      const result = useRoomStore.getState().placeProduct(
        productId.value,
        {
          ...(zoneId.value !== undefined ? { zoneId: zoneId.value } : {}),
          ...(position.value !== undefined ? { x: position.value.x, z: position.value.z } : {}),
          ...(rotation.value !== undefined ? { rotation: rotation.value } : {}),
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
    'Capture the current design (room, placed items, budget) as a saved snapshot with the given name through the same store action as the UI; saved designs can be restored later with load_design. The live design is unchanged. Returns the snapshot metadata: id, name, creation and update timestamps, budget, item count, marketplace total at save time, and the number of designs saved this session.',
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
    'Restore a design saved earlier this session (see get_saved_designs) through the same store action as the UI, replacing the current room, placed items, and budget. Destructive: the current unsaved design is discarded. Returns the design id and name, restored item count, budget, refreshed marketplace total and remaining, and current layout validity and issues. Unknown ids fail with design_not_found.',
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
    removeProductTool(),
    setItemLockedTool(),
    setBudgetTool(),
    replaceProductTool(),
    saveDesignTool(),
    loadDesignTool(),
    addToCartTool(),
  ];
}
