/**
 * Catalog integrity and marketplace search contract tests.
 *
 * Guards the conventions every catalog change must honor: the data-layer
 * category list stays in sync with the domain categories, every product
 * stays inside the authored color/material vocabularies (they drive the
 * marketplace filter UI), ids are unique, extents are positive, and the
 * audio-visual categories added for TV / sound bar / speaker products are
 * findable through search and placeable on the media-wall zone.
 */

import { describe, expect, it } from 'vitest';
import { PRODUCTS, categories, colors, getProduct, materials } from '@/data/products';
import { DEFAULT_ROOM } from '@/data/demoRoom';
import { FURNITURE_CATEGORIES } from './types';
import { searchProducts } from './catalog';
import { fitProductInZone } from './placement';

const AUDIO_VISUAL_CATEGORIES = ['tv', 'soundbar', 'speaker'] as const;

/** Every product id is unique and every authored product resolves. */
describe('product catalog integrity', () => {
  it('keeps the data and domain category lists in sync', () => {
    expect([...categories]).toEqual([...FURNITURE_CATEGORIES]);
  });

  it('uses unique ids and positive extents across the whole catalog', () => {
    const ids = new Set<string>();
    for (const product of PRODUCTS) {
      expect(ids.has(product.id)).toBe(false);
      ids.add(product.id);
      expect(product.width).toBeGreaterThan(0);
      expect(product.depth).toBeGreaterThan(0);
      expect(product.height).toBeGreaterThan(0);
      expect(product.price).toBeGreaterThan(0);
      expect(getProduct(product.id)).toBe(product);
    }
    expect(PRODUCTS).toHaveLength(ids.size);
  });

  it('keeps every product color and material inside the filter vocabularies', () => {
    for (const product of PRODUCTS) {
      for (const color of product.colors) {
        expect(colors).toContain(color);
      }
      expect(materials).toContain(product.material);
    }
  });
});

/** TV / sound bar / speaker products: searchable and placeable on the media wall. */
describe('audio-visual catalog additions', () => {
  it('adds audio-visual products to the marketplace under their own categories', () => {
    const found = new Set<string>();
    for (const category of AUDIO_VISUAL_CATEGORIES) {
      const result = searchProducts({ filters: { categories: [category] }, pageSize: 100 });
      expect(result.total).toBeGreaterThan(0);
      expect(result.products.length).toBe(result.total);
      for (const product of result.products) {
        expect(product.category).toBe(category);
        found.add(product.id);
      }
    }
    expect(found.size).toBeGreaterThanOrEqual(9);
    expect(found.has('aria-55-oled-tv')).toBe(true);
    expect(found.has('sonora-tower-speaker')).toBe(true);
    expect(found.has('sonora-soundbar')).toBe(true);
  });

  it('finds a TV by name query', () => {
    const result = searchProducts({ filters: { query: 'OLED' }, pageSize: 100 });
    expect(result.products.map((p) => p.id)).toEqual(
      expect.arrayContaining(['aria-55-oled-tv', 'nord-65-oled-tv']),
    );
  });

  it('places every audio-visual product on the media-wall zone', () => {
    for (const category of AUDIO_VISUAL_CATEGORIES) {
      for (const product of PRODUCTS.filter((entry) => entry.category === category)) {
        const fit = fitProductInZone(product.id, DEFAULT_ROOM, 'media-wall', {});
        expect(fit.ok).toBe(true);
        if (!fit.ok) {
          throw new Error(`${product.id} rejected by media-wall: ${fit.message}`);
        }
      }
    }
  });
});
