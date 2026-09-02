'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  PackageOpen,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { categories, colors, styles } from '@/data/products';
import type { FurnitureProduct, SearchFilters } from '@/domain/types';
import { useRoomStore } from '@/store/roomStore';

const PAGE_SIZE = 12;
const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

type Feedback = { kind: 'success' | 'error'; message: string } | null;

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
  const fitProductInZone = useRoomStore((state) => state.fitProductInZone);
  const placeProduct = useRoomStore((state) => state.placeProduct);
  const selectItem = useRoomStore((state) => state.selectItem);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [style, setStyle] = useState('');
  const [color, setColor] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [page, setPage] = useState(1);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [placingProductId, setPlacingProductId] = useState<string | null>(null);

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

    const placed = placeProduct(product.id, { zoneId }, 'human');
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
    <aside className="flex h-full min-h-0 flex-col border-border bg-surface" aria-label="Marketplace">
      <div className="border-b border-border px-4 py-5 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-widest text-accent-strong uppercase">Marketplace</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-text">Find your next piece</h2>
          </div>
          <span className="flex min-h-11 items-center rounded-pill bg-surface-muted px-3 text-sm font-medium text-text-muted tabular-nums">
            {results.total} {results.total === 1 ? 'piece' : 'pieces'}
          </span>
        </div>

        <div className="relative mt-4">
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
      </div>

      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <SlidersHorizontal aria-hidden="true" className="size-4 text-accent" />
            Refine your search
          </div>
          {hasActiveFilters ? (
            <button
              className="min-h-11 rounded-control px-2 text-sm font-medium text-accent-strong transition-colors hover:bg-accent-soft"
              type="button"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FilterSelect label="Category" value={category} onChange={(value) => resetPage(() => setCategory(value))}>
            <option value="">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{CATEGORY_LABELS[item]}</option>)}
          </FilterSelect>
          <FilterSelect label="Style" value={style} onChange={(value) => resetPage(() => setStyle(value))}>
            <option value="">All styles</option>
            {styles.map((item) => <option key={item} value={item}>{item}</option>)}
          </FilterSelect>
          <FilterSelect label="Color" value={color} onChange={(value) => resetPage(() => setColor(value))}>
            <option value="">All colors</option>
            {colors.map((item) => <option key={item} value={item} className="capitalize">{item}</option>)}
          </FilterSelect>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="minimum-price">Price range</label>
            <div className="flex items-center gap-1.5">
              <input id="minimum-price" aria-label="Minimum price" className="min-h-11 min-w-0 w-full rounded-control border border-border bg-surface-raised px-2 text-sm text-text tabular-nums placeholder:text-text-faint" inputMode="numeric" min="0" placeholder="Min" type="number" value={minPrice} onChange={(event) => resetPage(() => setMinPrice(event.target.value))} />
              <span aria-hidden="true" className="text-text-faint">–</span>
              <input aria-label="Maximum price" className="min-h-11 min-w-0 w-full rounded-control border border-border bg-surface-raised px-2 text-sm text-text tabular-nums placeholder:text-text-faint" inputMode="numeric" min="0" placeholder="Max" type="number" value={maxPrice} onChange={(event) => resetPage(() => setMaxPrice(event.target.value))} />
            </div>
          </div>
        </div>
      </div>

      <div aria-atomic="true" aria-live="polite" className="px-4 pt-3 sm:px-5">
        {feedback ? (
          <div className={`flex gap-2 rounded-control px-3 py-2 text-sm ${feedback.kind === 'success' ? 'bg-success-soft text-success' : 'bg-error-soft text-error'}`}>
            {feedback.kind === 'success' ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
            <p>{feedback.message}</p>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {results.products.length > 0 ? (
          <div className="space-y-3">
            {results.products.map((product) => (
              <ProductCard key={product.id} product={product} placing={placingProductId === product.id} onPlace={handlePlace} />
            ))}
          </div>
        ) : (
          <div className="flex min-h-64 flex-col items-start justify-center rounded-card border border-dashed border-border bg-surface-muted p-5">
            <PackageOpen aria-hidden="true" className="size-6 text-accent" />
            <h3 className="mt-4 text-base font-semibold text-text">No pieces match yet</h3>
            <p className="mt-1 text-sm leading-6 text-text-muted">Try a broader style, color, or price range to bring more of the collection into view.</p>
            {hasActiveFilters ? <button className="mt-4 min-h-11 rounded-control bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong" type="button" onClick={clearFilters}>Show the full collection</button> : null}
          </div>
        )}

        {hasMore ? (
          <button className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border bg-surface-raised px-4 text-sm font-semibold text-text transition-colors hover:bg-surface-muted" type="button" onClick={() => setPage((currentPage) => currentPage + 1)}>
            Show next 12 pieces
          </button>
        ) : null}
      </div>
    </aside>
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

function ProductCard({ onPlace, placing, product }: { onPlace: (product: FurnitureProduct) => void; placing: boolean; product: FurnitureProduct }) {
  const available = product.stock > 0;
  const categoryLabel = CATEGORY_LABELS[product.category] ?? product.category;
  return (
    <article className="group overflow-hidden rounded-card border border-border bg-surface-raised shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-pop motion-reduce:transform-none motion-reduce:transition-none">
      <div
        className="relative h-24 overflow-hidden border-b border-border"
        style={{ background: product.thumbnailGradient ?? 'var(--surface-muted)' }}
        aria-hidden="true"
      >
        <span className="absolute bottom-2 left-3 rounded-pill bg-surface-raised/90 px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-text-muted uppercase shadow-card">
          {categoryLabel}
        </span>
      </div>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-5 text-text">{product.name}</h3>
            <p className="mt-0.5 truncate text-xs text-text-muted">{product.styleTags[0] ?? 'Classic'} · {product.colors[0] ?? 'Natural'} · {product.material}</p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-accent-strong tabular-nums">{CURRENCY.format(product.price)}</span>
        </div>
        <p className="mt-2 border-t border-border pt-2 text-xs tabular-nums text-text-muted">{product.width} W × {product.depth} D × {product.height} H m</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${available ? 'text-success' : 'text-error'}`}>
            <span aria-hidden="true" className={`size-1.5 rounded-pill ${available ? 'bg-success' : 'bg-error'}`} />
            {available ? `${product.stock} in stock` : 'Out of stock'}
          </span>
          <button aria-label={`Place ${product.name} in room`} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-3 text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent-strong focus-visible:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-faint motion-reduce:transition-none" disabled={!available || placing} type="button" onClick={() => onPlace(product)}>
            <Plus aria-hidden="true" className="size-4" />
            {placing ? 'Placing…' : 'Place'}
          </button>
        </div>
      </div>
    </article>
  );
}
