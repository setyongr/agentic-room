/**
 * Shared domain contract for the living-room marketplace/demo.
 *
 * Every type in this file is JSON-serializable: no Date/Map/Set/class
 * instances, no functions, no `any`/`unknown`. Timestamps are ISO 8601
 * strings. Consumers never need `any`/`unknown` to express any concept
 * declared here.
 *
 * Room coordinates are centered on the room: x spans [-width/2, +width/2],
 * z spans [-depth/2, +depth/2], with y up from the floor.
 */

/* ------------------------------------------------------------------ */
/* Stable enumerations                                                 */
/* ------------------------------------------------------------------ */

/** Stable furniture category identifiers, shared by catalog, marketplace, seeds, and filters. */
export const FURNITURE_CATEGORIES = [
  'sofa',
  'armchair',
  'accent_chair',
  'coffee_table',
  'side_table',
  'console',
  'floor_lamp',
  'table_lamp',
  'rug',
  'shelf',
  'cabinet',
  'storage',
  'plant',
  'curtain',
  'decor',
] as const;

/** Furniture category identifier. */
export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number];

/** Whether a placed item was already in the room or was added from the marketplace. */
export const FURNITURE_SOURCES = ['existing', 'marketplace'] as const;

/** Provenance of a placed furniture item. */
export type FurnitureSource = (typeof FURNITURE_SOURCES)[number];

/**
 * The four walls of the room in the centered coordinate system:
 * north wall at z = -depth/2, south at z = +depth/2,
 * west at x = -width/2, east at x = +width/2.
 */
export const WALL_SIDES = ['north', 'south', 'east', 'west'] as const;

/** Wall a room opening is cut into. */
export type WallSide = (typeof WALL_SIDES)[number];

export const ROOM_OPENING_KINDS = ['door', 'window'] as const;

/** Kind of a room opening. */
export type RoomOpeningKind = (typeof ROOM_OPENING_KINDS)[number];

export const PLACEMENT_ZONE_KINDS = [
  'general',
  'seating',
  'media',
  'entry',
  'window',
  'storage',
] as const;

/** Functional kind of a placement zone. */
export type PlacementZoneKind = (typeof PLACEMENT_ZONE_KINDS)[number];

export const VALIDATION_SEVERITIES = ['error', 'warning'] as const;

/** Severity of a validation issue. */
export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number];

export const VALIDATION_ISSUE_KINDS = [
  'out_of_bounds',
  'overlap',
  'blocks_opening',
  'zone_mismatch',
  'outside_zone',
  'budget_exceeded',
  'out_of_stock',
  'missing_product',
] as const;

/** Discriminant of a validation issue. */
export type ValidationIssueKind = (typeof VALIDATION_ISSUE_KINDS)[number];

export const SEARCH_SORTS = ['relevance', 'price_asc', 'price_desc', 'name_asc', 'name_desc'] as const;

/** Sort order for marketplace product search. */
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const CAMERA_MODES = ['orbit', 'top', 'front', 'side'] as const;

/** View mode of the 3D room editor. */
export type CameraMode = (typeof CAMERA_MODES)[number];

export const ACTIVITY_TYPES = [
  'room_inspected',
  'products_searched',
  'layout_checked',
  'total_calculated',
  'alternatives_found',
  'item_added',
  'item_moved',
  'item_rotated',
  'item_removed',
  'item_replaced',
  'item_locked',
  'item_unlocked',
  'design_saved',
  'design_restored',
  'cart_item_added',
  'checkout_completed',
  'budget_updated',
] as const;

/** Kind of an activity feed entry. */
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const CART_STATUSES = ['active', 'checked_out'] as const;

/** Lifecycle status of a cart. */
export type CartStatus = (typeof CART_STATUSES)[number];

/* ------------------------------------------------------------------ */
/* Dimensions, vectors, footprints                                     */
/* ------------------------------------------------------------------ */

/** Axis-aligned extents in meters: width (x), depth (z), height (y). */
export interface Size3 {
  /** extent along the x axis (meters) */
  width: number;
  /** extent along the z axis (meters) */
  depth: number;
  /** extent along the y axis (meters) */
  height: number;
}

/** World-space position in meters, room coordinates centered at x = 0, z = 0. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** x/z-centered axis-aligned rectangular footprint on the floor plane. */
export interface RectFootprint {
  /** center x in room coordinates (meters) */
  x: number;
  /** center z in room coordinates (meters) */
  z: number;
  /** extent along the x axis (meters) */
  width: number;
  /** extent along the z axis (meters) */
  depth: number;
}

/** Room dimensions in meters; the demo room is 6 × 4.5 × 2.8 m. */
export interface RoomDimensions extends Size3 {}

/** Canonical demo room dimensions: 6 m wide (x), 4.5 m deep (z), 2.8 m tall (y). */
export const DEFAULT_ROOM_DIMENSIONS: RoomDimensions = {
  width: 6,
  depth: 4.5,
  height: 2.8,
};

/* ------------------------------------------------------------------ */
/* Catalog / marketplace products                                      */
/* ------------------------------------------------------------------ */

/**
 * A furniture product from the catalog or marketplace.
 * Width/depth/height are the axis-aligned bounding extents in meters.
 */
export interface FurnitureProduct {
  /** stable product identifier */
  id: string;
  name: string;
  category: FurnitureCategory;
  /** catalog price in USD; existing placed items never count toward the budget */
  price: number;
  /** extent along the x axis (meters) */
  width: number;
  /** extent along the z axis (meters) */
  depth: number;
  /** extent along the y axis (meters) */
  height: number;
  /** design style tags, e.g. "scandinavian", "mid-century" */
  styleTags: readonly string[];
  /** available color names, e.g. "oak", "charcoal" */
  colors: readonly string[];
  /** primary material, e.g. "oak", "linen" */
  material: string;
  /** units available; 0 = out of stock */
  stock: number;
  /** default yaw rotation in degrees applied when first placed */
  defaultRotation?: number;
  /** CSS gradient string used as a thumbnail placeholder, e.g. "linear-gradient(...)" */
  thumbnailGradient?: string;
}

/* ------------------------------------------------------------------ */
/* Placed furniture                                                    */
/* ------------------------------------------------------------------ */

/** A product instance placed in the room. */
export interface PlacedFurniture {
  /** unique instance id across the current design */
  instanceId: string;
  /** the catalog product this instance renders */
  productId: string;
  /**
   * Position in room coordinates (meters): x/z are the footprint center,
   * y is the floor-base elevation (0 for items resting on the floor).
   */
  position: Vec3;
  /** yaw rotation in degrees around the y axis */
  rotation: number;
  /** locked items cannot be removed or replaced; moving and rotating remain available */
  locked: boolean;
  /** existing = part of the room from the start; marketplace = added by the user */
  source: FurnitureSource;
}

/* ------------------------------------------------------------------ */
/* Room: openings, placement zones, room data                          */
/* ------------------------------------------------------------------ */

/**
 * A wall opening (door or window). The footprint is x/z-centered:
 * its width runs along the wall, its depth is the wall thickness.
 */
export interface RoomOpening {
  /** stable opening id */
  id: string;
  kind: RoomOpeningKind;
  /** wall the opening is cut into */
  wall: WallSide;
  /** x/z-centered rectangular footprint in room coordinates */
  footprint: RectFootprint;
  /** opening height above the floor (meters) */
  height: number;
  /** distance of the opening's bottom edge above the floor (meters); 0 for doors */
  sillHeight: number;
}

/** A floor region items may be placed in. The footprint is x/z-centered. */
export interface PlacementZone {
  /** stable zone id */
  id: string;
  kind: PlacementZoneKind;
  /** human-readable name */
  name: string;
  /** x/z-centered rectangular footprint in room coordinates */
  footprint: RectFootprint;
  /** categories permitted in this zone; empty or absent = any category */
  allowedCategories?: readonly FurnitureCategory[];
  /** maximum number of placed items in this zone; absent = unlimited */
  maxItems?: number;
  /** optional deterministic suggestion priority; lower numbers are preferred */
  rank?: number;
  /** optional concise placement guidance exposed to agents and saved designs */
  hint?: string;
}

/** Static geometry of the room, shared by the editor, validation, and snapshots. */
export interface RoomData {
  dimensions: RoomDimensions;
  /** wall openings (doors, windows) */
  openings: readonly RoomOpening[];
  /** regions where items may be placed */
  placementZones: readonly PlacementZone[];
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

interface ValidationIssueBase {
  /** human-readable description */
  message: string;
  /** placed instances the issue refers to */
  instanceIds: readonly string[];
  /** zone or opening id when the issue references one */
  refId?: string;
  /** affected area when the issue is geometric */
  footprint?: RectFootprint;
}

/** A problem found while validating a design. Discriminated on `kind`. */
export type ValidationIssue =
  | (ValidationIssueBase & {
      kind: 'out_of_bounds';
      severity: 'error';
      footprint: RectFootprint;
    })
  | (ValidationIssueBase & {
      kind: 'overlap';
      severity: 'warning';
      footprint: RectFootprint;
    })
  | (ValidationIssueBase & {
      kind: 'blocks_opening';
      severity: 'error';
      refId: string;
      footprint: RectFootprint;
    })
  | (ValidationIssueBase & {
      kind: 'zone_mismatch';
      severity: 'warning';
      refId: string;
    })
  | (ValidationIssueBase & {
      kind: 'outside_zone';
      severity: 'warning';
    })
  | (ValidationIssueBase & {
      kind: 'budget_exceeded';
      severity: 'error';
      /** the budget the design was validated against */
      budget: number;
      /** the marketplace total that exceeded it */
      total: number;
    })
  | (ValidationIssueBase & {
      kind: 'out_of_stock';
      severity: 'error';
      /** products with no stock left */
      productIds: readonly string[];
    })
  | (ValidationIssueBase & {
      kind: 'missing_product';
      severity: 'error';
      /** products referenced by placed items but absent from the catalog */
      productIds: readonly string[];
    });

/** Outcome of validating a design against the room and budget. */
export interface ValidationResult {
  /** true when no issue has severity "error" */
  valid: boolean;
  issues: readonly ValidationIssue[];
}

/* ------------------------------------------------------------------ */
/* Budget / pricing                                                    */
/* ------------------------------------------------------------------ */

/** One line of the price breakdown: a single placed instance. */
export interface PriceItem {
  /** placed furniture instance */
  instanceId: string;
  productId: string;
  /** product name snapshot (stable even if the catalog changes) */
  name: string;
  category: FurnitureCategory;
  /** catalog price in USD */
  unitPrice: number;
  quantity: number;
  /** unitPrice * quantity */
  lineTotal: number;
  source: FurnitureSource;
  locked: boolean;
}

/** Full budget breakdown of the current design. */
export interface PriceSummary {
  /** one line per placed item, existing and marketplace alike */
  items: readonly PriceItem[];
  /** sum of marketplace-sourced lines — the only total counted against the budget */
  newTotal: number;
  /** sum of pre-existing lines; never counts toward the budget */
  existingTotal: number;
  /** newTotal + existingTotal */
  grandTotal: number;
  /** current budget in USD */
  budget: number;
  /** budget - newTotal */
  remaining: number;
  /** true when newTotal exceeds budget */
  overBudget: boolean;
}

/* ------------------------------------------------------------------ */
/* Search & cheaper alternatives                                       */
/* ------------------------------------------------------------------ */

/** Filter/sort options for marketplace product search. Absent fields = no constraint. */
export interface SearchFilters {
  /** free-text query matched against name, material, and style tags */
  query?: string;
  /** only these categories */
  categories?: readonly FurnitureCategory[];
  /** only products carrying any of these style tags */
  styles?: readonly string[];
  /** only products offering any of these colors */
  colors?: readonly string[];
  /** only products made of any of these materials */
  materials?: readonly string[];
  /** inclusive lower price bound */
  minPrice?: number;
  /** inclusive upper price bound */
  maxPrice?: number;
  /** only products with stock > 0 */
  inStockOnly?: boolean;
  sort?: SearchSort;
}

/** Payload for a marketplace search tool call. */
export interface SearchProductsArgs {
  filters: SearchFilters;
  /** 1-based page number */
  page?: number;
  pageSize?: number;
}

/** Paged result of a marketplace product search. */
export interface SearchProductsResult {
  products: readonly FurnitureProduct[];
  /** total matches across all pages */
  total: number;
  page: number;
  pageSize: number;
}

/** A cheaper replacement for one placed marketplace item. */
export interface CheaperAlternative {
  /** placed instance to replace */
  instanceId: string;
  /** product currently placed */
  currentProductId: string;
  currentProductName: string;
  /** catalog price of the current product */
  currentPrice: number;
  /** cheaper replacement product */
  alternativeProductId: string;
  alternativeProductName: string;
  /** catalog price of the replacement */
  alternativePrice: number;
  /** currentPrice - alternativePrice */
  savings: number;
}

/** Result of a "cheaper alternatives" suggestion pass. */
export interface CheaperAlternativeResult {
  /** alternatives sorted by savings, most helpful first */
  alternatives: readonly CheaperAlternative[];
  /** sum of savings across all alternatives */
  totalSavings: number;
  /** the budget the alternatives were computed against */
  budget: number;
  /** budget left if every alternative is applied */
  remainingBudget: number;
  /** true when applying every alternative fits within the budget */
  withinBudget: boolean;
}

/* ------------------------------------------------------------------ */
/* Snapshots, cart, activity, camera                                   */
/* ------------------------------------------------------------------ */

/** A saved/restorable snapshot of a design. Fully serializable (ISO timestamps). */
export interface DesignSnapshot {
  id: string;
  name: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-modification timestamp */
  updatedAt: string;
  room: RoomData;
  /** placed items at snapshot time */
  items: readonly PlacedFurniture[];
  /** budget at snapshot time */
  budget: number;
  /** CSS gradient string for the snapshot thumbnail */
  thumbnailGradient?: string;
}

/** One line of the shopping cart. */
export interface CartItem {
  /** cart line id */
  id: string;
  productId: string;
  quantity: number;
  /** unit price captured when the line was added */
  unitPrice: number;
  /** ISO 8601 timestamp of when the line was added */
  addedAt: string;
  /** placed instance this line purchases, when applicable */
  instanceId?: string;
}

/** A shopping cart. */
export interface Cart {
  id: string;
  status: CartStatus;
  items: readonly CartItem[];
  /** sum of unitPrice * quantity */
  total: number;
  /** ISO 8601 last-update timestamp */
  updatedAt: string;
}

/** Outcome of a checkout tool call. */
export interface CheckoutResult {
  /** order identifier */
  orderId: string;
  /** the cart as checked out */
  cart: Cart;
  /** total charged (equals cart.total) */
  total: number;
  /** ISO 8601 completion timestamp */
  completedAt: string;
}

/** One entry of the activity feed. */
export interface ActivityEntry {
  id: string;
  type: ActivityType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** human-readable summary of what happened */
  message: string;
  /** affected placed furniture instance */
  instanceId?: string;
  /** affected product */
  productId?: string;
  /** numeric payload, e.g. a budget value or price delta */
  amount?: number;
}

/* ------------------------------------------------------------------ */
/* Serializable results                                                */
/* ------------------------------------------------------------------ */

/** Any JSON-serializable value. */
export type SerializableValue =
  | string
  | number
  | boolean
  | null
  | readonly SerializableValue[]
  | { readonly [key: string]: SerializableValue };

/** Successful result of an operation or tool call. */
export interface SerializableSuccess<T> {
  ok: true;
  data: T;
}

/** Failed result of an operation or tool call. */
export interface SerializableError {
  ok: false;
  /** stable machine-readable error code */
  code: string;
  /** human-readable error message */
  message: string;
  /** optional structured details */
  details?: Readonly<Record<string, SerializableValue>>;
}

/** Discriminated success/error result; serializable when T is serializable. */
export type SerializableResult<T> = SerializableSuccess<T> | SerializableError;
