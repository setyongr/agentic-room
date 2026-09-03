/**
 * Room store — the single live source of truth for the living-room editor.
 *
 * A typed Zustand store initialized from the corrected default demo
 * snapshot (`src/data/demoRoom.ts`): the locked existing sofa and rug plus
 * the optional existing entry console, a $700 budget, and zero marketplace
 * spend, so an agent (or visitor) can visibly place several marketplace
 * products before anything counts against the budget. The Budget Rescue
 * scenario stays available as a separate loadable preset ($1,140 marketplace
 * spend against a $1,000 budget).
 *
 * Conventions (shared with the WebMCP-facing layer):
 * - Every action routes through the pure functions in `src/domain`; the
 *   store never reimplements search, geometry, pricing, or validation.
 * - Mutating actions return the exact `SerializableResult` payload their
 *   domain function produces (the result callers need). On success the
 *   derived `validation` and `pricing` state is recomputed synchronously
 *   from the new inputs; failed actions change nothing.
 * - `origin` gates the activity feed: only `origin === 'agent'` appends a
 *   concise application-level entry (one line, no chain-of-thought).
 * - All ids and timestamps are minted from a deterministic per-session
 *   sequence counter over a fixed session epoch, so replaying the same
 *   action sequence reproduces identical state — no clocks, no randomness.
 * - `lastMutation` is a monotonic marker bumped exactly once per successful
 *   state write (including agent feed entries and view changes); failed and
 *   no-op actions never bump it. Consumers compare for inequality.
 * - Locked items may be moved or rotated but never removed or replaced
 *   (enforced by the placement domain, which the store delegates to).
 * - State is never mutated in place: every update builds fresh arrays.
 *
 * The store is callable both reactively (`useRoomStore(selector)`) and
 * imperatively (`useRoomStore.getState().placeProduct(...)`), so the UI and
 * WebMCP callbacks share exactly the same actions.
 */

import { create } from 'zustand';
import type {
  ActivityEntry,
  CameraMode,
  Cart,
  DesignSnapshot,
  FurnitureCategory,
  FurnitureProduct,
  PlacedFurniture,
  PriceSummary,
  RoomAppearance,
  RoomData,
  RoomDimensions,
  SearchProductsArgs,
  SearchProductsResult,
  SerializableResult,
  ValidationResult,
} from '@/domain/types';
import { BUDGET_RESCUE_SNAPSHOT, DEFAULT_DEMO_SNAPSHOT } from '@/data/demoRoom';
import * as activity from '@/domain/activity';
import * as appearance from '@/domain/appearance';
import * as alternatives from '@/domain/alternatives';
import * as cart from '@/domain/cart';
import * as catalog from '@/domain/catalog';
import * as designs from '@/domain/designs';
import * as placement from '@/domain/placement';
import * as pricing from '@/domain/pricing';
import * as roomResize from '@/domain/resize';
import * as validation from '@/domain/validation';

/** Who initiated an action: the interactive UI ('human') or a WebMCP agent call. */
export type ActionOrigin = 'human' | 'agent';

/**
 * Fixed, application-defined activity events an agent read may record.
 *
 * The store composes the feed message from a fixed per-event template and
 * its own live state; callers supply only the event discriminator and
 * optional structured fields — never free-form text — so the activity feed
 * can never contain agent reasoning.
 */
export type AgentActivityEvent =
  /** A full room-state inspection (get_room_state). */
  | { type: 'room_inspected' }
  /** A placement-capacity inspection for one category (get_available_placement_zones). */
  | { type: 'zones_inspected'; category: FurnitureCategory }
  /** A single catalog product view (get_product). */
  | { type: 'product_viewed'; productId: string }
  /** A budget-pressure read (get_budget_pressure). */
  | { type: 'budget_pressure_checked' }
  /** A saved-designs read (get_saved_designs). */
  | { type: 'designs_inspected' };
/**
 * Fixed session epoch (ISO 8601). Every id and timestamp a session mints is
 * derived from this epoch plus the session sequence, so replaying the same
 * action sequence reproduces byte-identical state.
 */
export const SESSION_EPOCH = '2026-09-01T00:00:00.000Z';

const SESSION_EPOCH_MS = Date.parse(SESSION_EPOCH);

/** Deterministic ISO timestamp for a session sequence step. */
function timestampFor(sequence: number): string {
  return new Date(SESSION_EPOCH_MS + sequence).toISOString();
}

/** Compact decimal formatting for coordinates and rotations in feed messages. */
function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Human-readable product name, falling back to the raw product id. */
function productName(productId: string): string {
  return catalog.getProductById(productId)?.name ?? productId;
}

/** Feed entry metadata without the deterministic id/timestamp pair. */
type FeedEntryMeta = Omit<activity.ActivityEntryMeta, 'id' | 'timestamp'>;

/** Options for {@link RoomStore.saveDesign}. */
export interface SaveDesignOptions {
  /** CSS gradient string used as a thumbnail placeholder */
  thumbnailGradient?: string;
}

/**
 * A user-uploaded GLB model placed in the room.
 *
 * Uploads are a session-local visual layer: they never enter the catalog,
 * budgets, validation, activity feed, or saved designs, and WebMCP tools do
 * not see them. Dimensions are meters after auto-fitting.
 */
export interface UserModelItem {
  /** unique session id, e.g. "user-model-3" */
  id: string;
  /** display name, derived from the uploaded file name */
  name: string;
  /** object URL of the uploaded GLB (revoked when the item is removed) */
  url: string;
  /** auto-fitted extents in meters, floor at y = 0 */
  width: number;
  depth: number;
  height: number;
  /** footprint center in room coordinates (x/z) */
  position: { x: number; z: number };
  /** yaw rotation in degrees around the y axis */
  rotation: number;
  locked: boolean;
}

/** Options for {@link RoomStore.uploadUserModel}. */
export interface UploadUserModelOptions {
  /** where the upload icon sits in room coordinates (defaults to the first zone center) */
  position?: { x: number; z: number };
}

/** The room store contract: live state plus human/WebMCP-shared actions. */
export interface RoomStore {
  /* ── State ─────────────────────────────────────────────────────────── */

  /** Static room geometry (dimensions, openings, placement zones). */
  room: RoomData;
  /** Current visual styling of the room shell (finishes and wallpaper). */
  roomAppearance: RoomAppearance;
  /** Placed furniture instances, never mutated in place. */
  furniture: readonly PlacedFurniture[];
  /** User-uploaded GLB models (session-local visual layer, see {@link UserModelItem}). */
  userModels: readonly UserModelItem[];
  /** Current design budget in USD; only marketplace items count against it. */
  budget: number;
  /** Selected placed instance, or null when nothing is selected. */
  selectedInstanceId: string | null;
  /** Selected uploaded model, or null when none is selected. */
  selectedUserModelId: string | null;
  /** View mode of the 3D room editor. */
  cameraMode: CameraMode;
  /** Designs saved during this session (deterministic ids/timestamps). */
  savedDesigns: readonly DesignSnapshot[];
  /** The shopping cart (marketplace items only). */
  cart: Cart;
  /** Activity feed, newest last, bounded by the domain feed limit. */
  activity: readonly ActivityEntry[];
  /** Live layout validation, refreshed synchronously after every mutation. */
  validation: ValidationResult;
  /** Live budget breakdown, refreshed synchronously after every mutation. */
  pricing: PriceSummary;
  /**
   * Monotonic marker bumped exactly once per successful state write (design
   * mutations, view changes, and agent feed entries alike). Compare for
   * inequality to detect that something changed.
   */
  lastMutation: number;
  /**
   * Deterministic per-session sequence counter. Each minted id/timestamp
   * consumes one step; it is never reset, so ids never collide.
   */
  sessionSequence: number;

  /* ── View ─────────────────────────────────────────────────────────── */

  /** Select a placed instance (null clears the selection). View state; no feed entry. */
  selectItem: (instanceId: string | null) => void;
  /** Select an uploaded model (null clears the selection); mutually exclusive with {@link selectItem}. */
  selectUserModel: (userModelId: string | null) => void;
  /** Set the 3D camera mode. View state; no feed entry. */
  setCameraMode: (mode: CameraMode) => void;

  /* ── Search / read helpers ────────────────────────────────────────── */

  /** Look up a catalog product by id. */
  getProductById: (productId: string) => FurnitureProduct | undefined;
  /** Search the marketplace catalog (domain-paged, deterministic). */
  searchProducts: (args: SearchProductsArgs, origin?: ActionOrigin) => SearchProductsResult;
  /** Zones that accept `category` and still have capacity in the current room. */
  getAvailablePlacementZones: (
    category: FurnitureCategory,
  ) => SerializableResult<placement.AvailablePlacementZonesResult>;
  /** Preview a product in a zone against the current room (occupancy defaults to live items). */
  fitProductInZone: (
    productId: string,
    zoneId: string,
    options?: placement.FitProductInZoneOptions,
  ) => SerializableResult<placement.FitProductInZoneResult>;
  /** Zones that accept a category with no items placed (compatible regardless of occupancy or fit). */
  getCompatiblePlacementZones: (
    category: FurnitureCategory,
  ) => SerializableResult<placement.AvailablePlacementZonesResult>;
  /** Re-run layout validation against the live room, items, and budget. */
  checkLayout: (origin?: ActionOrigin) => ValidationResult;
  /** Re-run the budget breakdown against the live items and budget. */
  calculateTotal: (origin?: ActionOrigin) => PriceSummary;
  /** Budget pressure of the current design (status, amount over, replaceable items). */
  getBudgetPressure: () => pricing.BudgetPressureResult;
  /** Suggest cheaper same-category replacements for one placed marketplace item. */
  findCheaperAlternatives: (
    instanceId: string,
    options?: alternatives.CheaperAlternativesOptions,
    origin?: ActionOrigin,
  ) => SerializableResult<alternatives.CheaperAlternativesResult>;
  /**
   * Record one fixed agent activity event in the feed (agent-origin only).
   * The message is composed by the store from a fixed per-event template
   * and live state — callers cannot inject free-form text.
   */
  recordAgentActivity: (event: AgentActivityEvent) => void;

  /* ── Mutations ────────────────────────────────────────────────────── */

  /** Add a product to the room (zone placement or explicit x/z). */
  placeProduct: (
    productId: string,
    options?: placement.PlaceProductOptions,
    origin?: ActionOrigin,
  ) => SerializableResult<placement.PlacementMutationResult>;
  /** Move a placed item to new x/z coordinates (locked items may move). */
  moveProduct: (
    instanceId: string,
    x: number,
    z: number,
    origin?: ActionOrigin,
  ) => SerializableResult<placement.PlacementMutationResult>;
  /** Set a placed item's yaw rotation (locked items may rotate). */
  rotateProduct: (
    instanceId: string,
    rotation: number,
    origin?: ActionOrigin,
  ) => SerializableResult<placement.PlacementMutationResult>;
  /** Remove a placed item; locked items cannot be removed. */
  removeProduct: (
    instanceId: string,
    origin?: ActionOrigin,
  ) => SerializableResult<placement.PlacementMutationResult>;
  /** Lock or unlock a placed item; setting the current value is a no-op success. */
  setItemLocked: (
    instanceId: string,
    locked: boolean,
    origin?: ActionOrigin,
  ) => SerializableResult<placement.PlacementMutationResult>;
  /** Upload a user GLB model into the room (session-local; see {@link UserModelItem}). */
  uploadUserModel: (
    model: Omit<UserModelItem, 'id' | 'position' | 'rotation' | 'locked'>,
    options?: UploadUserModelOptions,
  ) => SerializableResult<UserModelItem>;
  /** Move an uploaded model to new x/z coordinates (locked models may move). */
  moveUserModel: (userModelId: string, x: number, z: number) => SerializableResult<UserModelItem>;
  /** Set an uploaded model's yaw rotation (locked models may rotate). */
  rotateUserModel: (userModelId: string, rotation: number) => SerializableResult<UserModelItem>;
  /** Remove an uploaded model; locked models cannot be removed. */
  removeUserModel: (userModelId: string) => SerializableResult<UserModelItem>;
  /** Lock or unlock an uploaded model; setting the current value is a no-op success. */
  setUserModelLocked: (userModelId: string, locked: boolean) => SerializableResult<UserModelItem>;
  /** Replace the product backing an item (same category, in stock; locked items cannot be replaced). */
  replaceProduct: (
    instanceId: string,
    newProductId: string,
    origin?: ActionOrigin,
  ) => SerializableResult<placement.ReplaceProductResult>;
  /** Set the design budget; refreshes validation (budget check) and pricing. */
  setBudget: (budget: number, origin?: ActionOrigin) => SerializableResult<{ budget: number }>;
  /**
   * Resize the room shell to real measured dimensions (meters, within the
   * domain's supported ranges). Openings and placement zones are rebuilt
   * from the new footprint; furniture keeps its coordinates and the layout
   * is re-validated immediately, so pieces outside the new walls surface as
   * out-of-bounds errors. Same dimensions = no-op success.
   */
  setRoomDimensions: (
    dimensions: RoomDimensions,
    origin?: ActionOrigin,
  ) => SerializableResult<roomResize.ResizeRoomResult>;
  /** Apply a partial styling change to the room appearance (visual only; never touches pricing or layout). */
  setRoomAppearance: (
    patch: Partial<RoomAppearance>,
    origin?: ActionOrigin,
  ) => SerializableResult<RoomAppearance>;
  /** Capture the current design as a saved snapshot. */
  saveDesign: (
    name: string,
    options?: SaveDesignOptions,
    origin?: ActionOrigin,
  ) => SerializableResult<DesignSnapshot>;
  /** Restore a design previously saved this session. */
  loadDesign: (designId: string, origin?: ActionOrigin) => SerializableResult<designs.RestoredDesign>;
  /** Reset the room to the default demo state (sofa + rug + console, $700, nothing spent). */
  resetToDefault: (origin?: ActionOrigin) => SerializableResult<designs.RestoredDesign>;
  /** Load the Budget Rescue preset (valid layout, $1,140 spent against a $1,000 budget). */
  loadBudgetRescue: (origin?: ActionOrigin) => SerializableResult<designs.RestoredDesign>;
  /** Add placed marketplace instances to the cart. */
  addToCart: (instanceIds: readonly string[], origin?: ActionOrigin) => SerializableResult<Cart>;
}

/** Minted deterministic session identity: an id and its ISO timestamp. */
function sessionMint(sequence: number, prefix: string): { id: string; timestamp: string } {
  return { id: `${prefix}-${sequence}`, timestamp: timestampFor(sequence) };
}

export const useRoomStore = create<RoomStore>()((set, get) => {
  /* ── Initial state: the corrected default demo snapshot, deep-cloned ── */

  const initial = designs.loadDesignSnapshot(DEFAULT_DEMO_SNAPSHOT);
  if (!initial.ok) {
    throw new Error(`Cannot initialize the room store from the default snapshot: ${initial.message}`);
  }
  const { room, items, budget, appearance: initialAppearance } = initial.data;

  /**
   * Recompute the derived validation/pricing for a changed design and stage
   * the resulting state updates (without `lastMutation`; commit() bumps it).
   */
  const refreshDesign = (
    nextRoom: RoomData,
    furniture: readonly PlacedFurniture[],
    nextBudget: number,
  ): Partial<RoomStore> => ({
    room: nextRoom,
    furniture,
    budget: nextBudget,
    validation: validation.checkLayout(nextRoom, furniture, nextBudget),
    pricing: pricing.calculateTotal(furniture, nextBudget),
  });

  const restoreDesign = (restored: designs.RestoredDesign): Partial<RoomStore> => ({
    ...refreshDesign(restored.room, restored.items, restored.budget),
    roomAppearance: restored.appearance,
    selectedInstanceId: null,
    userModels: [],
    selectedUserModelId: null,
  });

  /**
   * Apply `changes` to the store, appending one feed entry when `origin` is
   * 'agent' and bumping `lastMutation` exactly once. `changes` must be the
   * action's non-feed state updates.
   */
  const commit = (
    prev: RoomStore,
    changes: Partial<RoomStore>,
    origin: ActionOrigin,
    entry?: FeedEntryMeta,
  ): void => {
    if (entry !== undefined && origin === 'agent') {
      const sequence = prev.sessionSequence + 1;
      const mint = sessionMint(sequence, 'activity');
      set({
        ...changes,
        lastMutation: prev.lastMutation + 1,
        sessionSequence: sequence,
        activity: activity.appendActivity(
          prev.activity,
          activity.createActivityEntry({ id: mint.id, timestamp: mint.timestamp, ...entry }),
        ),
      });
      return;
    }
    set({ ...changes, lastMutation: prev.lastMutation + 1 });
  };

  return {
    /* ── State ── */
    room,
    roomAppearance: initialAppearance,
    furniture: items,
    userModels: [],
    budget,
    selectedInstanceId: null,
    selectedUserModelId: null,
    cameraMode: 'orbit',
    savedDesigns: [],
    cart: { id: 'cart-1', status: 'active', items: [], total: 0, updatedAt: SESSION_EPOCH },
    activity: [],
    validation: validation.checkLayout(room, items, budget),
    pricing: pricing.calculateTotal(items, budget),
    lastMutation: 0,
    sessionSequence: 0,

    /* ── View ── */
    selectItem: (instanceId) => {
      set({
        selectedInstanceId: instanceId,
        selectedUserModelId: null,
        lastMutation: get().lastMutation + 1,
      });
    },
    selectUserModel: (userModelId) => {
      set({
        selectedUserModelId: userModelId,
        selectedInstanceId: null,
        lastMutation: get().lastMutation + 1,
      });
    },
    setCameraMode: (mode) => {
      set({ cameraMode: mode, lastMutation: get().lastMutation + 1 });
    },

    /* ── Search / read helpers ── */
    getProductById: (productId) => catalog.getProductById(productId),

    searchProducts: (args, origin = 'human') => {
      const result = catalog.searchProducts(args);
      if (origin === 'agent') {
        commit(get(), {}, origin, {
          type: 'products_searched',
          message: `Searched the marketplace: ${result.total} match${result.total === 1 ? '' : 'es'}`,
          amount: result.total,
        });
      }
      return result;
    },

    getAvailablePlacementZones: (category) =>
      placement.getAvailablePlacementZones(category, get().room, get().furniture),

    fitProductInZone: (productId, zoneId, options = {}) =>
      placement.fitProductInZone(productId, get().room, zoneId, {
        ...options,
        items: options.items ?? get().furniture,
      }),

    getCompatiblePlacementZones: (category) =>
      placement.getAvailablePlacementZones(category, get().room, []),

    checkLayout: (origin = 'human') => {
      const prev = get();
      const result = validation.checkLayout(prev.room, prev.furniture, prev.budget);
      commit(prev, {}, origin, {
        type: 'layout_checked',
        message: result.valid
          ? 'Layout check passed'
          : `Layout check found ${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`,
        amount: result.issues.length,
      });
      return result;
    },

    calculateTotal: (origin = 'human') => {
      const prev = get();
      const result = pricing.calculateTotal(prev.furniture, prev.budget);
      commit(prev, {}, origin, {
        type: 'total_calculated',
        message: `Marketplace total $${result.newTotal.toFixed(2)} of the $${prev.budget.toFixed(2)} budget`,
        amount: result.newTotal,
      });
      return result;
    },

    getBudgetPressure: () => pricing.getBudgetPressure(get().furniture, get().budget),

    recordAgentActivity: (event) => {
      const prev = get();
      switch (event.type) {
        case 'room_inspected':
          commit(prev, {}, 'agent', {
            type: 'room_inspected',
            message: `Inspected the room: ${prev.furniture.length} item${prev.furniture.length === 1 ? '' : 's'} across ${prev.room.placementZones.length} zones with a $${prev.budget.toFixed(2)} budget`,
            amount: prev.furniture.length,
          });
          return;
        case 'zones_inspected': {
          const result = placement.getAvailablePlacementZones(event.category, prev.room, prev.furniture);
          const available = result.ok ? result.data.zones.length : 0;
          commit(prev, {}, 'agent', {
            type: 'room_inspected',
            message: `Inspected placement zones for ${event.category}: ${available} of ${prev.room.placementZones.length} zones available`,
            amount: available,
          });
          return;
        }
        case 'product_viewed': {
          const product = catalog.getProductById(event.productId);
          commit(prev, {}, 'agent', {
            type: 'products_searched',
            message: `Viewed product “${product?.name ?? event.productId}” in the marketplace`,
            productId: event.productId,
            amount: product?.price,
          });
          return;
        }
        case 'budget_pressure_checked': {
          const result = pricing.getBudgetPressure(prev.furniture, prev.budget);
          commit(prev, {}, 'agent', {
            type: 'budget_pressure_checked',
            message:
              result.status === 'over_budget'
                ? `Checked budget pressure: $${result.amountOver.toFixed(2)} over budget`
                : result.status === 'at_budget'
                  ? 'Checked budget pressure: exactly at budget'
                  : `Checked budget pressure: $${result.remaining.toFixed(2)} remaining`,
            amount: result.status === 'over_budget' ? result.amountOver : result.remaining,
          });
          return;
        }
        case 'designs_inspected':
          commit(prev, {}, 'agent', {
            type: 'designs_inspected',
            message: `Inspected saved designs: ${prev.savedDesigns.length} saved`,
            amount: prev.savedDesigns.length,
          });
          return;
      }
    },

    findCheaperAlternatives: (instanceId, options, origin = 'human') => {
      const prev = get();
      const result = alternatives.findCheaperAlternatives(instanceId, prev.furniture, options);
      if (result.ok) {
        const item = prev.furniture.find((f) => f.instanceId === instanceId);
        commit(prev, {}, origin, {
          type: 'alternatives_found',
          message: `Found ${result.data.alternatives.length} cheaper alternative${result.data.alternatives.length === 1 ? '' : 's'} for “${productName(item?.productId ?? instanceId)}”`,
          instanceId,
          productId: item?.productId,
          amount: result.data.totalSavings,
        });
      }
      return result;
    },

    /* ── Mutations ── */
    placeProduct: (productId, options = {}, origin = 'human') => {
      const prev = get();
      const result = placement.placeProduct(productId, prev.room, prev.furniture, options);
      if (!result.ok) return result;
      const item = result.data.item;
      const zone =
        options.zoneId === undefined
          ? undefined
          : prev.room.placementZones.find((z) => z.id === options.zoneId);
      commit(prev, refreshDesign(prev.room, result.data.items, prev.budget), origin, {
        type: 'item_added',
        message:
          zone !== undefined
            ? `Placed “${productName(item.productId)}” in the “${zone.name}” zone`
            : `Placed “${productName(item.productId)}” at (${fmt(item.position.x)}, ${fmt(item.position.z)})`,
        instanceId: item.instanceId,
        productId: item.productId,
      });
      return result;
    },

    moveProduct: (instanceId, x, z, origin = 'human') => {
      const prev = get();
      const result = placement.moveProduct(instanceId, prev.furniture, x, z);
      if (!result.ok) return result;
      const item = result.data.item;
      commit(prev, refreshDesign(prev.room, result.data.items, prev.budget), origin, {
        type: 'item_moved',
        message: `Moved “${productName(item.productId)}” to (${fmt(x)}, ${fmt(z)})`,
        instanceId,
        productId: item.productId,
      });
      return result;
    },

    rotateProduct: (instanceId, rotation, origin = 'human') => {
      const prev = get();
      const result = placement.rotateProduct(instanceId, prev.furniture, rotation);
      if (!result.ok) return result;
      const item = result.data.item;
      commit(prev, refreshDesign(prev.room, result.data.items, prev.budget), origin, {
        type: 'item_rotated',
        message: `Rotated “${productName(item.productId)}” to ${fmt(item.rotation)}°`,
        instanceId,
        productId: item.productId,
      });
      return result;
    },

    removeProduct: (instanceId, origin = 'human') => {
      const prev = get();
      const result = placement.removeProduct(instanceId, prev.furniture);
      if (!result.ok) return result;
      const item = result.data.item;
      const updates: Partial<RoomStore> = {
        ...refreshDesign(prev.room, result.data.items, prev.budget),
        ...(prev.selectedInstanceId === instanceId ? { selectedInstanceId: null } : {}),
      };
      commit(prev, updates, origin, {
        type: 'item_removed',
        message: `Removed “${productName(item.productId)}” from the room`,
        instanceId,
        productId: item.productId,
      });
      return result;
    },

    setItemLocked: (instanceId, locked, origin = 'human') => {
      const prev = get();
      const current = prev.furniture.find((f) => f.instanceId === instanceId);
      const result = placement.setItemLocked(instanceId, prev.furniture, locked);
      if (!result.ok) return result;
      if (current?.locked === locked) return result; // no-op success: nothing changed
      const item = result.data.item;
      commit(prev, refreshDesign(prev.room, result.data.items, prev.budget), origin, {
        type: locked ? 'item_locked' : 'item_unlocked',
        message: `${locked ? 'Locked' : 'Unlocked'} “${productName(item.productId)}”`,
        instanceId,
        productId: item.productId,
      });
      return result;
    },

    /* ── Uploaded user models (session-local visual layer) ─────────── */

    uploadUserModel: (model, options = {}) => {
      const prev = get();
      if (model.name.trim() === '' || model.url === '') {
        return { ok: false, code: 'invalid_upload', message: 'The uploaded model has no usable name or data.' };
      }
      const { width, depth, height } = model;
      if (!Number.isFinite(width) || !Number.isFinite(depth) || !Number.isFinite(height) || width <= 0 || depth <= 0 || height <= 0) {
        return {
          ok: false,
          code: 'invalid_upload',
          message: 'The uploaded model could not be measured (empty or unsupported geometry).',
        };
      }
      const sequence = prev.sessionSequence + 1;
      const mint = sessionMint(sequence, 'user-model');
      const footprint = prev.room.placementZones[0]?.footprint;
      // Default: first zone center, nudged toward the room middle so a fresh
      // upload never sits exactly on top of a zone-centered catalog item.
      const defaultPosition = (() => {
        if (!footprint) return { x: 0, z: 0 };
        // Nudge toward the room middle, capped by the zone's remaining half-width
        // so a fresh upload never protrudes from (or crosses) its chosen zone.
        const slack = footprint.width / 2 - width / 2 - 0.25;
        const gap = slack > 0 ? Math.min(1.2, slack) : 0;
        const dir = footprint.x < -0.01 ? 1 : footprint.x > 0.01 ? -1 : 1;
        return { x: footprint.x + dir * gap, z: footprint.z };
      })();
      const item: UserModelItem = {
        id: mint.id,
        name: model.name,
        url: model.url,
        width,
        depth,
        height,
        position: options.position ?? defaultPosition,
        rotation: 0,
        locked: false,
      };
      set({
        userModels: [...prev.userModels, item],
        sessionSequence: sequence,
        selectedUserModelId: item.id,
        selectedInstanceId: null,
        lastMutation: prev.lastMutation + 1,
      });
      return { ok: true, data: item };
    },

    moveUserModel: (userModelId, x, z) => {
      const prev = get();
      const current = prev.userModels.find((m) => m.id === userModelId);
      if (current === undefined) {
        return { ok: false, code: 'user_model_not_found', message: `No uploaded model with id “${userModelId}”`, details: { userModelId } };
      }
      const item = { ...current, position: { x, z } };
      set({
        userModels: prev.userModels.map((m) => (m.id === userModelId ? item : m)),
        lastMutation: prev.lastMutation + 1,
      });
      return { ok: true, data: item };
    },

    rotateUserModel: (userModelId, rotation) => {
      const prev = get();
      const current = prev.userModels.find((m) => m.id === userModelId);
      if (current === undefined) {
        return { ok: false, code: 'user_model_not_found', message: `No uploaded model with id “${userModelId}”`, details: { userModelId } };
      }
      if (!Number.isFinite(rotation)) {
        return { ok: false, code: 'invalid_rotation', message: 'Rotation must be a finite number of degrees.' };
      }
      // Parity with placement.rotateProduct: canonical yaw in [0, 360).
      const normalized = ((rotation % 360) + 360) % 360;
      const item = { ...current, rotation: normalized };
      set({
        userModels: prev.userModels.map((m) => (m.id === userModelId ? item : m)),
        lastMutation: prev.lastMutation + 1,
      });
      return { ok: true, data: item };
    },

    setUserModelLocked: (userModelId, locked) => {
      const prev = get();
      const current = prev.userModels.find((m) => m.id === userModelId);
      if (current === undefined) {
        return { ok: false, code: 'user_model_not_found', message: `No uploaded model with id “${userModelId}”`, details: { userModelId } };
      }
      if (current.locked === locked) return { ok: true, data: current };
      const item = { ...current, locked };
      set({
        userModels: prev.userModels.map((m) => (m.id === userModelId ? item : m)),
        lastMutation: prev.lastMutation + 1,
      });
      return { ok: true, data: item };
    },

    removeUserModel: (userModelId) => {
      const prev = get();
      const current = prev.userModels.find((m) => m.id === userModelId);
      if (current === undefined) {
        return { ok: false, code: 'user_model_not_found', message: `No uploaded model with id “${userModelId}”`, details: { userModelId } };
      }
      if (current.locked) {
        return { ok: false, code: 'item_locked', message: 'Locked uploads cannot be removed. Unlock it first.' };
      }
      set({
        userModels: prev.userModels.filter((m) => m.id !== userModelId),
        selectedUserModelId: prev.selectedUserModelId === userModelId ? null : prev.selectedUserModelId,
        lastMutation: prev.lastMutation + 1,
      });
      return { ok: true, data: current };
    },

    replaceProduct: (instanceId, newProductId, origin = 'human') => {
      const prev = get();
      const previous = prev.furniture.find((f) => f.instanceId === instanceId);
      const result = placement.replaceProduct(instanceId, prev.furniture, newProductId);
      if (!result.ok) return result;
      const item = result.data.item;
      commit(prev, refreshDesign(prev.room, result.data.items, prev.budget), origin, {
        type: 'item_replaced',
        message: `Replaced “${productName(previous?.productId ?? item.productId)}” with “${productName(item.productId)}”`,
        instanceId,
        productId: item.productId,
        amount: result.data.savings,
      });
      return result;
    },

    setBudget: (budget, origin = 'human') => {
      if (!Number.isFinite(budget)) {
        return {
          ok: false,
          code: 'invalid_budget',
          message: `Budget must be a finite number, got ${String(budget)}`,
          details: { budget },
        };
      }
      if (budget < 0) {
        return {
          ok: false,
          code: 'invalid_budget',
          message: `Budget must be a non-negative number, got ${String(budget)}`,
          details: { budget },
        };
      }
      const prev = get();
      if (budget === prev.budget) {
        return { ok: true, data: { budget } }; // no-op success: nothing changed
      }
      commit(prev, refreshDesign(prev.room, prev.furniture, budget), origin, {
        type: 'budget_updated',
        message: `Budget set to ${budget.toFixed(2)}`,
        amount: budget,
      });
      return { ok: true, data: { budget } };
    },

    setRoomDimensions: (dimensions, origin = 'human') => {
      const prev = get();
      const result = roomResize.resizeRoom(prev.room, dimensions);
      if (!result.ok) return result;
      if (!result.data.changed) return result; // no-op success: nothing changed
      const resized = result.data.room;
      const { width, depth, height } = resized.dimensions;
      const removed = result.data.removedOpeningIds;
      const note =
        removed.length === 0
          ? ''
          : removed.length === 1
            ? `; the ${removed[0]} opening no longer fits a wall and was removed`
            : `; ${removed.length} openings no longer fit the walls and were removed`;
      commit(prev, refreshDesign(resized, prev.furniture, prev.budget), origin, {
        type: 'room_resized',
        message: `Resized the room to ${fmt(width)} × ${fmt(depth)} × ${fmt(height)} m${note}`,
      });
      return result;
    },

    setRoomAppearance: (patch, origin = 'human') => {
      const prev = get();
      const result = appearance.updateRoomAppearance(prev.roomAppearance, patch);
      if (!result.ok) return result;
      if (result.data === prev.roomAppearance) return result; // no-op success: nothing changed
      commit(prev, { roomAppearance: result.data }, origin, {
        type: 'room_appearance_updated',
        message: 'Updated room finishes',
      });
      return result;
    },

    saveDesign: (name, options = {}, origin = 'human') => {
      const prev = get();
      if (prev.userModels.length > 0) {
        return {
          ok: false,
          code: 'user_models_not_savable',
          message: 'Remove uploaded models before saving a design; uploads are session-only and cannot be stored.',
          details: { userModelIds: prev.userModels.map((m) => m.id) },
        };
      }
      const sequence = prev.sessionSequence + 1;
      const snapshot = designs.createDesignSnapshot(prev.room, prev.furniture, prev.budget, prev.roomAppearance, {
        id: `snapshot-${sequence}`,
        name,
        createdAt: timestampFor(sequence),
        updatedAt: timestampFor(sequence),
        ...(options.thumbnailGradient !== undefined
          ? { thumbnailGradient: options.thumbnailGradient }
          : {}),
      });
      if (!snapshot.ok) return snapshot;
      const updates: Partial<RoomStore> = {
        savedDesigns: [...prev.savedDesigns, snapshot.data],
        sessionSequence: sequence,
      };
      if (origin === 'agent') {
        const mint = sessionMint(sequence + 1, 'activity');
        updates.activity = activity.appendActivity(
          prev.activity,
          activity.createActivityEntry({
            id: mint.id,
            timestamp: mint.timestamp,
            type: 'design_saved',
            message: 'Saved a design snapshot',
          }),
        );
        updates.sessionSequence = sequence + 1;
      }
      set({ ...updates, lastMutation: prev.lastMutation + 1 });
      return snapshot;
    },

    loadDesign: (designId, origin = 'human') => {
      const prev = get();
      const saved = prev.savedDesigns.find((design) => design.id === designId);
      if (saved === undefined) {
        return {
          ok: false,
          code: 'design_not_found',
          message: `No saved design with id “${designId}”`,
          details: { designId },
        };
      }
      const restored = designs.loadDesignSnapshot(saved);
      if (!restored.ok) return restored;
      commit(prev, restoreDesign(restored.data), origin, {
        type: 'design_restored',
        message: 'Restored a saved design',
      });
      return restored;
    },

    resetToDefault: (origin = 'human') => {
      const prev = get();
      const restored = designs.loadDesignSnapshot(DEFAULT_DEMO_SNAPSHOT);
      if (!restored.ok) return restored;
      commit(prev, restoreDesign(restored.data), origin, {
        type: 'design_restored',
        message: 'Reset to the default demo room',
      });
      return restored;
    },

    loadBudgetRescue: (origin = 'human') => {
      const prev = get();
      const restored = designs.loadDesignSnapshot(BUDGET_RESCUE_SNAPSHOT);
      if (!restored.ok) return restored;
      commit(prev, restoreDesign(restored.data), origin, {
        type: 'design_restored',
        message: 'Loaded the Budget Rescue preset',
      });
      return restored;
    },

    addToCart: (instanceIds, origin = 'human') => {
      const prev = get();
      let sequence = prev.sessionSequence;
      const result = cart.addToCart(prev.cart, instanceIds, prev.furniture, {
        timestamp: timestampFor(sequence + 1),
        makeLineId: () => {
          sequence += 1;
          return `cart-line-${sequence}`;
        },
      });
      if (!result.ok) return result;
      if (result.data === prev.cart) return result; // nothing to add (empty request)
      const added = result.data.items.length - prev.cart.items.length;
      const updates: Partial<RoomStore> = { cart: result.data, sessionSequence: sequence };
      if (origin === 'agent') {
        const mint = sessionMint(sequence + 1, 'activity');
        updates.activity = activity.appendActivity(
          prev.activity,
          activity.createActivityEntry({
            id: mint.id,
            timestamp: mint.timestamp,
            type: 'cart_item_added',
            message: `Added ${added} item${added === 1 ? '' : 's'} to the cart`,
            amount: added,
          }),
        );
        updates.sessionSequence = sequence + 1;
      }
      set({ ...updates, lastMutation: prev.lastMutation + 1 });
      return result;
    },
  };
});
