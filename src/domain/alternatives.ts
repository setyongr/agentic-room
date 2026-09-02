/**
 * Cheaper-alternative suggestions for one placed marketplace item.
 *
 * Pure and deterministic: the result depends only on the catalog and the
 * supplied placed items, so identical inputs always produce identical
 * output. No pricing, store, or UI state is read or written.
 *
 * Candidates are same-category, strictly cheaper, in-stock products, capped
 * by the optional target price. Ranking is by weighted compatibility
 * (shared style tokens, shared colors, matching material, dimension
 * closeness), then by savings, then by product id as the deterministic
 * tie-break. Existing items never count toward the budget and locked items
 * cannot be replaced, so both are rejected with structured errors.
 */

import { PRODUCTS } from '@/data/products';
import type {
  CheaperAlternative,
  FurnitureProduct,
  PlacedFurniture,
  SerializableError,
  SerializableResult,
  SerializableValue,
} from '@/domain/types';

/** Weight of each signal in the composite compatibility score (sums to 1). */
export const ALTERNATIVE_COMPATIBILITY_WEIGHTS = {
  /** shared style tokens between current product and candidate */
  style: 0.4,
  /** shared color names between current product and candidate */
  color: 0.25,
  /** exact primary-material match */
  material: 0.15,
  /** width/depth/height closeness */
  dimension: 0.2,
} as const;

/** Default candidate count when `maxResults` is not given. */
export const DEFAULT_ALTERNATIVE_LIMIT = 5;

/** Options for {@link findCheaperAlternatives}. Absent fields = no constraint. */
export interface CheaperAlternativesOptions {
  /** inclusive upper bound on the replacement price in USD */
  targetPrice?: number;
  /** maximum number of candidates to return; defaults to {@link DEFAULT_ALTERNATIVE_LIMIT} */
  maxResults?: number;
}

/** A cheaper replacement for one placed marketplace item, with compatibility scores. */
export interface CheaperAlternativeCandidate extends CheaperAlternative {
  /** 0..1 shared-style compatibility with the current product */
  styleCompatibility: number;
  /** 0..1 footprint/dimension closeness to the current product */
  dimensionCompatibility: number;
}

/** Result of a cheaper-alternative suggestion for a single placed instance. */
export interface CheaperAlternativesResult {
  /** the placed instance the candidates would replace */
  instanceId: string;
  /** candidates sorted best first */
  alternatives: readonly CheaperAlternativeCandidate[];
  /** sum of savings across the returned candidates */
  totalSavings: number;
}

/** Internal ranked entry so the composite score is computed once. */
interface RankedAlternative {
  score: number;
  candidate: CheaperAlternativeCandidate;
}

function failure(
  code: string,
  message: string,
  details?: Readonly<Record<string, SerializableValue>>,
): SerializableError {
  return { ok: false, code, message, ...(details === undefined ? {} : { details }) };
}

/** Lowercased, whitespace-split, deduplicated tokens of a tag/color list. */
function tokens(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    for (const token of value.toLowerCase().split(' ')) {
      if (token.length > 0 && !out.includes(token)) {
        out.push(token);
      }
    }
  }
  return out;
}

/** Jaccard similarity of two token sets; 0 when either side has no tokens. */
function tokenJaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.includes(token)) shared += 1;
  }
  return shared / (left.length + right.length - shared);
}

/** Per-axis closeness ratio, 1 when equal; guarded against zero extents. */
function axisRatio(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return hi > 0 ? lo / hi : 1;
}

/** Mean width/depth/height closeness of the candidate to the current product. */
function dimensionScore(current: FurnitureProduct, candidate: FurnitureProduct): number {
  return (
    (axisRatio(current.width, candidate.width) +
      axisRatio(current.depth, candidate.depth) +
      axisRatio(current.height, candidate.height)) /
    3
  );
}

/**
 * Suggest cheaper same-category replacements for one placed marketplace item.
 *
 * The instance must exist, must be a marketplace item, and must not be
 * locked; otherwise a structured error is returned. Candidates are catalog
 * products with the same category, a strictly lower price, positive stock,
 * and (when given) a price at or below `options.targetPrice`. They are
 * ranked by composite compatibility, then savings, then product id.
 */
export function findCheaperAlternatives(
  instanceId: string,
  items: readonly PlacedFurniture[],
  options?: CheaperAlternativesOptions,
): SerializableResult<CheaperAlternativesResult> {
  const instance = items.find((item) => item.instanceId === instanceId);
  if (instance === undefined) {
    return failure('missing_instance', `No placed item with instanceId "${instanceId}".`, { instanceId });
  }
  if (instance.source === 'existing') {
    return failure(
      'existing_instance',
      'Existing room items never count toward the budget, so cheaper alternatives are not suggested for them.',
      { instanceId, productId: instance.productId },
    );
  }
  if (instance.locked) {
    return failure('locked_instance', 'Locked items cannot be replaced.', {
      instanceId,
      productId: instance.productId,
    });
  }

  const current = PRODUCTS.find((product) => product.id === instance.productId);
  if (current === undefined) {
    return failure('missing_product', `No catalog product with id "${instance.productId}".`, {
      productId: instance.productId,
    });
  }

  const targetPrice = options?.targetPrice;
  const maxResults = Math.max(0, Math.floor(options?.maxResults ?? DEFAULT_ALTERNATIVE_LIMIT));
  const weights = ALTERNATIVE_COMPATIBILITY_WEIGHTS;
  const currentStyleTokens = tokens(current.styleTags);
  const currentColorTokens = tokens(current.colors);

  const ranked: RankedAlternative[] = [];
  for (const product of PRODUCTS) {
    if (product.category !== current.category) continue;
    if (product.id === current.id) continue;
    if (product.price >= current.price) continue;
    if (product.stock <= 0) continue;
    if (targetPrice !== undefined && product.price > targetPrice) continue;

    const style = tokenJaccard(currentStyleTokens, tokens(product.styleTags));
    const color = tokenJaccard(currentColorTokens, tokens(product.colors));
    const material = current.material.toLowerCase() === product.material.toLowerCase() ? 1 : 0;
    const dimension = dimensionScore(current, product);
    ranked.push({
      score:
        weights.style * style + weights.color * color + weights.material * material + weights.dimension * dimension,
      candidate: {
        instanceId,
        currentProductId: current.id,
        currentProductName: current.name,
        currentPrice: current.price,
        alternativeProductId: product.id,
        alternativeProductName: product.name,
        alternativePrice: product.price,
        savings: current.price - product.price,
        styleCompatibility: style,
        dimensionCompatibility: dimension,
      },
    });
  }

  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.candidate.savings !== b.candidate.savings) return b.candidate.savings - a.candidate.savings;
    const idA = a.candidate.alternativeProductId;
    const idB = b.candidate.alternativeProductId;
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });

  const alternatives = ranked.slice(0, maxResults).map((entry) => entry.candidate);
  let totalSavings = 0;
  for (const alternative of alternatives) {
    totalSavings += alternative.savings;
  }
  return { ok: true, data: { instanceId, alternatives, totalSavings } };
}
