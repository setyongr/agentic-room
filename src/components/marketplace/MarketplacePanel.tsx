'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  PackageOpen,
  Plus,
  Ruler,
  Search,
  SlidersHorizontal,
  Sofa,
  SwatchBook,
  Upload,
} from 'lucide-react';
import { furnitureHex } from '@/data/appearance';
import { categories, colors, styles } from '@/data/products';
import type { FurnitureProduct, SearchFilters } from '@/domain/types';
import { useRoomStore } from '@/store/roomStore';
import { RoomAppearancePanel } from '@/components/marketplace/RoomAppearancePanel';
import { RoomSizePanel } from '@/components/marketplace/RoomSizePanel';
import { prepareUserGlb, revokePreparedGlb } from '@/components/marketplace/glbUpload';

const PAGE_SIZE = 12;
const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

type Feedback = { kind: 'success' | 'error'; message: string } | null;

type FurnishTab = 'furniture' | 'room' | 'finishes';

/** Furnish rail segments: catalog, real-size room geometry, room finishes. */
const FURNISH_SEGMENTS: readonly {
  id: FurnishTab;
  label: string;
  icon: typeof Sofa;
}[] = [
  { id: 'furniture', label: 'Furniture', icon: Sofa },
  { id: 'room', label: 'Room size', icon: Ruler },
  { id: 'finishes', label: 'Finishes', icon: SwatchBook },
];

const CATEGORY_LABELS: Record<string, string> = {
  sofa: 'Sofas',
  armchair: 'Armchairs',
  accent_chair: 'Accent chairs',
  coffee_table: 'Coffee tables',
  side_table: 'Side tables',
  console: 'Consoles',
  floor_lamp: 'Floor lamps',
  table_lamp: 'Table lamps',
  rug: 'Rugs',
  shelf: 'Shelves',
  cabinet: 'Cabinets',
  storage: 'Storage',
  plant: 'Plants',
  curtain: 'Curtains',
  decor: 'Decor',
};

const TAB_HEADING: Record<FurnishTab, string> = {
  furniture: 'Furniture catalog',
  room: 'Room size',
  finishes: 'Room finishes',
};

/** Control styles shared by the pinned toolbar controls. */
const TOOLBAR_CONTROL =
  'min-h-11 w-full rounded-control border border-border bg-surface-raised text-sm text-text transition-colors motion-reduce:transition-none';

export function MarketplacePanel() {
  const searchProducts = useRoomStore((state) => state.searchProducts);
  const getAvailablePlacementZones = useRoomStore((state) => state.getAvailablePlacementZones);
  const getCompatiblePlacementZones = useRoomStore((state) => state.getCompatiblePlacementZones);
  const fitProductInZone = useRoomStore((state) => state.fitProductInZone);
  const placeProduct = useRoomStore((state) => state.placeProduct);
  const uploadUserModel = useRoomStore((state) => state.uploadUserModel);
  const selectItem = useRoomStore((state) => state.selectItem);

  const [furnishTab, setFurnishTab] = useState<FurnishTab>('furniture');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [style, setStyle] = useState('');
  const [color, setColor] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [placingProductId, setPlacingProductId] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<Feedback>(null);
  /** The extra style/color/price controls collapse behind a toolbar toggle. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Uncommitted catalog choice per product; defaults to the first authored color. */
  const [selectedColorByProduct, setSelectedColorByProduct] = useState<Record<string, string>>({});
  /** At most one product card detail region is expanded at a time. */
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  const filters = useMemo<SearchFilters>(() => {
    const min = Number(minPrice);
    const max = Number(maxPrice);

    return {
      ...(query.trim() ? { query: query.trim() } : {}),
      ...(category ? { categories: [category as FurnitureProduct['category']] } : {}),
      ...(style ? { styles: [style] } : {}),
      ...(color ? { colors: [color] } : {}),
      ...(minPrice !== '' && Number.isFinite(min) && min >= 0 ? { minPrice: min } : {}),
      ...(maxPrice !== '' && Number.isFinite(max) && max >= 0 ? { maxPrice: max } : {}),
      sort: 'relevance',
    };
  }, [category, color, maxPrice, minPrice, query, style]);

  const results = useMemo(
    () => searchProducts({ filters, page, pageSize: PAGE_SIZE }, 'human'),
    [filters, page, searchProducts],
  );
  const hasActiveFilters = Boolean(query || category || style || color || minPrice || maxPrice);
  /** Filter groups set inside the collapsible panel (style, color, price). */
  const activeFilterCount = Number(Boolean(style)) + Number(Boolean(color)) + Number(Boolean(minPrice || maxPrice));
  const hasMore = page * PAGE_SIZE < results.total;

  /** Compatible placement-zone names per category shown on the current page. */
  const zoneNamesByCategory = useMemo(() => {
    const map: Record<string, string> = {};
    for (const product of results.products) {
      if (map[product.category] !== undefined) continue;
      const zones = getCompatiblePlacementZones(product.category);
      map[product.category] = zones.ok
        ? zones.data.zones.map((entry) => entry.zone.name).join(' · ')
        : '';
    }
    return map;
  }, [getCompatiblePlacementZones, results.products]);

  function resetPage(action: () => void) {
    action();
    setPage(1);
    listRef.current?.scrollTo({ top: 0 });
  }

  function clearFilters() {
    setQuery('');
    setCategory('');
    setStyle('');
    setColor('');
    setMinPrice('');
    setMaxPrice('');
    setPage(1);
    setFeedback(null);
    listRef.current?.scrollTo({ top: 0 });
  }

  function toggleTab(tab: FurnishTab) {
    setFurnishTab(tab);
    setFeedback(null);
    setUploadMessage(null);
    listRef.current?.scrollTo({ top: 0 });
  }

  async function handleUploadModel(file: File | undefined) {
    setUploadMessage(null);
    if (file === undefined) return;
    setUploadBusy(true);
    const prepared = await prepareUserGlb(file);
    if (!prepared.ok) {
      setUploadMessage({ kind: 'error', message: prepared.message });
      setUploadBusy(false);
      return;
    }
    const added = uploadUserModel({
      name: prepared.name,
      url: prepared.url,
      width: prepared.width,
      depth: prepared.depth,
      height: prepared.height,
    });
    if (!added.ok) {
      revokePreparedGlb(prepared.url);
      setUploadMessage({ kind: 'error', message: added.message });
    } else {
      setUploadMessage({
        kind: 'success',
        message: `“${prepared.name}” is placed in the room. Open Edit to move or rotate it.`,
      });
    }
    setUploadBusy(false);
    listRef.current?.scrollTo({ top: 0 });
  }

  function handlePlace(product: FurnitureProduct) {
    setFeedback(null);
    setUploadMessage(null);
    setPlacingProductId(product.id);

    const availableZones = getAvailablePlacementZones(product.category);
    if (!availableZones.ok) {
      setFeedback({ kind: 'error', message: `Could not check placement zones: ${availableZones.message}` });
      setPlacingProductId(null);
      return;
    }

    let zoneId: string | undefined;
    let lastFitError: string | undefined;
    for (const availableZone of availableZones.data.zones) {
      const fit = fitProductInZone(product.id, availableZone.zone.id);
      if (fit.ok) {
        zoneId = availableZone.zone.id;
        break;
      }
      lastFitError = fit.message;
    }

    if (zoneId === undefined) {
      setFeedback({
        kind: 'error',
        message:
          lastFitError === undefined
            ? `No available zone can accept ${product.name}. Try clearing space first.`
            : `No available zone can fit ${product.name}: ${lastFitError}`,
      });
      setPlacingProductId(null);
      return;
    }

    const placed = placeProduct(
      product.id,
      {
        zoneId,
        variant: {
          color: selectedColorByProduct[product.id] ?? product.colors[0] ?? '',
          material: product.material,
        },
      },
      'human',
    );
    if (!placed.ok) {
      setFeedback({ kind: 'error', message: `Could not place ${product.name}: ${placed.message}` });
      setPlacingProductId(null);
      return;
    }

    selectItem(placed.data.item.instanceId);
    setFeedback({ kind: 'success', message: `${product.name} is placed and selected in the room.` });
    setPlacingProductId(null);
    listRef.current?.scrollTo({ top: 0 });
  }

  const notice = uploadMessage ?? feedback;

  return (
    <aside className="flex h-full min-h-0 flex-col bg-surface" aria-label="Marketplace">
      {/* The rail's own heading is structural; the segmented control below carries the visible label. */}
      <h2 className="sr-only">{TAB_HEADING[furnishTab]}</h2>

      {/* Pinned toolbar: mode tabs + (furniture) search, category and filters. */}
      <div className="shrink-0 border-b border-border px-4 pt-3 pb-3 sm:px-5">
        <div className="flex rounded-control bg-surface-muted p-1" role="group" aria-label="Furnish tool">
          {FURNISH_SEGMENTS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={furnishTab === id}
              onClick={() => toggleTab(id)}
              className={`inline-flex min-h-11 w-1/3 min-w-0 items-center justify-center gap-1 rounded-control px-0.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${
                furnishTab === id ? 'bg-surface text-text shadow-card' : 'text-text-muted hover:text-text'
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {furnishTab === 'furniture' ? (
          <>
            <div className="relative mt-2.5">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted" />
              <label className="sr-only" htmlFor="marketplace-search">Search furniture</label>
              <input
                id="marketplace-search"
                className="min-h-11 w-full rounded-control border border-border bg-surface-raised py-2 pr-3 pl-10 text-sm text-text transition-colors placeholder:text-text-faint focus:border-accent motion-reduce:transition-none"
                placeholder="Search name, style or color"
                type="search"
                value={query}
                onChange={(event) => resetPage(() => setQuery(event.target.value))}
              />
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <label className="sr-only" htmlFor="marketplace-category">Category</label>
                <select
                  id="marketplace-category"
                  className={`${TOOLBAR_CONTROL} min-w-0 px-2`}
                  value={category}
                  onChange={(event) => resetPage(() => setCategory(event.target.value))}
                >
                  <option value="">All categories</option>
                  {categories.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
                </select>
              </div>
              <button
                type="button"
                aria-expanded={filtersOpen}
                aria-controls="marketplace-filters"
                onClick={() => setFiltersOpen((open) => !open)}
                className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-control border px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${
                  filtersOpen
                    ? 'border-accent bg-accent-soft text-accent-strong'
                    : 'border-border bg-surface-raised text-text hover:border-accent'
                }`}
              >
                <SlidersHorizontal aria-hidden="true" className="size-4" />
                <span>Filters</span>
                {activeFilterCount > 0 ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-pill bg-accent px-1 text-[11px] leading-4 font-bold text-on-accent tabular-nums">
                    {activeFilterCount}
                  </span>
                ) : null}
                <ChevronDown
                  aria-hidden="true"
                  className={`size-3.5 transition-transform motion-reduce:transition-none ${filtersOpen ? 'rotate-180' : ''}`}
                />
              </button>
            </div>

            {filtersOpen ? (
              <div
                id="marketplace-filters"
                className="mt-2 grid grid-cols-2 gap-x-2.5 gap-y-1 rounded-control border border-border bg-surface-muted/40 p-2.5"
              >
                <FilterSelect label="Style" value={style} onChange={(value) => resetPage(() => setStyle(value))}>
                  <option value="">All styles</option>
                  {styles.map((item) => <option key={item} value={item}>{item}</option>)}
                </FilterSelect>
                <FilterSelect label="Color" value={color} onChange={(value) => resetPage(() => setColor(value))}>
                  <option value="">All colors</option>
                  {colors.map((item) => <option key={item} value={item} className="capitalize">{item}</option>)}
                </FilterSelect>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="minimum-price">Price range</label>
                  <div className="flex items-center gap-1.5">
                    <input id="minimum-price" aria-label="Minimum price" className="min-h-11 min-w-0 w-full rounded-control border border-border bg-surface-raised px-2 text-sm text-text tabular-nums placeholder:text-text-faint" inputMode="numeric" min="0" placeholder="Min" type="number" value={minPrice} onChange={(event) => resetPage(() => setMinPrice(event.target.value))} />
                    <span aria-hidden="true" className="text-text-faint">–</span>
                    <input aria-label="Maximum price" className="min-h-11 min-w-0 w-full rounded-control border border-border bg-surface-raised px-2 text-sm text-text tabular-nums placeholder:text-text-faint" inputMode="numeric" min="0" placeholder="Max" type="number" value={maxPrice} onChange={(event) => resetPage(() => setMaxPrice(event.target.value))} />
                  </div>
                </div>
                {hasActiveFilters ? (
                  <button className="col-span-2 min-h-11 justify-self-start rounded-control px-2 text-sm font-medium text-accent-strong transition-colors hover:bg-accent-soft motion-reduce:transition-none" type="button" onClick={clearFilters}>
                    Clear all filters and search
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {furnishTab === 'finishes' ? (
        <RoomAppearancePanel />
      ) : furnishTab === 'room' ? (
        <RoomSizePanel />
      ) : (
        <>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-5">
            {notice ? (
              <div
                aria-atomic="true"
                aria-live="polite"
                role="status"
                className="sticky top-0 z-10 -mx-4 border-b border-border bg-surface px-4 py-2.5 sm:-mx-5 sm:px-5"
              >
                <p className={`flex items-start gap-2 text-sm ${notice.kind === 'success' ? 'text-success' : 'text-error'}`}>
                  {notice.kind === 'success' ? (
                    <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span className="min-w-0">{notice.message}</span>
                </p>
              </div>
            ) : null}

            <p className="pt-3 text-xs font-medium text-text-muted tabular-nums">
              {results.total} {results.total === 1 ? 'piece' : 'pieces'}
            </p>

            {results.products.length > 0 ? (
              <ul className="mt-2.5 grid grid-cols-2 gap-2.5" role="list">
                {results.products.map((product) => {
                  const expanded = expandedProductId === product.id;
                  return (
                    <li key={product.id} className={`min-w-0 ${expanded ? 'col-span-2' : ''}`}>
                      <ProductCard
                        product={product}
                        placing={placingProductId === product.id}
                        selectedColor={selectedColorByProduct[product.id] ?? product.colors[0] ?? ''}
                        zoneNames={zoneNamesByCategory[product.category] ?? ''}
                        expanded={expanded}
                        onSelectColor={(colorName) =>
                          setSelectedColorByProduct((current) => ({ ...current, [product.id]: colorName }))
                        }
                        onToggleExpand={() =>
                          setExpandedProductId((current) => (current === product.id ? null : product.id))
                        }
                        onPlace={handlePlace}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex min-h-72 flex-col items-center justify-center py-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-pill bg-accent-soft">
                  <PackageOpen aria-hidden="true" className="size-6 text-accent-strong" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-text">No pieces match yet</h3>
                <p className="mt-1 max-w-55 text-sm leading-6 text-text-muted">
                  Try a broader style, color, or price range to bring more of the collection into view.
                </p>
                {hasActiveFilters ? (
                  <button className="mt-4 min-h-11 rounded-control bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong motion-reduce:transition-none" type="button" onClick={clearFilters}>
                    Show the full collection
                  </button>
                ) : null}
              </div>
            )}

            <div className="mt-3 rounded-card border border-dashed border-border bg-surface-muted/40 p-3">
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-control bg-accent-soft">
                  <Upload className="size-4 text-accent-strong" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-text">Upload your own 3D model</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-text-muted">.glb up to 15 MB · auto-fitted · session only</p>
                </div>
              </div>
              <button
                type="button"
                disabled={uploadBusy}
                onClick={() => fileInputRef.current?.click()}
                className="mt-2.5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none"
              >
                <Upload aria-hidden="true" className="size-4" />
                {uploadBusy ? 'Reading…' : 'Upload'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb,model/gltf-binary"
                className="sr-only"
                aria-label="Choose a GLB model file to upload"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  void handleUploadModel(file);
                }}
              />
            </div>

            {results.total > PAGE_SIZE ? (
              <nav className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3" aria-label="Marketplace pagination">
                <button className="min-h-11 rounded-control px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none" disabled={page === 1} type="button" onClick={() => resetPage(() => setPage((currentPage) => currentPage - 1))}>
                  Previous
                </button>
                <span className="text-xs text-text-muted tabular-nums">Page {page}</span>
                <button className="min-h-11 rounded-control px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none" disabled={!hasMore} type="button" onClick={() => resetPage(() => setPage((currentPage) => currentPage + 1))}>
                  Next
                </button>
              </nav>
            ) : null}
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * Compact catalog tile, or — when expanded — a full-width card carrying the
 * dimension/style/zone details next to the place action.
 */
function ProductCard({
  product,
  placing,
  selectedColor,
  zoneNames,
  expanded,
  onSelectColor,
  onToggleExpand,
  onPlace,
}: {
  product: FurnitureProduct;
  placing: boolean;
  selectedColor: string;
  zoneNames: string;
  expanded: boolean;
  onSelectColor: (color: string) => void;
  onToggleExpand: () => void;
  onPlace: (product: FurnitureProduct) => void;
}) {
  const available = product.stock > 0;
  const categoryLabel = CATEGORY_LABELS[product.category] ?? product.category;
  const detailsId = `product-details-${product.id}`;
  const gradient = product.thumbnailGradient ?? 'var(--surface-muted)';
  const soldOutVeil = !available ? (
    <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-surface/60 text-xs font-semibold text-text">
      Sold out
    </span>
  ) : null;

  if (expanded) {
    return (
      <article className="flex min-h-36 overflow-hidden rounded-card border border-border bg-surface">
        <div className="relative w-20 shrink-0 border-r border-border" style={{ background: gradient }} aria-hidden="true">
          {soldOutVeil}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold tracking-widest text-text-faint uppercase">{categoryLabel}</p>
              <h3 className="line-clamp-2 text-[15px] leading-6 font-semibold text-text">{product.name}</h3>
            </div>
            <span className="shrink-0 text-sm font-semibold text-text tabular-nums">{CURRENCY.format(product.price)}</span>
          </div>

          <ColorSwatches
            product={product}
            selectedColor={selectedColor}
            available={available}
            onSelectColor={onSelectColor}
          />

          <dl id={detailsId} className="grid gap-1.5 text-xs">
            <div className="grid gap-0.5">
              <dt className="font-medium text-text-muted">Dimensions</dt>
              <dd className="tabular-nums text-text">{product.width} W × {product.depth} D × {product.height} H m</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="font-medium text-text-muted">Style</dt>
              <dd className="text-text">{product.styleTags.join(', ')}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="font-medium text-text-muted">Fits in</dt>
              <dd className="text-text">{zoneNames || 'Any open space'}</dd>
            </div>
          </dl>

          <div className="mt-auto flex items-center gap-2 pt-1.5">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={onToggleExpand}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-control border border-border px-3 text-xs font-semibold text-text transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
            >
              Hide details
              <ChevronDown aria-hidden="true" className="size-3.5 rotate-180" />
            </button>
            <button
              aria-label={`Place ${product.name} in room`}
              className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-control bg-accent px-1.5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none"
              disabled={!available || placing}
              type="button"
              onClick={() => onPlace(product)}
            >
              <Plus aria-hidden="true" className="size-4 shrink-0" />
              <span className="whitespace-nowrap">{placing ? 'Placing…' : 'Place'}</span>
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface transition-colors hover:border-accent/50 motion-reduce:transition-none">
      <div className="relative h-24 w-full shrink-0" style={{ background: gradient }} aria-hidden="true">
        <button
          type="button"
          aria-label={`View details for ${product.name}`}
          aria-expanded={false}
          onClick={onToggleExpand}
          className="absolute top-1 right-1 inline-flex size-9 items-center justify-center rounded-control border border-border bg-surface/85 text-text-muted backdrop-blur-sm transition-colors hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          <ChevronDown aria-hidden="true" className="size-4" />
        </button>
        {soldOutVeil}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        <h3 className="line-clamp-2 min-h-10 text-sm leading-5 font-semibold text-text">{product.name}</h3>

        <ColorSwatches
          product={product}
          selectedColor={selectedColor}
          available={available}
          onSelectColor={onSelectColor}
        />

        <p className="mt-auto flex items-baseline justify-between gap-1.5 pt-0.5">
          <span className="text-sm font-semibold text-text tabular-nums">{CURRENCY.format(product.price)}</span>
          <span className={`shrink-0 text-[11px] font-medium tabular-nums ${available ? 'text-text-muted' : 'text-error'}`}>
            {available ? `${product.stock} left` : 'Sold out'}
          </span>
        </p>
        <button
          aria-label={`Place ${product.name} in room`}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-control bg-accent px-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none"
          disabled={!available || placing}
          type="button"
          onClick={() => onPlace(product)}
        >
          <Plus aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{placing ? 'Placing…' : 'Place'}</span>
        </button>
      </div>
    </article>
  );
}

/**
 * Colorway picker for a product card. Products with a single color render a
 * static dot + material caption instead of a radio group, keeping the rows
 * the same height either way.
 */
function ColorSwatches({
  product,
  selectedColor,
  available,
  onSelectColor,
}: {
  product: FurnitureProduct;
  selectedColor: string;
  available: boolean;
  onSelectColor: (color: string) => void;
}) {
  if (product.colors.length <= 1) {
    return (
      <p className="flex h-9 min-w-0 items-center gap-1.5 text-xs text-text-muted">
        <span
          aria-hidden="true"
          className="inline-block size-3.5 shrink-0 rounded-pill border border-black/10"
          style={{ background: furnitureHex(selectedColor) }}
        />
        <span className="truncate capitalize">{selectedColor} · {product.material}</span>
      </p>
    );
  }

  const groupName = `colorway-${product.id}`;
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Color options for {product.name}</legend>
      <ul className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={`Colors for ${product.name}`}>
        {product.colors.map((colorName) => {
          const checked = selectedColor === colorName;
          const inputId = `${groupName}-${colorName}`;
          return (
            <li key={colorName}>
              <input
                className="peer sr-only"
                id={inputId}
                type="radio"
                name={groupName}
                value={colorName}
                checked={checked}
                disabled={!available}
                onChange={() => onSelectColor(colorName)}
              />
              <label
                htmlFor={inputId}
                aria-label={colorName}
                className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-pill border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none ${
                  checked
                    ? 'border-accent bg-accent-soft ring-2 ring-accent/25'
                    : 'border-border bg-surface-raised hover:border-accent'
                } ${!available ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-4 rounded-pill border border-black/10"
                  style={{ background: furnitureHex(colorName) }}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function FilterSelect({ children, label, onChange, value }: { children: ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  const id = `marketplace-${label.toLowerCase()}`;
  return (
    <div className="min-w-0">
      <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor={id}>{label}</label>
      <select id={id} className={`${TOOLBAR_CONTROL} px-2`} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </div>
  );
}
