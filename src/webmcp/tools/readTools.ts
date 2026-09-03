/**
 * Read-only WebMCP tools over the shared room store.
 *
 * Every tool is a deterministic read of live application state routed
 * through the store/domain helpers — never UI scraping, never duplicated
 * algorithms. Inputs are validated at runtime; output is compact JSON
 * (`{success:true,...}` or `{success:false,error,code,...}`). Read actions
 * with observable meaning record one fixed application-level activity entry
 * via the store, never agent reasoning text. All tools are read-only
 * (`readOnlyHint`) and produce only first-party, trusted data
 * (`untrustedContentHint: false`).
 */

import { captureSceneSnapshot } from '@/webmcp/sceneSnapshot';
import { PLANNER_GUIDE_DESCRIPTION, buildPlannerGuide } from '@/webmcp/plannerGuide';
import { MAX_PAGE_SIZE } from '@/domain/catalog';
import { ROOM_SIZE_LIMITS } from '@/domain/resize';
import * as pricing from '@/domain/pricing';
import type {
  FurnitureProduct,
  PlacementZone,
  PlacedFurniture,
  PriceItem,
  SearchFilters,
  ValidationIssue,
} from '@/domain/types';
import { FURNITURE_CATEGORIES, SEARCH_SORTS } from '@/domain/types';
import { useRoomStore } from '@/store/roomStore';
import {
  readObjectInput,
  readOptionalBoolean,
  readOptionalEnum,
  readOptionalNumber,
  readOptionalString,
  readOptionalStringArray,
  readRequiredEnum,
  readRequiredString,
  toolFail,
  toolOk,
} from '@/webmcp/serialize';
import type { ModelContextJsonSchema, ModelContextTool } from '@/webmcp/types';

/** Cap on list/issue arrays in tool output so results stay concise. */
export const MAX_LIST_ITEMS = 25;

/** Default search page size (agents read compact pages). */
const SEARCH_PAGE_SIZE = 10;

/** Upper bound for the search page size accepted from callers. */
const SEARCH_PAGE_SIZE_MAX = 25;

/**
 * Build one read tool: read-only annotations, an object input schema
 * (empty by default), and the given execute callback.
 */
function readTool(
  name: string,
  description: string,
  execute: ModelContextTool['execute'],
  inputSchema: ModelContextJsonSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
): ModelContextTool {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute,
  };
}

/** Condensed validation issues, capped for concise deterministic output. */
export function condenseIssues(
  issues: readonly ValidationIssue[],
): { issues: readonly Record<string, unknown>[]; truncated: boolean } {
  const truncated = issues.length > MAX_LIST_ITEMS;
  const out: Record<string, unknown>[] = [];
  for (const issue of issues.slice(0, MAX_LIST_ITEMS)) {
    const entry: Record<string, unknown> = {
      kind: issue.kind,
      severity: issue.severity,
      message: issue.message,
      instanceIds: issue.instanceIds,
    };
    if (issue.refId !== undefined) entry.refId = issue.refId;
    if (issue.footprint !== undefined) {
      entry.footprint = {
        x: issue.footprint.x,
        z: issue.footprint.z,
        width: issue.footprint.width,
        depth: issue.footprint.depth,
      };
    }
    if ('productIds' in issue) entry.productIds = issue.productIds;
    if ('budget' in issue) entry.budget = issue.budget;
    if ('total' in issue) entry.total = issue.total;
    out.push(entry);
  }
  return { issues: out, truncated };
}

/** Truncation marker for capped lists, emitted only when something was cut. */
export function truncatedFlag(truncated: boolean): Record<string, unknown> {
  return truncated ? { truncated: true } : {};
}

/** Concise catalog card for a search result. */
function productCard(product: FurnitureProduct): Record<string, unknown> {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    width: product.width,
    depth: product.depth,
    height: product.height,
    styleTags: product.styleTags,
    colors: product.colors,
    material: product.material,
    stock: product.stock,
  };
}

/** Concise card for one placed item: identity, name, category, dimensions, budget-relevant price, geometry, locks, source. */
export function placedItemCard(
  item: PlacedFurniture,
  product: FurnitureProduct | undefined,
): Record<string, unknown> {
  return {
    instanceId: item.instanceId,
    productId: item.productId,
    name: product?.name ?? item.productId,
    ...(product === undefined
      ? {}
      : {
          category: product.category,
          width: product.width,
          depth: product.depth,
          height: product.height,
        }),
    // Existing items never count toward the budget; marketplace items count at catalog price.
    budgetPrice: item.source === 'existing' ? 0 : (product?.price ?? 0),
    position: { x: item.position.x, y: item.position.y, z: item.position.z },
    rotation: item.rotation,
    locked: item.locked,
    source: item.source,
    variant: { color: item.variant.color, material: item.variant.material },
  };
}

/** Concise card for a placement zone (footprint plus category/occupancy rules). */
function zoneCard(zone: PlacementZone): Record<string, unknown> {
  return {
    id: zone.id,
    name: zone.name,
    kind: zone.kind,
    footprint: {
      x: zone.footprint.x,
      z: zone.footprint.z,
      width: zone.footprint.width,
      depth: zone.footprint.depth,
    },
    ...(zone.allowedCategories !== undefined ? { allowedCategories: zone.allowedCategories } : {}),
    ...(zone.maxItems !== undefined ? { maxItems: zone.maxItems } : {}),
  };
}

/** Concise line of the price breakdown for one placed instance. */
function priceLineCard(line: PriceItem): Record<string, unknown> {
  return {
    instanceId: line.instanceId,
    productId: line.productId,
    name: line.name,
    category: line.category,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    source: line.source,
    locked: line.locked,
  };
}

/** Full current room state: geometry, openings, items, budget, pricing, validation. */
function getRoomStateTool(): ModelContextTool {
  return readTool(
    'get_room_state',
    'Read the current room state: room dimensions, wall openings (doors and windows with footprints), the room appearance (wall finish, floor finish, wallpaper), every placed furniture item with its id, name, category, dimensions, position, rotation, lock and source flags, budget-relevant price, and chosen color and material variant, the design budget, live pricing totals, and layout validation issues. When a design was saved this session, its name is included. Deterministic; never mutates state.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const state = useRoomStore.getState();
      const issues = condenseIssues(state.validation.issues);
      state.recordAgentActivity({ type: 'room_inspected' });
      return toolOk({
        room: {
          dimensions: {
            width: state.room.dimensions.width,
            depth: state.room.dimensions.depth,
            height: state.room.dimensions.height,
          },
          resizeLimits: ROOM_SIZE_LIMITS,
          openings: state.room.openings.map((opening) => ({
            id: opening.id,
            kind: opening.kind,
            wall: opening.wall,
            footprint: {
              x: opening.footprint.x,
              z: opening.footprint.z,
              width: opening.footprint.width,
              depth: opening.footprint.depth,
            },
            height: opening.height,
            sillHeight: opening.sillHeight,
          })),
        },
        appearance: {
          wallFinishId: state.roomAppearance.wallFinishId,
          floorFinishId: state.roomAppearance.floorFinishId,
          wallpaperId: state.roomAppearance.wallpaperId,
        },
        items: state.furniture.map((item) =>
          placedItemCard(item, state.getProductById(item.productId)),
        ),
        budget: state.budget,
        pricing: {
          newTotal: state.pricing.newTotal,
          existingTotal: state.pricing.existingTotal,
          grandTotal: state.pricing.grandTotal,
          remaining: state.pricing.remaining,
          overBudget: state.pricing.overBudget,
        },
        validation: {
          valid: state.validation.valid,
          issueCount: state.validation.issues.length,
          ...truncatedFlag(issues.truncated),
          issues: issues.issues,
        },
        ...(state.savedDesigns.length > 0
          ? { savedDesignName: state.savedDesigns[state.savedDesigns.length - 1].name }
          : {}),
      });
    },
  );
}

/** Zones that accept a category and still have capacity in the live room. */
function getAvailablePlacementZonesTool(): ModelContextTool {
  return readTool(
    'get_available_placement_zones',
    'List the room\u2019s placement zones that currently accept the given furniture category and still have free capacity. Each zone reports its footprint, allowed categories, current occupancy, and remaining slots, so a product can be routed to a valid destination before placing it. Deterministic read; records a zone inspection in the activity feed.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const category = readRequiredEnum(args.value, 'category', FURNITURE_CATEGORIES);
      if (!category.ok) return toolFail(category.code, category.message);
      const state = useRoomStore.getState();
      const result = state.getAvailablePlacementZones(category.value);
      if (!result.ok) return toolFail(result.code, result.message);
      state.recordAgentActivity({ type: 'zones_inspected', category: category.value });
      return toolOk({
        category: category.value,
        zones: result.data.zones.map((entry) => ({
          ...zoneCard(entry.zone),
          occupied: entry.occupied,
          remaining: entry.remaining,
        })),
      });
    },
    {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Furniture category to place; zones must allow it and have free capacity.',
          enum: [...FURNITURE_CATEGORIES],
        },
      },
      required: ['category'],
      additionalProperties: false,
    },
  );
}

/** Marketplace search with filters, dimension window, deterministic sort and paging. */
function searchProductsTool(): ModelContextTool {
  return readTool(
    'search_products',
    'Search the marketplace catalog by free-text query, category, style tags, colors, materials, price range, stock availability, and maximum width/depth footprint, with deterministic sorting and pagination. Results carry price, dimensions, style tags, colors, material, and stock. Use this before placing a product. Deterministic read; records the search in the activity feed.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const query = readOptionalString(args.value, 'query', { maxLength: 120 });
      const category = readOptionalEnum(args.value, 'category', FURNITURE_CATEGORIES);
      const styles = readOptionalStringArray(args.value, 'styles', { maxLength: 20 });
      const colors = readOptionalStringArray(args.value, 'colors', { maxLength: 20 });
      const materials = readOptionalStringArray(args.value, 'materials', { maxLength: 20 });
      const minPrice = readOptionalNumber(args.value, 'minPrice', { min: 0 });
      const maxPrice = readOptionalNumber(args.value, 'maxPrice', { min: 0 });
      const inStockOnly = readOptionalBoolean(args.value, 'inStockOnly');
      const sort = readOptionalEnum(args.value, 'sort', SEARCH_SORTS);
      const maxWidth = readOptionalNumber(args.value, 'maxWidth', { min: 0 });
      const maxDepth = readOptionalNumber(args.value, 'maxDepth', { min: 0 });
      const page = readOptionalNumber(args.value, 'page', { min: 1, integer: true });
      const pageSize = readOptionalNumber(args.value, 'pageSize', {
        min: 1,
        max: SEARCH_PAGE_SIZE_MAX,
        integer: true,
      });
      if (!query.ok) return toolFail(query.code, query.message);
      if (!category.ok) return toolFail(category.code, category.message);
      if (!styles.ok) return toolFail(styles.code, styles.message);
      if (!colors.ok) return toolFail(colors.code, colors.message);
      if (!materials.ok) return toolFail(materials.code, materials.message);
      if (!minPrice.ok) return toolFail(minPrice.code, minPrice.message);
      if (!maxPrice.ok) return toolFail(maxPrice.code, maxPrice.message);
      if (!inStockOnly.ok) return toolFail(inStockOnly.code, inStockOnly.message);
      if (!sort.ok) return toolFail(sort.code, sort.message);
      if (!maxWidth.ok) return toolFail(maxWidth.code, maxWidth.message);
      if (!maxDepth.ok) return toolFail(maxDepth.code, maxDepth.message);
      if (!page.ok) return toolFail(page.code, page.message);
      if (!pageSize.ok) return toolFail(pageSize.code, pageSize.message);

      const filters: SearchFilters = {};
      if (query.value !== undefined) filters.query = query.value;
      if (category.value !== undefined) filters.categories = [category.value];
      if (styles.value !== undefined) filters.styles = styles.value;
      if (colors.value !== undefined) filters.colors = colors.value;
      if (materials.value !== undefined) filters.materials = materials.value;
      if (minPrice.value !== undefined) filters.minPrice = minPrice.value;
      if (maxPrice.value !== undefined) filters.maxPrice = maxPrice.value;
      if (inStockOnly.value !== undefined) filters.inStockOnly = inStockOnly.value;
      if (sort.value !== undefined) filters.sort = sort.value;

      const state = useRoomStore.getState();
      // The domain search has no width/depth filters, so fetch the full
      // filtered set (domain pages) and apply the dimension window here.
      // Only the first call records the search; continuation pages stay
      // silent so one search produces exactly one feed entry.
      const first = state.searchProducts(
        { filters, page: 1, pageSize: MAX_PAGE_SIZE },
        'agent',
      );
      let matches: FurnitureProduct[] = [...first.products];
      const lastPage = Math.max(1, Math.ceil(first.total / first.pageSize));
      for (let pageNumber = 2; pageNumber <= lastPage; pageNumber += 1) {
        const more = state.searchProducts(
          { filters, page: pageNumber, pageSize: MAX_PAGE_SIZE },
          'human',
        );
        matches = matches.concat(more.products);
      }
      if (maxWidth.value !== undefined || maxDepth.value !== undefined) {
        matches = matches.filter(
          (product) =>
            (maxWidth.value === undefined || product.width <= maxWidth.value) &&
            (maxDepth.value === undefined || product.depth <= maxDepth.value),
        );
      }

      const resultPageSize = pageSize.value ?? SEARCH_PAGE_SIZE;
      const total = matches.length;
      const resultPage = Math.min(page.value ?? 1, Math.max(1, Math.ceil(total / resultPageSize)));
      const start = (resultPage - 1) * resultPageSize;
      return toolOk({
        total,
        page: resultPage,
        pageSize: resultPageSize,
        products: matches.slice(start, start + resultPageSize).map(productCard),
      });
    },
    {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text query matched against product name, material, and style tags.',
        },
        category: {
          type: 'string',
          description: 'Only products of this furniture category.',
          enum: [...FURNITURE_CATEGORIES],
        },
        styles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only products carrying any of these style tags (e.g. "scandinavian").',
        },
        colors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only products offering any of these colors (e.g. "oak", "charcoal").',
        },
        materials: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only products made of any of these materials (e.g. "oak", "linen").',
        },
        minPrice: {
          type: 'number',
          description: 'Inclusive lower price bound in USD.',
        },
        maxPrice: {
          type: 'number',
          description: 'Inclusive upper price bound in USD.',
        },
        inStockOnly: {
          type: 'boolean',
          description: 'When true, only products with stock greater than zero.',
        },
        sort: {
          type: 'string',
          description: 'Deterministic result ordering.',
          enum: [...SEARCH_SORTS],
        },
        maxWidth: {
          type: 'number',
          description: 'Only products whose width in meters is at most this value.',
        },
        maxDepth: {
          type: 'number',
          description: 'Only products whose depth in meters is at most this value.',
        },
        page: {
          type: 'integer',
          description: '1-based page number; clamps to the last page.',
        },
        pageSize: {
          type: 'integer',
          description: 'Results per page, at most 25 (default 10).',
        },
      },
      additionalProperties: false,
    },
  );
}

/** One catalog product with full details and its current placements. */
function getProductTool(): ModelContextTool {
  return readTool(
    'get_product',
    'Fetch one marketplace product by id with its full catalog details: category, price, width/depth/height in meters, style tags, colors, material, stock, and default rotation, plus the placed instances currently using it in the room. Unknown ids fail with code "missing_product". Deterministic read; records the product view in the activity feed.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const productId = readRequiredString(args.value, 'productId', { maxLength: 80 });
      if (!productId.ok) return toolFail(productId.code, productId.message);
      const state = useRoomStore.getState();
      const product = state.getProductById(productId.value);
      if (product === undefined) {
        return toolFail('missing_product', `No catalog product with id "${productId.value}"`, {
          productId: productId.value,
        });
      }
      state.recordAgentActivity({ type: 'product_viewed', productId: productId.value });
      const compatibleZones = state.getCompatiblePlacementZones(product.category);
      return toolOk({
        product: {
          id: product.id,
          name: product.name,
          category: product.category,
          price: product.price,
          width: product.width,
          depth: product.depth,
          height: product.height,
          styleTags: product.styleTags,
          colors: product.colors,
          material: product.material,
          stock: product.stock,
          ...(product.defaultRotation !== undefined
            ? { defaultRotation: product.defaultRotation }
            : {}),
          ...(product.thumbnailGradient !== undefined
            ? { thumbnailGradient: product.thumbnailGradient }
            : {}),
        },
        compatiblePlacementZones: compatibleZones.ok
          ? compatibleZones.data.zones.map((entry) => ({
              id: entry.zone.id,
              name: entry.zone.name,
              kind: entry.zone.kind,
            }))
          : [],
        placedInstanceIds: state.furniture
          .filter((item) => item.productId === product.id)
          .map((item) => item.instanceId),
      });
    },
    {
      type: 'object',
      properties: {
        productId: {
          type: 'string',
          description: 'Stable catalog product id, e.g. "fjord-3-seat-sofa".',
        },
      },
      required: ['productId'],
      additionalProperties: false,
    },
  );
}

/** Re-run layout validation against the live room, items, and budget. */
function checkLayoutTool(): ModelContextTool {
  return readTool(
    'check_layout',
    'Re-run layout validation against the live room, placed items, and budget: room bounds, furniture overlaps, opening clearance, zone compatibility and membership, budget, stock, and catalog integrity. Returns whether the design is valid plus every issue with its kind, severity, message, and affected instance ids. Deterministic read; records the layout check in the activity feed.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const result = useRoomStore.getState().checkLayout('agent');
      const issues = condenseIssues(result.issues);
      return toolOk({
        valid: result.valid,
        issueCount: result.issues.length,
        ...truncatedFlag(issues.truncated),
        issues: issues.issues,
      });
    },
  );
}

/** Recompute the full budget breakdown of the current design. */
function calculateTotalTool(): ModelContextTool {
  return readTool(
    'calculate_total',
    'Recompute the full budget breakdown of the current design: marketplace and existing subtotals, grand total, budget, signed remaining, over-budget flag, and one line per placed item with unit price, line total, source, and lock state. Deterministic read; records the calculation in the activity feed.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const result = useRoomStore.getState().calculateTotal('agent');
      const truncated = result.items.length > MAX_LIST_ITEMS;
      return toolOk({
        newTotal: result.newTotal,
        existingTotal: result.existingTotal,
        grandTotal: result.grandTotal,
        budget: result.budget,
        remaining: result.remaining,
        overBudget: result.overBudget,
        itemCount: result.items.length,
        ...truncatedFlag(truncated),
        items: result.items.slice(0, MAX_LIST_ITEMS).map(priceLineCard),
      });
    },
  );
}

/** Budget pressure of the live design, with replaceable marketplace items. */
function getBudgetPressureTool(): ModelContextTool {
  return readTool(
    'get_budget_pressure',
    'Report the budget pressure of the current design: under/at/over-budget status, signed remaining, amount over, and the replaceable marketplace items sorted by price (most expensive first) to inform budget-rescue tradeoffs. Deterministic read of the live design; never mutates state.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const result = useRoomStore.getState().getBudgetPressure();
      useRoomStore.getState().recordAgentActivity({ type: 'budget_pressure_checked' });
      const truncated = result.replaceable.length > MAX_LIST_ITEMS;
      return toolOk({
        status: result.status,
        remaining: result.remaining,
        amountOver: result.amountOver,
        replaceableCount: result.replaceable.length,
        ...truncatedFlag(truncated),
        replaceable: result.replaceable.slice(0, MAX_LIST_ITEMS).map((line) => ({
          instanceId: line.instanceId,
          productId: line.productId,
          name: line.name,
          category: line.category,
          unitPrice: line.unitPrice,
          locked: line.locked,
        })),
      });
    },
  );
}

/** Cheaper same-category replacement suggestions for one placed item. */
function findCheaperAlternativesTool(): ModelContextTool {
  return readTool(
    'find_cheaper_alternatives',
    'Suggest cheaper same-category replacements for one placed marketplace item. The instance must exist, be marketplace-sourced, and not be locked. Candidates are strictly cheaper and in stock, optionally capped by targetPrice, ranked by style, color, material, and dimension compatibility, then by savings. Returns savings and compatibility scores per candidate. Deterministic; records the suggestion in the activity feed.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const instanceId = readRequiredString(args.value, 'instanceId', { maxLength: 80 });
      const targetPrice = readOptionalNumber(args.value, 'targetPrice', { min: 0 });
      const maxResults = readOptionalNumber(args.value, 'maxResults', {
        min: 1,
        max: 20,
        integer: true,
      });
      if (!instanceId.ok) return toolFail(instanceId.code, instanceId.message);
      if (!targetPrice.ok) return toolFail(targetPrice.code, targetPrice.message);
      if (!maxResults.ok) return toolFail(maxResults.code, maxResults.message);
      const result = useRoomStore.getState().findCheaperAlternatives(
        instanceId.value,
        {
          ...(targetPrice.value !== undefined ? { targetPrice: targetPrice.value } : {}),
          ...(maxResults.value !== undefined ? { maxResults: maxResults.value } : {}),
        },
        'agent',
      );
      if (!result.ok) return toolFail(result.code, result.message, result.details);
      return toolOk({
        instanceId: result.data.instanceId,
        totalSavings: result.data.totalSavings,
        alternatives: result.data.alternatives.map((alternative) => ({
          instanceId: alternative.instanceId,
          currentProductId: alternative.currentProductId,
          currentProductName: alternative.currentProductName,
          currentPrice: alternative.currentPrice,
          alternativeProductId: alternative.alternativeProductId,
          alternativeProductName: alternative.alternativeProductName,
          alternativePrice: alternative.alternativePrice,
          savings: alternative.savings,
          styleCompatibility: alternative.styleCompatibility,
          dimensionCompatibility: alternative.dimensionCompatibility,
        })),
      });
    },
    {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Placed instance to find replacements for (marketplace, unlocked).',
        },
        targetPrice: {
          type: 'number',
          description: 'Inclusive upper bound on the replacement price in USD.',
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum number of candidates to return (1-20, default 5).',
        },
      },
      required: ['instanceId'],
      additionalProperties: false,
    },
  );
}

/** Designs saved during this session, with budget and total at save time. */
function getSavedDesignsTool(): ModelContextTool {
  return readTool(
    'get_saved_designs',
    'List the designs saved during this session, newest first, with each snapshot\u2019s budget, placed-item count, marketplace total, and room appearance at save time. Deterministic read of session state; never mutates state.',
    (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const state = useRoomStore.getState();
      const savedDesigns = state.savedDesigns;
      state.recordAgentActivity({ type: 'designs_inspected' });
      const truncated = savedDesigns.length > MAX_LIST_ITEMS;
      return toolOk({
        designCount: savedDesigns.length,
        ...truncatedFlag(truncated),
        designs: savedDesigns.slice(-MAX_LIST_ITEMS).reverse().map((design) => ({
          id: design.id,
          name: design.name,
          createdAt: design.createdAt,
          updatedAt: design.updatedAt,
          budget: design.budget,
          itemCount: design.items.length,
          total: pricing.calculateTotal(design.items, design.budget).newTotal,
          appearance: {
            wallFinishId: design.appearance.wallFinishId,
            floorFinishId: design.appearance.floorFinishId,
            wallpaperId: design.appearance.wallpaperId,
          },
        })),
      });
    },
  );
}

/** Render the live 3D room to a JPEG image so vision-capable agents can judge aesthetics. */
function renderSceneSnapshotTool(): ModelContextTool {
  const VIEWS = ['live', 'orbit', 'top', 'front', 'side'] as const;
  return readTool(
    'render_scene_snapshot',
    'Render the current 3D room to a JPEG image (data URL) so the arrangement can be judged visually. view presets: “live” uses the editor camera exactly as last left; “orbit”/“top”/“front”/“side” frame the standard room overviews without moving the user’s camera. Returns the image as a data: URL with pixel dimensions; output is downscaled to maxWidth. Only the 3D canvas is captured — UI panels, overlays, and text are never included. Deterministic; never mutates state.',
    async (input) => {
      const args = readObjectInput(input);
      if (!args.ok) return toolFail(args.code, args.message);
      const view = readOptionalEnum(args.value, 'view', VIEWS);
      const maxWidth = readOptionalNumber(args.value, 'maxWidth', { min: 256, max: 2048, integer: true });
      if (!view.ok) return toolFail(view.code, view.message);
      if (!maxWidth.ok) return toolFail(maxWidth.code, maxWidth.message);
      const result = await captureSceneSnapshot({
        view: view.value ?? 'live',
        maxWidth: maxWidth.value ?? 1024,
        quality: 0.85,
      });
      if (!result.ok) return toolFail(result.code, result.message);
      return toolOk({
        format: 'image/jpeg',
        view: result.view,
        width: result.width,
        height: result.height,
        dataUrl: result.dataUrl,
        note: 'Pass the dataUrl to a vision-capable model to judge the visual result.',
      });
    },
    {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          enum: [...VIEWS],
          description: 'Which camera view to render (“live” = current editor camera).',
        },
        maxWidth: {
          type: 'integer',
          description: 'Output width cap in pixels (256-2048, default 1024); height keeps the canvas aspect.',
        },
      },
      additionalProperties: false,
    },
  );
}
/** Orient an agent on the site before it starts changing the room. */
function getPlannerGuideTool(): ModelContextTool {
  return readTool('get_planner_guide', PLANNER_GUIDE_DESCRIPTION, () => toolOk({ guide: buildPlannerGuide() }));
}

/**
 * The complete read-only WebMCP tool surface for the room editor.
 *
 * Tools are stateless: each call reads live store state at execution time,
 * so the returned array can be created per registration and never caches
 * stale data.
 */
export function createReadTools(): readonly ModelContextTool[] {
  return [
    getPlannerGuideTool(),
    getRoomStateTool(),
    getAvailablePlacementZonesTool(),
    searchProductsTool(),
    getProductTool(),
    checkLayoutTool(),
    calculateTotalTool(),
    getBudgetPressureTool(),
    findCheaperAlternativesTool(),
    getSavedDesignsTool(),
    renderSceneSnapshotTool(),
  ];
}
