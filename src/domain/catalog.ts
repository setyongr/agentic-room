/**
 * Deterministic catalog lookup and marketplace product search.
 *
 * Pure, side-effect-free helpers over the static PRODUCTS catalog. Shared by
 * the Zustand store and the WebMCP-facing store actions.
 */

import type {
  FurnitureProduct,
  SearchFilters,
  SearchProductsArgs,
  SearchProductsResult,
  SearchSort,
} from './types';
import { PRODUCTS } from '@/data/products';

/** Page size used when args.pageSize is absent or invalid. */
export const DEFAULT_PAGE_SIZE = 24;

/** Upper bound for args.pageSize; larger values are clamped down. */
export const MAX_PAGE_SIZE = 100;

/** Lookup a catalog product by its stable id; undefined when absent. */
export function getProductById(id: string): FurnitureProduct | undefined {
  return PRODUCTS.find((product) => product.id === id);
}

/**
 * Search the marketplace catalog with combined filters and deterministic
 * sorting. `page` is 1-based; pages below 1 clamp to 1 and pages past the
 * last one clamp to the last page. Ties in any sort keep the stable catalog
 * order. `relevance` sorts by catalog order.
 */
export function searchProducts(args: SearchProductsArgs): SearchProductsResult {
  const pageSize = normalizePageSize(args.pageSize);
  const { filters } = args;

  const query = filters.query?.trim().toLowerCase() ?? '';
  const categories = filters.categories ? new Set(filters.categories) : null;
  const styles = filters.styles ? lowercaseSet(filters.styles) : null;
  const colors = filters.colors ? lowercaseSet(filters.colors) : null;
  const materials = filters.materials ? lowercaseSet(filters.materials) : null;

  const matches: FurnitureProduct[] = [];
  for (const product of PRODUCTS) {
    if (!matchesFilters(product, query, categories, styles, colors, materials, filters)) continue;
    matches.push(product);
  }

  const total = matches.length;
  const lastPage = total === 0 ? 1 : Math.ceil(total / pageSize);
  const page = normalizePage(args.page, lastPage);

  sortMatches(matches, filters.sort);

  const start = (page - 1) * pageSize;
  return {
    products: matches.slice(start, start + pageSize),
    total,
    page,
    pageSize,
  };
}

function lowercaseSet(values: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const value of values) set.add(value.toLowerCase());
  return set;
}

function matchesFilters(
  product: FurnitureProduct,
  query: string,
  categories: Set<FurnitureProduct['category']> | null,
  styles: Set<string> | null,
  colors: Set<string> | null,
  materials: Set<string> | null,
  filters: SearchFilters,
): boolean {
  if (query) {
    const nameHit = product.name.toLowerCase().includes(query);
    const materialHit = product.material.toLowerCase().includes(query);
    const styleHit = product.styleTags.some((tag) => tag.toLowerCase().includes(query));
    if (!nameHit && !materialHit && !styleHit) return false;
  }
  if (categories && !categories.has(product.category)) return false;
  if (styles) {
    const styleSet = styles;
    if (!product.styleTags.some((tag) => styleSet.has(tag.toLowerCase()))) return false;
  }
  if (colors) {
    const colorSet = colors;
    if (!product.colors.some((color) => colorSet.has(color.toLowerCase()))) return false;
  }
  if (materials && !materials.has(product.material.toLowerCase())) return false;
  if (filters.minPrice !== undefined && product.price < filters.minPrice) return false;
  if (filters.maxPrice !== undefined && product.price > filters.maxPrice) return false;
  if (filters.inStockOnly && product.stock <= 0) return false;
  return true;
}

/**
 * Sort matches in place. `Array.prototype.sort` is spec-guaranteed stable
 * (ES2019+), so equal keys keep the filtered array's catalog order.
 */
function sortMatches(matches: FurnitureProduct[], sort: SearchSort | undefined): void {
  switch (sort) {
    case 'price_asc':
      matches.sort((a, b) => a.price - b.price);
      break;
    case 'price_desc':
      matches.sort((a, b) => b.price - a.price);
      break;
    case 'name_asc':
      matches.sort((a, b) => compareName(a, b));
      break;
    case 'name_desc':
      matches.sort((a, b) => compareName(b, a));
      break;
    case 'relevance':
    case undefined:
      // Catalog order is the deterministic relevance order.
      break;
  }
}

/** Locale-independent case-insensitive name comparison. */
function compareName(a: FurnitureProduct, b: FurnitureProduct): number {
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  return an < bn ? -1 : an > bn ? 1 : 0;
}

function normalizePageSize(pageSize: number | undefined): number {
  if (pageSize === undefined || !Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  const n = Math.floor(pageSize);
  if (n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

function normalizePage(page: number | undefined, lastPage: number): number {
  if (page === undefined || !Number.isFinite(page)) return 1;
  const n = Math.floor(page);
  if (n < 1) return 1;
  return Math.min(n, lastPage);
}
