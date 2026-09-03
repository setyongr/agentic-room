'use client';

/**
 * Category-aware simplified geometry for placed furniture.
 *
 * Every catalog category is built from boxes / cylinders / spheres with a
 * warm, modern, product-derived palette, so a product always renders a
 * dependable visible fallback even without a GLB asset. The model is
 * generated per product + selection state (memoized); parts sit on the
 * floor (y = 0) inside the product's real width/depth/height extents, and
 * the group carries the domain yaw rotation (degrees about +y, +90 = front
 * faces +x) so the rendered footprint matches the validation math.
 *
 * Interaction & motion:
 * - Pointer down on any part selects the instance (stopPropagation).
 * - Flat rings under the item mark selection and invalid placement. Rings
 *   stay raycastable, so a click on them still selects the item via bubbling.
 * - New / replaced instances pop in (scale + opacity fade); moves and
 *   rotations are damped toward the store target in useFrame. Nothing in
 *   the frame loop allocates, and pointer input stays live mid-animation.
 */

import { Component, Suspense, useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { furnitureHex } from '@/data/appearance';
import type { FurnitureProduct, FurnitureVariant, PlacedFurniture } from '@/domain/types';

const DEG2RAD = Math.PI / 180;

/** Selection ring color (mustard) and invalid ring color (terracotta). */
const SELECT_RING_COLOR = '#E4B95B';
const INVALID_RING_COLOR = '#C96F4A';

/**
 * One primitive of the simplified model, in item-local coordinates with the
 * floor at y = 0. Geometry segment counts are capped so total cost stays
 * low even with a fully furnished room.
 */
type Part = PartBase &
  (
    | { kind: 'box'; args: [number, number, number] }
    | { kind: 'cylinder'; args: [number, number, number, number] }
    | { kind: 'sphere'; args: [number, number, number] }
  );

interface PartBase {
  position: [number, number, number];
  rotation?: [number, number, number];
  cast?: boolean;
  receive?: boolean;
  /** index into the category's material list */
  mat: number;
}

interface BuiltModel {
  parts: readonly Part[];
  materials: readonly THREE.MeshStandardMaterial[];
}

/* ------------------------------------------------------------------ */
/* Per-category geometry builders (all coordinates in item-local space) */
/* ------------------------------------------------------------------ */

/** Long low seat with armrests, back, cushions, and a slim raised base. */
function buildSofa(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const seatTop = h * 0.45;
  const backH = h * 0.56;
  const armH = h * 0.6;
  const footH = Math.max(0.045, h * 0.07);
  const footR = 0.024;
  const ox = w / 2 - 0.055;
  const oz = d / 2 - 0.055;
  return [
    { kind: 'box', args: [w, seatTop, d * 0.94], position: [0, seatTop / 2, 0], mat: 0, cast: true, receive: true },
    { kind: 'box', args: [w * 0.98, backH, 0.2], position: [0, seatTop + backH / 2 - h * 0.04, -d / 2 + 0.1], mat: 0, cast: true },
    { kind: 'box', args: [0.16, armH, d * 0.8], position: [-(w / 2 - 0.08), armH / 2, 0], mat: 1, cast: true },
    { kind: 'box', args: [0.16, armH, d * 0.8], position: [w / 2 - 0.08, armH / 2, 0], mat: 1, cast: true },
    { kind: 'box', args: [w * 0.44, 0.07, d * 0.86], position: [-w * 0.23, seatTop + 0.035, 0], mat: 1, cast: true, receive: true },
    { kind: 'box', args: [w * 0.44, 0.07, d * 0.86], position: [w * 0.23, seatTop + 0.035, 0], mat: 1, cast: true, receive: true },
    { kind: 'cylinder', args: [footR, footR, footH, 12], position: [-ox, footH / 2, -oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 12], position: [ox, footH / 2, -oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 12], position: [-ox, footH / 2, oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 12], position: [ox, footH / 2, oz], mat: 2, cast: true },
  ];
}

/** Boxy upholstered chair with armrests, seat cushion and feet. */
function buildArmchair(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const seatTop = h * 0.36;
  const backH = h * 0.6;
  const armH = h * 0.52;
  const footR = 0.024;
  const footH = h * 0.07;
  const ox = w / 2 - 0.035;
  const oz = d / 2 - 0.035;
  return [
    { kind: 'box', args: [w, seatTop, d * 0.94], position: [0, seatTop / 2, 0], mat: 0, cast: true, receive: true },
    { kind: 'box', args: [w * 0.95, backH, 0.18], position: [0, seatTop + backH / 2 - h * 0.03, -d / 2 + 0.09], mat: 0, cast: true },
    { kind: 'box', args: [0.11, armH, d * 0.78], position: [-(w / 2 - 0.055), armH / 2, 0], mat: 1, cast: true },
    { kind: 'box', args: [0.11, armH, d * 0.78], position: [w / 2 - 0.055, armH / 2, 0], mat: 1, cast: true },
    { kind: 'box', args: [w * 0.9, 0.06, d * 0.88], position: [0, seatTop + 0.03, 0], mat: 1, cast: true, receive: true },
    { kind: 'cylinder', args: [footR, footR, footH, 14], position: [-ox, footH / 2, -oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 14], position: [ox, footH / 2, -oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 14], position: [-ox, footH / 2, oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 14], position: [ox, footH / 2, oz], mat: 2, cast: true },
  ];
}

/** Light open-frame chair: slim back, spindly legs, no side arms. */
function buildAccentChair(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const seatTop = h * 0.34;
  const backH = h * 0.62;
  const footH = h * 0.3;
  const footR = 0.02;
  const ox = w / 2 - 0.03;
  const oz = d / 2 - 0.03;
  return [
    { kind: 'box', args: [w * 0.92, 0.05, d * 0.92], position: [0, 0.025, 0], mat: 2, cast: true, receive: true },
    { kind: 'box', args: [w * 0.9, h * 0.18, d * 0.88], position: [0, seatTop - h * 0.09, 0], mat: 0, cast: true, receive: true },
    { kind: 'box', args: [w * 0.92, backH, 0.1], position: [0, seatTop + backH / 2 - h * 0.02, -d / 2 + 0.05], mat: 0, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 14], position: [-ox, footH / 2, -oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 14], position: [ox, footH / 2, -oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 14], position: [-ox, footH / 2, oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [footR, footR, footH, 14], position: [ox, footH / 2, oz], mat: 2, cast: true },
  ];
}

/** Low table: round pedestal variant for square footprints, else slab + shelf + legs. */
function buildCoffeeTable(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const round = Math.abs(w - d) < 0.08;
  if (round) {
    const r = w / 2;
    return [
      { kind: 'cylinder', args: [r, r, 0.05, 24], position: [0, h - 0.025, 0], mat: 0, cast: true, receive: true },
      { kind: 'cylinder', args: [r * 0.34, r * 0.4, h - 0.06, 18], position: [0, (h - 0.06) / 2, 0], mat: 1, cast: true },
      { kind: 'cylinder', args: [r * 0.55, r * 0.55, 0.028, 24], position: [0, 0.014, 0], mat: 1, receive: true },
    ];
  }
  const legH = h - 0.055;
  const ox = w / 2 - 0.045;
  const oz = d / 2 - 0.045;
  return [
    { kind: 'box', args: [w, 0.05, d], position: [0, h - 0.025, 0], mat: 0, cast: true, receive: true },
    { kind: 'box', args: [w * 0.64, 0.024, d * 0.64], position: [0, h * 0.36, 0], mat: 1, cast: true },
    { kind: 'cylinder', args: [0.022, 0.022, legH, 14], position: [-ox, legH / 2, -oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [0.022, 0.022, legH, 14], position: [ox, legH / 2, -oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [0.022, 0.022, legH, 14], position: [-ox, legH / 2, oz], mat: 2, cast: true },
    { kind: 'cylinder', args: [0.022, 0.022, legH, 14], position: [ox, legH / 2, oz], mat: 2, cast: true },
  ];
}

/** Pedestal side table: round top, tapered column, disc base. */
function buildSideTable(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const m = Math.min(w, d);
  const columnH = h - 0.075;
  return [
    { kind: 'cylinder', args: [m * 0.24, m * 0.24, 0.03, 20], position: [0, 0.015, 0], mat: 2, receive: true },
    { kind: 'cylinder', args: [m * 0.07, m * 0.1, columnH, 16], position: [0, 0.03 + columnH / 2, 0], mat: 1, cast: true },
    { kind: 'cylinder', args: [m * 0.5, m * 0.5, 0.045, 24], position: [0, h - 0.0225, 0], mat: 0, cast: true, receive: true },
  ];
}

/** Entry console: top slab, open shelf, four corner legs. */
function buildConsole(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const legH = h - 0.05;
  const ox = w / 2 - 0.02;
  const oz = d / 2 - 0.02;
  return [
    { kind: 'box', args: [w, 0.05, d], position: [0, h - 0.025, 0], mat: 0, cast: true, receive: true },
    { kind: 'box', args: [w * 0.92, 0.03, d * 0.8], position: [0, h * 0.34 - 0.015, 0], mat: 1, cast: true },
    { kind: 'box', args: [0.04, legH, 0.04], position: [-ox, legH / 2, -oz], mat: 2, cast: true },
    { kind: 'box', args: [0.04, legH, 0.04], position: [ox, legH / 2, -oz], mat: 2, cast: true },
    { kind: 'box', args: [0.04, legH, 0.04], position: [-ox, legH / 2, oz], mat: 2, cast: true },
    { kind: 'box', args: [0.04, legH, 0.04], position: [ox, legH / 2, oz], mat: 2, cast: true },
  ];
}

/** Floor lamp: base + pole + warm shade; wide-footprint products get an arc arm. */
function buildFloorLamp(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const m = Math.min(w, d);
  const arc = w > d * 1.4;
  const baseR = m * 0.34;
  const poleH = h - 0.24;
  const poleTop = 0.035 + poleH;
  const shadeR = m * 0.42;
  if (arc) {
    const armLen = w * 0.52;
    const armY = poleTop + 0.016;
    return [
      { kind: 'cylinder', args: [baseR, baseR, 0.035, 22], position: [0, 0.0175, 0], mat: 0, receive: true },
      { kind: 'cylinder', args: [0.016, 0.016, poleH, 12], position: [0, poleTop / 2, 0], mat: 0, cast: true },
      { kind: 'box', args: [armLen, 0.032, 0.032], position: [armLen / 2 - 0.02, armY, 0], mat: 0, cast: true },
      { kind: 'cylinder', args: [shadeR * 1.15, shadeR * 1.15, 0.2, 20], position: [armLen - 0.04, armY - 0.12, 0], mat: 1, cast: true },
    ];
  }
  return [
    { kind: 'cylinder', args: [baseR, baseR, 0.035, 22], position: [0, 0.0175, 0], mat: 0, receive: true },
    { kind: 'cylinder', args: [0.016, 0.016, poleH, 12], position: [0, poleTop / 2, 0], mat: 0, cast: true },
    { kind: 'cylinder', args: [shadeR, shadeR, 0.2, 20], position: [0, h - 0.1, 0], mat: 1, cast: true },
  ];
}

/** Table lamp: disc base, tapered ceramic body, glowing shade and bulb. */
function buildTableLamp(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const m = Math.min(w, d);
  return [
    { kind: 'cylinder', args: [m * 0.42, m * 0.42, 0.022, 18], position: [0, 0.011, 0], mat: 0, receive: true },
    { kind: 'cylinder', args: [m * 0.22, m * 0.3, h * 0.68, 18], position: [0, 0.022 + h * 0.34, 0], mat: 1, cast: true },
    { kind: 'cylinder', args: [m * 0.55, m * 0.55, h * 0.16, 20], position: [0, h * 0.82, 0], mat: 2, cast: true },
    { kind: 'sphere', args: [m * 0.12, 14, 10], position: [0, h * 0.75, 0], mat: 3 },
  ];
}

/** Flat rug with a raised inner panel; receives shadows only. */
function buildRug(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  return [
    { kind: 'box', args: [w, h, d], position: [0, h / 2, 0], mat: 0, receive: true },
    { kind: 'box', args: [w - 0.1, h * 0.5, d - 0.1], position: [0, h * 0.75, 0], mat: 1, receive: true },
  ];
}

/** Freestanding ladder shelf (side panels + boards) or wall shelf (board + brackets). */
function buildShelf(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  if (h < 0.6) {
    return [
      { kind: 'box', args: [w, 0.032, d], position: [0, h - 0.016, 0], mat: 0, cast: true, receive: true },
      { kind: 'box', args: [0.05, h * 0.38, d * 0.7], position: [-w * 0.36, h * 0.19, 0], mat: 1, cast: true },
      { kind: 'box', args: [0.05, h * 0.38, d * 0.7], position: [w * 0.36, h * 0.19, 0], mat: 1, cast: true },
    ];
  }
  const sideT = 0.03;
  return [
    { kind: 'box', args: [sideT, h, d], position: [-(w / 2 - sideT / 2), h / 2, 0], mat: 0, cast: true },
    { kind: 'box', args: [sideT, h, d], position: [w / 2 - sideT / 2, h / 2, 0], mat: 0, cast: true },
    { kind: 'box', args: [w - 0.06, 0.022, d * 0.94], position: [0, h * 0.2, 0], mat: 1, cast: true, receive: true },
    { kind: 'box', args: [w - 0.06, 0.022, d * 0.94], position: [0, h * 0.44, 0], mat: 1, cast: true, receive: true },
    { kind: 'box', args: [w - 0.06, 0.022, d * 0.94], position: [0, h * 0.68, 0], mat: 1, cast: true, receive: true },
    { kind: 'box', args: [w - 0.06, 0.022, d * 0.94], position: [0, h * 0.92, 0], mat: 1, cast: true, receive: true },
  ];
}

/** Closed sideboard with doors, or a hutch (lower body + upper cabinet) for tall units. */
function buildCabinet(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  if (h > 1.0) {
    const lowerH = h * 0.4;
    const upperH = h * 0.55;
    return [
      { kind: 'box', args: [w, lowerH, d], position: [0, lowerH / 2 + 0.01, 0], mat: 0, cast: true, receive: true },
      { kind: 'box', args: [w * 0.86, 0.028, d * 0.9], position: [0, lowerH + 0.024, 0], mat: 1, cast: true },
      { kind: 'box', args: [w * 0.84, upperH, d * 0.88], position: [0, lowerH + 0.038 + upperH / 2, 0], mat: 0, cast: true },
      { kind: 'box', args: [w * 1.02, 0.035, d * 1.05], position: [0, h * 0.95 + 0.0555, 0], mat: 1, cast: true },
      { kind: 'box', args: [w * 0.34, 0.012, d * 0.8], position: [-w * 0.19, lowerH / 2 + 0.01, d / 2 - 0.006], mat: 1 },
      { kind: 'box', args: [w * 0.34, 0.012, d * 0.8], position: [w * 0.19, lowerH / 2 + 0.01, d / 2 - 0.006], mat: 1 },
    ];
  }
  const bodyH = h * 0.86;
  const footH = 0.05;
  const ox = w / 2 - 0.03;
  const oz = d / 2 - 0.03;
  return [
    { kind: 'box', args: [w, bodyH, d], position: [0, footH + bodyH / 2, 0], mat: 0, cast: true, receive: true },
    { kind: 'box', args: [w * 1.02, 0.035, d * 1.05], position: [0, h - 0.0175, 0], mat: 1, cast: true },
    { kind: 'box', args: [w * 0.44, 0.012, d * 0.82], position: [-w * 0.23, footH + bodyH / 2, d / 2 - 0.007], mat: 1 },
    { kind: 'box', args: [w * 0.44, 0.012, d * 0.82], position: [w * 0.23, footH + bodyH / 2, d / 2 - 0.007], mat: 1 },
    { kind: 'box', args: [0.03, footH, 0.03], position: [-ox, footH / 2, -oz], mat: 2, cast: true },
    { kind: 'box', args: [0.03, footH, 0.03], position: [ox, footH / 2, -oz], mat: 2, cast: true },
    { kind: 'box', args: [0.03, footH, 0.03], position: [-ox, footH / 2, oz], mat: 2, cast: true },
    { kind: 'box', args: [0.03, footH, 0.03], position: [ox, footH / 2, oz], mat: 2, cast: true },
  ];
}

/** Basket (rattan), cushioned ottoman, or modular cube with shelf lines. */
function buildStorage(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const m = Math.min(w, d);
  if (p.material === 'rattan') {
    const r = m * 0.36;
    return [
      { kind: 'cylinder', args: [r, r * 0.8, h * 0.78, 18], position: [0, h * 0.39, 0], mat: 0, cast: true, receive: true },
      { kind: 'cylinder', args: [r * 1.05, r * 1.05, 0.03, 18], position: [0, h * 0.78 + 0.015, 0], mat: 1, cast: true },
    ];
  }
  if (h < 0.5) {
    return [
      { kind: 'box', args: [w, h * 0.74, d], position: [0, h * 0.37, 0], mat: 0, cast: true, receive: true },
      { kind: 'box', args: [w * 1.03, h * 0.24, d * 1.03], position: [0, h * 0.88, 0], mat: 1, cast: true, receive: true },
    ];
  }
  return [
    { kind: 'box', args: [w, h * 0.92, d], position: [0, h * 0.46, 0], mat: 0, cast: true, receive: true },
    { kind: 'box', args: [w * 0.88, 0.016, d * 0.86], position: [0, h * 0.64, 0], mat: 1, cast: true },
    { kind: 'box', args: [w * 0.88, 0.016, d * 0.86], position: [0, h * 0.3, 0], mat: 1, cast: true },
  ];
}

/** Terracotta pot, trunk and layered foliage spheres. */
function buildPlant(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const m = Math.min(w, d);
  const potH = Math.min(Math.max(h * 0.22, 0.16), 0.3);
  const r = m * 0.38;
  const folY = potH + h * 0.6;
  return [
    { kind: 'cylinder', args: [m * 0.3, m * 0.22, potH, 18], position: [0, potH / 2, 0], mat: 0, cast: true, receive: true },
    { kind: 'cylinder', args: [0.016, 0.02, h * 0.5, 10], position: [0, potH + h * 0.25, 0], mat: 2, cast: true },
    { kind: 'sphere', args: [r, 16, 12], position: [0, folY, 0], mat: 1, cast: true },
    { kind: 'sphere', args: [r * 0.58, 14, 10], position: [r * 0.55, folY + r * 0.35, r * 0.2], mat: 1, cast: true },
  ];
}

/** Two floor-length panels under a rod. */
function buildCurtain(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  return [
    { kind: 'box', args: [w * 0.47, h, d], position: [-w * 0.235, h / 2, 0], mat: 0 },
    { kind: 'box', args: [w * 0.47, h, d], position: [w * 0.235, h / 2, 0], mat: 0 },
    { kind: 'cylinder', args: [0.018, 0.018, w * 1.04, 12], rotation: [0, 0, Math.PI / 2], position: [0, h + 0.02, 0], mat: 1 },
  ];
}

/** Wall art / mirror, hanging macrame, candle trio, or vase set. */
function buildDecor(p: FurnitureProduct): Part[] {
  const { width: w, depth: d, height: h } = p;
  const m = Math.min(w, d);
  const flat = d <= 0.12 && h >= 0.5;
  if (flat) {
    if (w > 0.6 && h > 0.55) {
      return [
        { kind: 'box', args: [w, 0.045, h], position: [0, h / 2, 0], mat: 0, cast: true },
        { kind: 'box', args: [w * 0.88, 0.04, h * 0.88], position: [0, h / 2, 0], mat: 1 },
      ];
    }
    return [
      { kind: 'box', args: [w, 0.05, h * 0.72], position: [0, h * 0.64, 0], mat: 0 },
      { kind: 'cylinder', args: [0.009, 0.009, h * 0.4, 8], position: [-w * 0.3, h * 0.2, 0], mat: 1 },
      { kind: 'cylinder', args: [0.009, 0.009, h * 0.4, 8], position: [0, h * 0.2, 0], mat: 1 },
      { kind: 'cylinder', args: [0.009, 0.009, h * 0.4, 8], position: [w * 0.3, h * 0.2, 0], mat: 1 },
    ];
  }
  if (h < 0.3) {
    const r = Math.min(m * 0.12, 0.035);
    return [
      { kind: 'box', args: [w, 0.024, d], position: [0, 0.012, 0], mat: 2, receive: true },
      { kind: 'cylinder', args: [r, r, h * 0.66, 12], position: [-w * 0.26, 0.024 + h * 0.33, 0], mat: 0, cast: true },
      { kind: 'cylinder', args: [r, r, h * 0.66, 12], position: [0, 0.024 + h * 0.33, 0], mat: 0, cast: true },
      { kind: 'cylinder', args: [r, r, h * 0.66, 12], position: [w * 0.26, 0.024 + h * 0.33, 0], mat: 0, cast: true },
    ];
  }
  return [
    { kind: 'cylinder', args: [m * 0.2, m * 0.3, h * 0.66, 18], position: [0, h * 0.33, 0], mat: 0, cast: true, receive: true },
    { kind: 'cylinder', args: [m * 0.13, m * 0.13, h * 0.2, 16], position: [0, h * 0.76, 0], mat: 0, cast: true },
    { kind: 'cylinder', args: [m * 0.3, m * 0.3, 0.02, 18], position: [0, 0.01, 0], mat: 2, receive: true },
  ];
}

/** Selects the geometry builder for a product's category. */
function buildParts(product: FurnitureProduct): Part[] {
  switch (product.category) {
    case 'sofa':
      return buildSofa(product);
    case 'armchair':
      return buildArmchair(product);
    case 'accent_chair':
      return buildAccentChair(product);
    case 'coffee_table':
      return buildCoffeeTable(product);
    case 'side_table':
      return buildSideTable(product);
    case 'console':
      return buildConsole(product);
    case 'floor_lamp':
      return buildFloorLamp(product);
    case 'table_lamp':
      return buildTableLamp(product);
    case 'rug':
      return buildRug(product);
    case 'shelf':
      return buildShelf(product);
    case 'cabinet':
      return buildCabinet(product);
    case 'storage':
      return buildStorage(product);
    case 'plant':
      return buildPlant(product);
    case 'curtain':
      return buildCurtain(product);
    case 'decor':
      return buildDecor(product);
    default:
      return [{ kind: 'box', args: [product.width, product.height, product.depth], position: [0, product.height / 2, 0], mat: 0, cast: true, receive: true }];
  }
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */

/** Builds the category's material list; selected items get a soft glow. */
function buildMaterials(
  product: FurnitureProduct,
  variant: FurnitureVariant,
  selected: boolean,
): THREE.MeshStandardMaterial[] {
  // The chosen colorway drives the primary finish; the accent is the first
  // authored color that differs from it. Materials are always the authored
  // material of the backing product.
  const c1 = furnitureHex(variant.color);
  const accentColor = product.colors.find((entry) => entry !== variant.color);
  const c2 = accentColor === undefined ? '#26262A' : furnitureHex(accentColor);
  const finish = variant.material;
  const finishRoughness =
    finish === 'velvet' || finish === 'leather' || finish === 'ceramic' || finish === 'glass'
      ? 0.34
      : finish === 'brass' || finish === 'steel'
        ? 0.26
        : finish === 'boucle' || finish === 'linen' || finish === 'wool' || finish === 'jute'
          ? 0.94
          : 0.68;
  const finishMetalness = finish === 'brass' ? 0.78 : finish === 'steel' ? 0.62 : 0;
  const mk = (
    color: string,
    roughness: number,
    metalness = 0,
    emissiveIntensity = 0,
  ): THREE.MeshStandardMaterial => {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: (roughness + finishRoughness) / 2,
      metalness: Math.max(metalness, finishMetalness),
      transparent: true,
    });
    if (emissiveIntensity > 0) {
      material.emissive = new THREE.Color(color);
      material.emissiveIntensity = emissiveIntensity;
    }
    if (selected) {
      material.emissive = new THREE.Color(color);
      material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.18) + 0.12;
    }
    return material;
  };
  switch (product.category) {
    case 'sofa':
      return [mk(c1, 0.92), mk(c2, 0.9), mk('#3A3E44', 0.5)];
    case 'armchair':
      return [mk(c1, 0.9), mk(c2, 0.88), mk('#3A3E44', 0.6)];
    case 'accent_chair':
      return [mk(c1, 0.88), mk(c2, 0.85), mk('#3A3E44', 0.55)];
    case 'coffee_table':
      return [mk(c1, 0.5), mk(c2, 0.6), mk('#3A3E44', 0.45)];
    case 'side_table':
      return [mk(c1, 0.48), mk(c2, 0.6), mk('#3A3E44', 0.5)];
    case 'console':
      return [mk(c1, 0.5), mk(c2, 0.62), mk('#3A3E44', 0.45)];
    case 'floor_lamp':
      return [mk(c1, 0.4, 0.55), mk(c1, 0.85, 0, 0.32)];
    case 'table_lamp':
      return [mk('#3A3E44', 0.5, 0.3), mk(c1, 0.55), mk(c1, 0.8, 0, 0.3), mk('#FFE6C2', 0.6, 0, 0.85)];
    case 'rug':
      return [mk(c1, 1), mk(c2, 1)];
    case 'shelf':
      return [mk(c1, 0.55), mk(c2, 0.6)];
    case 'cabinet':
      return [mk(c1, 0.55), mk(c2, 0.65), mk('#3A3E44', 0.5)];
    case 'storage':
      return [mk(c1, 0.75), mk(c2, 0.7)];
    case 'plant':
      return [mk(c1, 0.6), mk(furnitureHex('forest'), 0.9), mk(furnitureHex('mocha'), 0.8)];
    case 'curtain':
      return [mk(c1, 0.95), mk('#3A3E44', 0.45, 0.4)];
    case 'decor':
      return [mk(c1, 0.55), variant.material === 'brass' ? mk('#E9E6DF', 0.06, 0.9) : mk(c2, 0.6), mk('#3A3E44', 0.5, 0.3)];
    default:
      return [mk(c1, 0.6), mk(c2, 0.65), mk('#3A3E44', 0.5)];
  }
}

/** Generates parts + materials; stable until product/variant/selection changes. */
function buildModel(
  product: FurnitureProduct,
  variant: FurnitureVariant,
  selected: boolean,
): BuiltModel {
  return { parts: buildParts(product), materials: buildMaterials(product, variant, selected) };
}

/* ------------------------------------------------------------------ */
/* Model-backed rendering (optional GLB assets)                        */
/* ------------------------------------------------------------------ */

/** Renders the procedural part list (also the GLB loading fallback). */
function PartMeshes({
  parts,
  materials,
}: {
  parts: readonly Part[];
  materials: readonly THREE.MeshStandardMaterial[];
}) {
  return (
    <>
      {parts.map((part, index) => (
        <mesh
          key={index}
          material={materials[part.mat]}
          position={part.position}
          rotation={part.rotation}
          castShadow={part.cast}
          receiveShadow={part.receive}
        >
          {part.kind === 'box' && <boxGeometry args={part.args} />}
          {part.kind === 'cylinder' && <cylinderGeometry args={part.args} />}
          {part.kind === 'sphere' && <sphereGeometry args={part.args} />}
        </mesh>
      ))}
    </>
  );
}

/**
 * Bounds of one GLB, cached per uri. Bounds are product-independent; the
 * per-product fit (scale/center/lift/yaw) is derived on every render so two
 * products sharing a model can never poison each other's fit.
 */
const modelBoundsCache = new Map<string, { min: [number, number, number]; max: [number, number, number] }>();

/**
 * Catches GLB decode/load failures (404, malformed file, rejected promise)
 * that Suspense cannot absorb and keeps the procedural model on screen.
 * Re-keyed by the model uri in FurnitureMesh so a later retry starts clean.
 */
class ModelLoadBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Fits one GLB product model onto the floor at the item origin. The model is
 * centered on its x/z extent, uniformly scaled so its width equals the
 * product width, and lifted so its lowest point sits at y = 0 — matching the
 * procedural builders' contract, so rings, yaw, and validation stay intact.
 * Models without measurable bounds, or products whose asset fails to load,
 * keep the procedural representation instead of an invalid transform.
 */
function ModelBackedMesh({
  product,
  parts,
  materials,
}: {
  product: FurnitureProduct;
  parts: readonly Part[];
  materials: readonly THREE.MeshStandardMaterial[];
}) {
  const uri = product.modelUri as string;
  const { scene } = useGLTF(uri);

  const model = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return copy;
  }, [scene]);

  const bounds = useMemo(() => {
    const cached = modelBoundsCache.get(uri);
    if (cached !== undefined) return cached;
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return null;
    const min = box.min.toArray() as [number, number, number];
    const max = box.max.toArray() as [number, number, number];
    if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) return null;
    const next = { min, max };
    modelBoundsCache.set(uri, next);
    return next;
  }, [model, uri]);

  const fit = useMemo(() => {
    if (bounds === null) return null;
    const sizeX = bounds.max[0] - bounds.min[0];
    const sizeZ = bounds.max[2] - bounds.min[2];
    const sizeY = bounds.max[1] - bounds.min[1];
    if (sizeX <= 1e-4 || sizeZ <= 1e-4 || sizeY <= 1e-4) return null;
    const scale = product.width / sizeX;
    const centerX = (bounds.min[0] + bounds.max[0]) / 2;
    const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
    const yawRad = ((product.modelYaw ?? 0) * Math.PI) / 180;
    return {
      scale,
      offset: [-centerX, 0, -centerZ] as [number, number, number],
      lift: -bounds.min[1] * scale,
      yawRad,
    };
  }, [bounds, product.width, product.modelYaw]);

  if (bounds === null || fit === null) {
    return <PartMeshes parts={parts} materials={materials} />;
  }

  return (
    <group position={[0, fit.lift, 0]}>
      <group rotation={[0, fit.yawRad, 0]}>
        <group scale={fit.scale}>
          <group position={fit.offset}>
            <primitive object={model} />
          </group>
        </group>
      </group>
    </group>
  );
}
/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface FurnitureMeshProps {
  item: PlacedFurniture;
  product: FurnitureProduct;
  selected: boolean;
  invalid: boolean;
  /** Monotonic store mutation marker; used to detect fresh instances. */
  mutationKey: number;
  onSelect: (instanceId: string) => void;
}

/**
 * Renders one placed furniture instance with simplified category geometry.
 * See the file header for the interaction and animation contract.
 */
export function FurnitureMesh({ item, product, selected, invalid, mutationKey, onSelect }: FurnitureMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const matsRef = useRef<readonly THREE.MeshStandardMaterial[]>([]);

  /** 0..1 mount/replacement pop progress. */
  const scaleRef = useRef(1);
  /** True once the group has snapped to its target position. */
  const readyRef = useRef(false);
  /** Last seen identity, used to detect fresh instances and replacements. */
  const mountedInstanceRef = useRef<string | null>(null);
  const mountedProductRef = useRef<string | null>(null);
  const mountedKeyRef = useRef(0);

  const { parts, materials } = useMemo(
    () => buildModel(product, item.variant, selected),
    [item.variant, product, selected],
  );

  // Keep the frame loop reading the live material list (rebuilt on
  // product/variant/selection changes) without allocating per frame.
  useLayoutEffect(() => {
    matsRef.current = materials;
  }, [materials]);

  // Dispose replaced materials so variant restores, replacements, and
  // selection changes never accumulate GPU resources.
  useLayoutEffect(() => {
    const current = materials;
    return () => {
      for (const material of current) {
        material.dispose();
      }
    };
  }, [materials]);

  // Detect a fresh instance or a replacement: pop it in and snap position,
  // instead of animating from an unrelated old spot.
  if (
    mountedInstanceRef.current !== item.instanceId ||
    mountedProductRef.current !== product.id ||
    mountedKeyRef.current !== mutationKey
  ) {
    const fresh =
      mountedInstanceRef.current !== item.instanceId || mountedProductRef.current !== product.id;
    mountedInstanceRef.current = item.instanceId;
    mountedProductRef.current = product.id;
    mountedKeyRef.current = mutationKey;
    if (fresh) {
      scaleRef.current = 0;
      readyRef.current = false;
    }
  }

  const handlePointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      onSelect(item.instanceId);
    },
    [onSelect, item.instanceId],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const tx = item.position.x;
    const ty = item.position.y;
    const tz = item.position.z;
    const targetRot = item.rotation * DEG2RAD;

    if (!readyRef.current) {
      group.position.set(tx, ty, tz);
      group.rotation.y = targetRot;
      readyRef.current = true;
    } else {
      // Frame-rate independent damping toward the store target; no allocations.
      const k = 1 - Math.pow(0.0005, delta);
      group.position.x += (tx - group.position.x) * k;
      group.position.y += (ty - group.position.y) * k;
      group.position.z += (tz - group.position.z) * k;
      const diff = Math.atan2(
        Math.sin(targetRot - group.rotation.y),
        Math.cos(targetRot - group.rotation.y),
      );
      group.rotation.y += diff * k;
    }

    // Mount/replacement pop: scale + opacity fade.
    if (scaleRef.current < 1) {
      scaleRef.current = Math.min(1, scaleRef.current + delta * 3);
      const ease = 1 - Math.pow(1 - scaleRef.current, 3);
      group.scale.setScalar(0.3 + 0.7 * ease);
      const opacity = Math.min(1, ease * 1.6);
      for (let i = 0; i < matsRef.current.length; i++) {
        matsRef.current[i].opacity = opacity;
      }
      if (scaleRef.current >= 1) {
        group.scale.setScalar(1);
        for (let i = 0; i < matsRef.current.length; i++) {
          matsRef.current[i].opacity = 1;
        }
      }
    }

  });

  const ringRadius = Math.hypot(product.width, product.depth) / 2 + 0.07;
  const ringY = product.category === 'rug' ? product.height + 0.006 : 0.015;

  const modelUri = product.modelUri;
  const geometry =
    modelUri !== undefined ? (
      <Suspense fallback={<PartMeshes parts={parts} materials={materials} />}>
        <ModelLoadBoundary key={modelUri} fallback={<PartMeshes parts={parts} materials={materials} />}>
          <ModelBackedMesh product={product} parts={parts} materials={materials} />
        </ModelLoadBoundary>
      </Suspense>
    ) : (
      <PartMeshes parts={parts} materials={materials} />
    );

  return (
    <group ref={groupRef} onPointerDown={handlePointerDown}>
      {geometry}

      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, ringY, 0]}>
          <ringGeometry args={[ringRadius - 0.04, ringRadius, 48]} />
          <meshBasicMaterial
            color={SELECT_RING_COLOR}
            transparent
            opacity={0.85}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {invalid && (
        <mesh rotation-x={-Math.PI / 2} position={[0, ringY + 0.012, 0]}>
          <ringGeometry args={[ringRadius + 0.005, ringRadius + 0.045, 48]} />
          <meshBasicMaterial
            color={INVALID_RING_COLOR}
            transparent
            opacity={0.8}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}
