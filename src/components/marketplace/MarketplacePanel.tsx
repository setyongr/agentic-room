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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        message: `“${prepared.name}” is placed in the room${added.ok ? '' : ''}. Open Edit to move or rotate it.`,
      });
    }
    setUploadBusy(false);
  }

  function handlePlace(product: FurnitureProduct) {
    setFeedback(null);
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
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-surface" aria-label="Marketplace">
      <header className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-widest text-accent-strong uppercase">Marketplace</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-text">
              {furnishTab === 'furniture' ? 'Find furniture' : 'Style the room'}
            </h2>
          </div>
          {furnishTab === 'furniture' ? (
            <span className="pt-1 text-sm font-medium text-text-muted tabular-nums">
              {results.total} {results.total === 1 ? 'result' : 'results'}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex rounded-control bg-surface-muted p-1" role="group" aria-label="Furnish tool">
          {FURNISH_SEGMENTS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={furnishTab === id}
              onClick={() => setFurnishTab(id)}
              className={`inline-flex min-h-11 w-1/3 min-w-0 items-center justify-center gap-1 rounded-control px-1 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${
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
            <div className="relative mt-3">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted" />
              <label className="sr-only" htmlFor="marketplace-search">Search furniture</label>
              <input
                id="marketplace-search"
                className="min-h-11 w-full rounded-control border border-border bg-surface-raised py-2 pr-3 pl-10 text-sm text-text placeholder:text-text-faint"
                placeholder="Search furniture, materials, styles"
                type="search"
                value={query}
                onChange={(event) => resetPage(() => setQuery(event.target.value))}
              />
            </div>

            <div className="mt-3">
              <FilterSelect label="Category" value={category} onChange={(value) => resetPage(() => setCategory(value))}>
                <option value="">All categories</option>
                {categories.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
              </FilterSelect>
            </div>

            <details className="mt-2" open={undefined}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text">
                <span className="flex items-center gap-2">
                  <SlidersHorizontal aria-hidden="true" className="size-4 text-accent" />
                  Filters
                </span>
                <span className="text-xs font-medium text-text-muted">{hasActiveFilters ? 'Active' : 'Optional'}</span>
              </summary>
              <div className="grid grid-cols-2 gap-3 border-t border-border py-3">
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
                    Clear filters
                  </button>
                ) : null}
              </div>
            </details>

            <div className="mt-3 flex items-center gap-3 rounded-control border border-dashed border-border bg-surface-muted/50 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text">Upload your own 3D model</p>
                <p className="mt-0.5 text-xs text-text-muted">.glb up to 15 MB · auto-fitted · session only</p>
              </div>
              <button
                type="button"
                disabled={uploadBusy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none"
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
            {uploadMessage ? (
              <p
                className={`mt-2 flex items-start gap-1.5 rounded-control px-3 py-2 text-xs ${
                  uploadMessage.kind === 'error' ? 'bg-error-soft text-error' : 'bg-success-soft text-success'
                }`}
                role="status"
              >
                {uploadMessage.kind === 'error' ? (
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                )}
                {uploadMessage.message}
              </p>
            ) : null}
          </>
        ) : null}
      </header>

      {furnishTab === 'finishes' ? (
        <RoomAppearancePanel />
      ) : furnishTab === 'room' ? (
        <RoomSizePanel />
      ) : (
        <>
          {feedback ? (
            <div aria-atomic="true" aria-live="polite" className="border-b border-border px-4 py-3 sm:px-5">
              <div className={`flex gap-2 text-sm ${feedback.kind === 'success' ? 'text-success' : 'text-error'}`}>
                {feedback.kind === 'success' ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
                <p>{feedback.message}</p>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-5">
            {results.products.length > 0 ? (
              <div className="divide-y divide-border">
                {results.products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    placing={placingProductId === product.id}
                    selectedColor={selectedColorByProduct[product.id] ?? product.colors[0] ?? ''}
                    zoneNames={zoneNamesByCategory[product.category] ?? ''}
                    expanded={expandedProductId === product.id}
                    onSelectColor={(colorName) =>
                      setSelectedColorByProduct((current) => ({ ...current, [product.id]: colorName }))
                    }
                    onToggleExpand={() =>
                      setExpandedProductId((current) => (current === product.id ? null : product.id))
                    }
                    onPlace={handlePlace}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-start justify-center py-8">
                <PackageOpen aria-hidden="true" className="size-6 text-accent" />
                <h3 className="mt-4 text-base font-semibold text-text">No pieces match yet</h3>
                <p className="mt-1 text-sm leading-6 text-text-muted">Try a broader style, color, or price range to bring more of the collection into view.</p>
                {hasActiveFilters ? <button className="mt-4 min-h-11 rounded-control bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong motion-reduce:transition-none" type="button" onClick={clearFilters}>Show the full collection</button> : null}
              </div>
            )}

            {results.total > PAGE_SIZE ? (
              <nav className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3" aria-label="Marketplace pagination">
                <button className="min-h-11 rounded-control px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none" disabled={page === 1} type="button" onClick={() => setPage((currentPage) => currentPage - 1)}>
                  Previous
                </button>
                <span className="text-xs text-text-muted tabular-nums">Page {page}</span>
                <button className="min-h-11 rounded-control px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none" disabled={!hasMore} type="button" onClick={() => setPage((currentPage) => currentPage + 1)}>
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
  const groupName = `colorway-${product.id}`;
  const detailsId = `product-details-${product.id}`;
  const material = product.material;
  return (
    <article className="py-4">
      <div className="flex gap-3">
        <div
          className="size-20 shrink-0 rounded-control border border-border"
          style={{ background: product.thumbnailGradient ?? 'var(--surface-muted)' }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="text-xs font-medium text-text-muted">{categoryLabel}</p>
              <h3 className="text-sm font-semibold leading-5 text-text">{product.name}</h3>
            </div>
            <span className="shrink-0 text-sm font-semibold text-text tabular-nums">{CURRENCY.format(product.price)}</span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
            <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-pill border border-border" style={{ background: furnitureHex(selectedColor) }} />
            <span className="truncate capitalize">{selectedColor} · {material}</span>
          </p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${available ? 'text-success' : 'text-error'}`}>
              <span aria-hidden="true" className={`size-1.5 rounded-pill ${available ? 'bg-success' : 'bg-error'}`} />
              {available ? `${product.stock} in stock` : 'Out of stock'}
            </span>
            <button aria-label={`Place ${product.name} in room`} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none" disabled={!available || placing} type="button" onClick={() => onPlace(product)}>
              <Plus aria-hidden="true" className="size-4" />
              {placing ? 'Placing…' : 'Place'}
            </button>
          </div>
        </div>
      </div>

      {product.colors.length > 1 ? (
        <fieldset className="mt-3">
          <legend className="sr-only">Available colors for {product.name}</legend>
          <ul className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Color options for ${product.name}`}>
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
                    className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-pill border px-2.5 text-xs font-medium transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent motion-reduce:transition-none ${
                      checked
                        ? 'border-accent bg-accent-soft text-accent-strong'
                        : 'border-border bg-surface-raised text-text-muted hover:border-accent hover:text-text'
                    } ${!available ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    <span aria-hidden="true" className="inline-block size-3.5 shrink-0 rounded-pill border border-black/10" style={{ background: furnitureHex(colorName) }} />
                    <span className="capitalize">{colorName}</span>
                    {checked ? <CheckCircle2 aria-hidden="true" className="size-3.5 text-accent" /> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      <div className="mt-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggleExpand}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-xs font-semibold text-accent-strong transition-colors hover:bg-accent-soft motion-reduce:transition-none"
        >
          {expanded ? 'Hide details' : 'View details'}
          <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded ? (
          <dl id={detailsId} className="mt-1 space-y-1 rounded-control border border-border bg-surface-muted/50 px-3 py-2 text-xs leading-5 text-text-muted">
            <div className="flex justify-between gap-3">
              <dt className="font-medium text-text">Dimensions</dt>
              <dd className="tabular-nums">{product.width} W × {product.depth} D × {product.height} H m</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium text-text">Style</dt>
              <dd className="text-right">{product.styleTags.join(', ')}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="font-medium text-text">Fits in</dt>
              <dd className="text-right">{zoneNames || 'Any open space'}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </article>
  );
}

function FilterSelect({ children, label, onChange, value }: { children: ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  const id = `marketplace-${label.toLowerCase()}`;
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor={id}>{label}</label>
      <select id={id} className="min-h-11 w-full rounded-control border border-border bg-surface-raised px-2 text-sm text-text" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </div>
  );
}
