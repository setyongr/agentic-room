/**
 * Authored visual registry for room styling and furniture colorways.
 *
 * Single local source for every non-semantic color/gradient the app shows:
 * wall/floor/wallpaper finish options (stable ids, labels, paint colors,
 * pattern metadata) and the furniture color-to-hex vocabulary. The 3D
 * renderer consumes the structured pattern/base/seam primitives directly —
 * it never parses CSS. Components keep using semantic Tailwind tokens for
 * structure, text, and status colors; raw values live here only.
 *
 * No clocks, randomness, or runtime assets: every value is hand-authored
 * and deterministic, so replays and screenshots are stable.
 */

import type { CSSProperties } from 'react';
import type {
  FloorFinishId,
  RoomAppearance,
  WallFinishId,
  WallpaperId,
} from '@/domain/types';

/* ------------------------------------------------------------------ */
/* Furniture colorways                                                 */
/* ------------------------------------------------------------------ */

/**
 * Catalog color vocabulary mapped to hex. Kept verbatim from the 3D mesh
 * palette so swatches, thumbnails, and the scene share one color source.
 */
export const FURNITURE_COLOR_HEX: Readonly<Record<string, string>> = {
  sand: '#E4D5B5',
  ivory: '#F7F3EA',
  charcoal: '#3A3E44',
  sage: '#A3B18A',
  terracotta: '#C96F4A',
  mustard: '#E4B95B',
  slate: '#6E7B8A',
  cream: '#F3E9DC',
  rust: '#B65C3C',
  olive: '#7E8B5A',
  blush: '#E8B4A0',
  linen: '#EDE4D5',
  espresso: '#4E3628',
  oak: '#C69C6D',
  walnut: '#6B4A32',
  ash: '#B9C0C4',
  beige: '#E6D9C3',
  clay: '#B0714F',
  forest: '#3E5C46',
  navy: '#33415E',
  stone: '#B9B4AB',
  butter: '#F0D48B',
  honey: '#D9A441',
  mocha: '#7B5B47',
  white: '#FBFBF9',
  black: '#26262A',
  moss: '#8A9A6B',
  fern: '#5E7C54',
  amber: '#E0A34E',
};

/** Hex for any color name, falling back to the warm linen neutral. */
export function furnitureHex(colorName: string): string {
  return FURNITURE_COLOR_HEX[colorName] ?? FURNITURE_COLOR_HEX.linen;
}

/* ------------------------------------------------------------------ */
/* Wall finishes                                                       */
/* ------------------------------------------------------------------ */

/** An authored wall finish: paint color, trim/baseboard color, and the stage void tone. */
export interface WallFinishOption {
  id: WallFinishId;
  name: string;
  /** wall paint color (also the wallpaper ground when wallpaper is on) */
  wall: string;
  /** baseboard/trim color */
  trim: string;
  /** color of the stage void outside the room shell */
  voidColor: string;
}

/** Authored wall finishes in stable order. */
export const WALL_FINISHES: readonly WallFinishOption[] = [
  { id: 'gallery-white', name: 'Gallery White', wall: '#f8fafc', trim: '#e2e8f0', voidColor: '#e2e8f0' },
  { id: 'warm-sand', name: 'Warm Sand', wall: '#e9dfcf', trim: '#d8c8b1', voidColor: '#ddd0bd' },
  { id: 'soft-sage', name: 'Soft Sage', wall: '#cbd5c1', trim: '#aebfa5', voidColor: '#b9c5b3' },
  { id: 'clay-plaster', name: 'Clay Plaster', wall: '#d8b7a3', trim: '#c49b84', voidColor: '#c9a18d' },
];

/* ------------------------------------------------------------------ */
/* Floor finishes                                                      */
/* ------------------------------------------------------------------ */

/** An authored floor finish with its deterministic plank/tile pattern colors. */
export interface FloorFinishOption {
  id: FloorFinishId;
  name: string;
  pattern: 'plank' | 'tile';
  /** primary floor color */
  base: string;
  /** joint/seam color (used at low opacity over `base`) */
  seam: string;
}

/** Authored floor finishes in stable order. */
export const FLOOR_FINISHES: readonly FloorFinishOption[] = [
  { id: 'natural-oak', name: 'Natural Oak', pattern: 'plank', base: '#c69c6d', seam: 'rgba(78, 54, 40, 0.28)' },
  { id: 'white-oak', name: 'White Oak', pattern: 'plank', base: '#d8c9ae', seam: 'rgba(100, 83, 65, 0.22)' },
  { id: 'walnut', name: 'Walnut', pattern: 'plank', base: '#6b4a32', seam: 'rgba(38, 25, 18, 0.40)' },
  { id: 'slate-tile', name: 'Slate Tile', pattern: 'tile', base: '#94a3b8', seam: 'rgba(71, 85, 105, 0.45)' },
];

/* ------------------------------------------------------------------ */
/* Wallpapers                                                          */
/* ------------------------------------------------------------------ */

/** An authored wallpaper with its procedural pattern kind and ink color. */
export interface WallpaperOption {
  id: WallpaperId;
  name: string;
  pattern: 'none' | 'stripe' | 'botanical' | 'arch';
  /** pattern ink drawn over the wall paint; absent for `none` */
  ink?: string;
}

/** Authored wallpaper choices in stable order. */
export const WALLPAPERS: readonly WallpaperOption[] = [
  { id: 'none', name: 'Plain Walls', pattern: 'none' },
  { id: 'linen-stripe', name: 'Linen Stripe', pattern: 'stripe', ink: 'rgba(100, 116, 139, 0.25)' },
  { id: 'botanical-line', name: 'Botanical Line', pattern: 'botanical', ink: '#70866c' },
  { id: 'arched-geo', name: 'Arched Geo', pattern: 'arch', ink: '#a17859' },
];

/* ------------------------------------------------------------------ */
/* Defaults and lookups                                                */
/* ------------------------------------------------------------------ */

/** The default room styling: painted white walls, oak planks, no wallpaper. */
export const DEFAULT_ROOM_APPEARANCE: RoomAppearance = {
  wallFinishId: 'gallery-white',
  floorFinishId: 'natural-oak',
  wallpaperId: 'none',
};

/** Look up a wall finish, falling back to the gallery-white default. */
export function getWallFinish(id: WallFinishId): WallFinishOption {
  return WALL_FINISHES.find((option) => option.id === id) ?? WALL_FINISHES[0];
}

/** Look up a floor finish, falling back to the natural-oak default. */
export function getFloorFinish(id: FloorFinishId): FloorFinishOption {
  return FLOOR_FINISHES.find((option) => option.id === id) ?? FLOOR_FINISHES[0];
}

/** Look up a wallpaper choice, falling back to plain walls. */
export function getWallpaper(id: WallpaperId): WallpaperOption {
  return WALLPAPERS.find((option) => option.id === id) ?? WALLPAPERS[0];
}

/** Resolved render options for an appearance (defensive per-field fallback). */
export interface ResolvedRoomAppearance {
  wall: WallFinishOption;
  floor: FloorFinishOption;
  wallpaper: WallpaperOption;
}

/** Resolve every id of an appearance to its authored option. */
export function resolveAppearance(appearance: RoomAppearance): ResolvedRoomAppearance {
  return {
    wall: getWallFinish(appearance.wallFinishId),
    floor: getFloorFinish(appearance.floorFinishId),
    wallpaper: getWallpaper(appearance.wallpaperId),
  };
}

/**
 * Deterministic CSS preview gradient for a room appearance, used by UI
 * thumbnails only (wall → floor, with the wallpaper ink as a final stop
 * when a pattern is applied).
 */
export function appearancePreviewGradient(appearance: RoomAppearance): string {
  const { wall, floor, wallpaper } = resolveAppearance(appearance);
  if (wallpaper.pattern === 'none' || wallpaper.ink === undefined) {
    return `linear-gradient(135deg, ${wall.wall}, ${wall.trim} 45%, ${floor.base})`;
  }
  return `linear-gradient(135deg, ${wall.wall}, ${wall.wall} 35%, ${wallpaper.ink} 70%, ${floor.base})`;
}

/** Preview seams sit above the base color so both plank and tile joints remain visible. */
export function floorPreviewStyle(floor: FloorFinishOption): CSSProperties {
  return {
    backgroundColor: floor.base,
    backgroundImage: `linear-gradient(0deg, ${floor.seam} 1px, transparent 1px), linear-gradient(90deg, ${floor.seam} 1px, transparent 1px)`,
    backgroundSize: floor.pattern === 'tile' ? '24px 24px' : '64px 16px',
  };
}

/** Local vector motifs make each wallpaper recognizable without network assets. */
export function wallpaperPreviewStyle(wallpaper: WallpaperOption): CSSProperties {
  const backgroundColor = WALL_FINISHES[0].wall;
  const ink = wallpaper.ink ?? backgroundColor;
  if (wallpaper.pattern === 'none') return { backgroundColor };
  if (wallpaper.pattern === 'stripe') return {
    backgroundColor,
    backgroundImage: `repeating-linear-gradient(90deg, ${ink} 0 3px, transparent 3px 14px)`,
  };
  const motif = wallpaper.pattern === 'arch'
    ? `<path d="M6 30V16a10 10 0 0 1 20 0v14" fill="none" stroke="${ink}" stroke-width="2"/>`
    : `<path d="M16 32Q20 18 16 3" fill="none" stroke="${ink}" stroke-width="1.5"/><g fill="${ink}"><ellipse cx="11" cy="12" rx="6" ry="2.5" transform="rotate(30 11 12)"/><ellipse cx="23" cy="19" rx="6" ry="2.5" transform="rotate(-30 23 19)"/><ellipse cx="12" cy="25" rx="6" ry="2.5" transform="rotate(30 12 25)"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="36" viewBox="0 0 32 36">${motif}</svg>`;
  return { backgroundColor, backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, backgroundSize: '32px 36px' };
}
