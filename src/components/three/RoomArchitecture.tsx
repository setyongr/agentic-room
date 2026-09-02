import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { resolveAppearance, type FloorFinishOption, type WallpaperOption } from '@/data/appearance';
import type { RoomAppearance, RoomData, RoomDimensions, RoomOpening, ValidationIssue, WallSide } from '@/domain/types';
import { WALL_SIDES } from '@/domain/types';

/**
 * Static architecture of the room: slate floor, off-white walls, baseboards,
 * and real openings (entry doorway, glazed balcony door, window) cut out of the
 * walls as gaps with frames, glass, sills/thresholds, and floor clearances.
 *
 * Geometry is driven by `RoomData` (dimensions + openings) rather than
 * hardcoded extents: each wall is split into solid segments around its
 * openings, with a lintel above every cut. Door openings get a threshold
 * and a floor clearance inlay; the inlay is tinted red while a validation
 * issue of kind `blocks_opening` references that opening's id (`refId`),
 * staying translucent so the clearance still reads.
 *
 * No ceiling is rendered (top view must see in) and every material is a
 * standard, light-responsive `meshStandardMaterial` — the enclosing scene
 * owns the lights.
 *
 * The camera-facing south and east walls render as low cutaway stubs
 * (CUTAWAY_WALL_HEIGHT) so the default orbit view — placed in the room's
 * southeast quadrant — sees the interior furniture instead of opaque
 * panels; those openings keep their full frames, glass, sills/thresholds,
 * and clearance inlays, and the north/west walls stay full-height.
 *
 * Wall, floor, and baseboard colors (plus optional wallpaper) come from
 * the room appearance: every texture and material is painted once per
 * appearance from authored primitives — no assets, no randomness.
 */

const DEFAULT_WALL_THICKNESS = 0.2;
/**
 * Camera-facing walls that render as a low cutaway stub instead of full
 * panels. The default orbit camera sits in the room's southeast quadrant,
 * so the south (balcony) and east (window) walls are sliced down to a
 * plinth: the interior reads from outside while the north/west "back"
 * walls keep the room shell's silhouette.
 */
const CUTAWAY_SIDES: readonly WallSide[] = ['south', 'east'];
/** Height of the cutaway stub walls above the floor, meters. */
const CUTAWAY_WALL_HEIGHT = 0.5;
const BASEBOARD_HEIGHT = 0.1;
const BASEBOARD_THICKNESS = 0.02;
/** Frame pieces sit 2 cm proud of the wall faces on both sides. */
const FRAME_LIP = 0.02;
const JAMB_WIDTH = 0.07;
const HEADER_HEIGHT = 0.1;
/** How far the header tucks up into the lintel volume. */
const HEADER_OVERLAP = 0.04;
const THRESHOLD_HEIGHT = 0.04;
const SILL_HEIGHT = 0.05;
/** Sill/threshold lip protruding past the inner wall face into the room. */
const LIP_DEPTH = 0.06;
/** Wall/lintel/baseboard pieces overlap their neighbours' ends by this much to hide seams. */
const PIECE_OVERLAP = 0.02;
const GLASS_THICKNESS = 0.03;
const GLASS_INSET = 0.05;
/** Length of the door walk-path inlay inside the room, in meters. */
const CLEARANCE_DEPTH = 0.9;
const CLEARANCE_THICKNESS = 0.01;
/** How far the clearance inlay sinks below the floor plane (hides its bottom face). */
const FLOOR_SINK = 0.002;
const GRID_TILE_METERS = 0.5;
/** Floor texture resolution in pixels per meter. */
const FLOOR_TEX_PPM = 128;
const CLEARANCE_TINT = '#94a3b8';
const BLOCKED_TINT = '#c84436';

type RoomBoxKind =
  | 'wall'
  | 'lintel'
  | 'baseboard'
  | 'jamb'
  | 'header'
  | 'threshold'
  | 'sill'
  | 'glass'
  | 'clearance';

interface RoomBox {
  key: string;
  kind: RoomBoxKind;
  /** center position (meters) */
  x: number;
  y: number;
  z: number;
  /** box extents (meters) */
  w: number;
  h: number;
  d: number;
  /** opening id for clearance inlays (blocked tint) */
  openingId?: string;
}

interface RoomGeometry {
  floor: { width: number; depth: number };
  boxes: RoomBox[];
}

interface Cut {
  id: string;
  kind: RoomOpening['kind'];
  /** interval along the wall axis */
  alongMin: number;
  alongMax: number;
  sill: number;
  /** top of the opening above the floor */
  top: number;
  /** opening is filled with a glass pane */
  glazed: boolean;
}

interface RoomMaterials {
  floorTexture: THREE.CanvasTexture;
  wallpaperTexture: THREE.CanvasTexture | null;
  floor: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  baseboard: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
}

const MATERIAL_FOR: Record<
  Exclude<RoomBoxKind, 'clearance'>,
  'wall' | 'baseboard' | 'frame' | 'stone' | 'glass'
> = {
  wall: 'wall',
  lintel: 'wall',
  baseboard: 'baseboard',
  jamb: 'frame',
  header: 'frame',
  threshold: 'stone',
  sill: 'stone',
  glass: 'glass',
};

/** Center coordinate of a wall's center plane (its axis is the other coordinate). */
function wallPerp(side: WallSide, width: number, depth: number): number {
  switch (side) {
    case 'north':
      return -depth / 2;
    case 'south':
      return depth / 2;
    case 'west':
      return -width / 2;
    case 'east':
      return width / 2;
  }
}

/**
 * Deterministic floor finish painted once into a canvas texture: staggered
 * boards (plank finishes) or a clean square grid (tile finishes) in the
 * authored base/seam colors. One texture, no assets.
 */
function createFloorTexture(width: number, depth: number, floor: FloorFinishOption): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width * FLOOR_TEX_PPM));
  canvas.height = Math.max(2, Math.round(depth * FLOOR_TEX_PPM));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('RoomArchitecture: 2D canvas context unavailable');
  }
  ctx.fillStyle = floor.base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const board = GRID_TILE_METERS * FLOOR_TEX_PPM;
  ctx.strokeStyle = floor.seam;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (floor.pattern === 'plank') {
    for (let y = board; y < canvas.height; y += board) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
    }
    for (let row = 0, y = 0; y < canvas.height; row += 1, y += board) {
      const plankLength = board * 3;
      const offset = row % 2 === 0 ? plankLength / 2 : 0;
      for (let x = offset; x < canvas.width; x += plankLength) {
        ctx.moveTo(x + 0.5, y);
        ctx.lineTo(x + 0.5, Math.min(y + board, canvas.height));
      }
    }
  } else {
    for (let x = board; x < canvas.width; x += board) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
    }
    for (let y = board; y < canvas.height; y += board) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
    }
  }
  ctx.stroke();

  ctx.strokeStyle = floor.seam;
  ctx.lineWidth = 2;
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Deterministic wallpaper pattern painted once at 256×256 and repeated over
 * the walls. `none` returns null so the wall renders as plain paint.
 */
function createWallpaperTexture(wallpaper: WallpaperOption, wallColor: string): THREE.CanvasTexture | null {
  if (wallpaper.pattern === 'none') {
    return null;
  }
  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('RoomArchitecture: 2D canvas context unavailable');
  }
  ctx.fillStyle = wallColor;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const ink = wallpaper.ink ?? 'rgba(100, 116, 139, 0.25)';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;

  if (wallpaper.pattern === 'stripe') {
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let x = 12; x < SIZE; x += 32) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, SIZE);
    }
    ctx.stroke();
  } else if (wallpaper.pattern === 'botanical') {
    // One stem-and-leaves sprig per 64px column, mirrored per row.
    ctx.lineWidth = 3;
    for (let column = 0; column < 4; column += 1) {
      const cx = column * 64 + 32;
      for (let row = 0; row < 4; row += 1) {
        const baseY = row * 64 + 16;
        ctx.beginPath();
        ctx.moveTo(cx, baseY + 48);
        ctx.quadraticCurveTo(cx + (row % 2 === 0 ? 8 : -8), baseY + 28, cx, baseY + 8);
        ctx.stroke();
        for (let leaf = 0; leaf < 3; leaf += 1) {
          const ly = baseY + 12 + leaf * 12;
          ctx.beginPath();
          ctx.ellipse(cx + (leaf % 2 === 0 ? 14 : -14), ly, 10, 3.5, leaf % 2 === 0 ? -0.5 : 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  } else {
    // arched-geo: overlapping arch outlines, two per row.
    ctx.lineWidth = 5;
    for (let row = 0; row < 2; row += 1) {
      const baseY = row * 128 + 96;
      for (let column = 0; column < 2; column += 1) {
        const cx = column * 128 + 64;
        ctx.beginPath();
        ctx.moveTo(cx - 40, baseY);
        ctx.lineTo(cx - 40, baseY - 34);
        ctx.arc(cx, baseY - 34, 40, Math.PI, 0, false);
        ctx.lineTo(cx + 40, baseY);
        ctx.stroke();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 2);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Use room coordinates so wallpaper keeps its scale across doorway cuts and low walls. */
function mapWallpaperUvs(geometry: THREE.BoxGeometry, box: RoomBox): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i) + box.x;
    const y = position.getY(i) + box.y;
    const z = position.getZ(i) + box.z;
    const horizontal = Math.abs(normal.getX(i)) > 0.5 ? z : x;
    const vertical = Math.abs(normal.getY(i)) > 0.5 ? z : y;
    uv.setXY(i, horizontal / 6, vertical / 2.8);
  }
  uv.needsUpdate = true;
}

function createRoomMaterials(
  { width, depth }: RoomDimensions,
  appearance: RoomAppearance,
): RoomMaterials {
  const { wall, floor, wallpaper } = resolveAppearance(appearance);
  const floorTexture = createFloorTexture(width, depth, floor);
  const wallpaperTexture = createWallpaperTexture(wallpaper, wall.wall);
  const wallOptions: THREE.MeshStandardMaterialParameters = {
    roughness: 0.97,
    metalness: 0,
    side: THREE.DoubleSide,
  };
  if (wallpaperTexture === null) {
    wallOptions.color = wall.wall;
  } else {
    wallOptions.map = wallpaperTexture;
    wallOptions.color = new THREE.Color('#ffffff');
  }
  return {
    floorTexture,
    wallpaperTexture,
    floor: new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.88, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial(wallOptions),
    baseboard: new THREE.MeshStandardMaterial({ color: wall.trim, roughness: 0.88, metalness: 0 }),
    frame: new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.62, metalness: 0.04 }),
    stone: new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.8, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.38,
      roughness: 0.16,
      metalness: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
}

/** Subdivide one wall into solid segments, lintels, frames, glass, and clearances. */
function buildRoomGeometry(room: RoomData): RoomGeometry {
  const { width: W, depth: D, height: H } = room.dimensions;
  const boxes: RoomBox[] = [];
  let keyCounter = 0;

  const push = (
    kind: RoomBoxKind,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    openingId?: string,
  ) => {
    boxes.push({ key: `${kind}-${keyCounter++}`, kind, x, y, z, w, h, d, openingId });
  };

  for (const side of WALL_SIDES) {
    const axis: 'x' | 'z' = side === 'north' || side === 'south' ? 'x' : 'z';
    const perp = wallPerp(side, W, D);
    /** direction pointing into the room from the wall */
    const inward: 1 | -1 = side === 'north' || side === 'west' ? 1 : -1;
    // Camera-facing walls render as low stubs; their openings stay full.
    const cutaway = CUTAWAY_SIDES.includes(side);
    const wallHeight = cutaway ? CUTAWAY_WALL_HEIGHT : H;
    const wallOpenings = room.openings.filter((o) => o.wall === side);
    // Wall thickness: opening footprints carry it perpendicular to the wall.
    const thickness =
      wallOpenings.length > 0
        ? axis === 'x'
          ? wallOpenings[0].footprint.depth
          : wallOpenings[0].footprint.width
        : DEFAULT_WALL_THICKNESS;
    const innerFace = perp + inward * (thickness / 2);
    const rangeMin = axis === 'x' ? -W / 2 : -D / 2;
    const rangeMax = axis === 'x' ? W / 2 : D / 2;

    const cuts: Cut[] = wallOpenings
      .map((o) => ({
        id: o.id,
        kind: o.kind,
        alongMin: axis === 'x' ? o.footprint.x - o.footprint.width / 2 : o.footprint.z - o.footprint.depth / 2,
        alongMax: axis === 'x' ? o.footprint.x + o.footprint.width / 2 : o.footprint.z + o.footprint.depth / 2,
        sill: o.sillHeight,
        top: o.sillHeight + o.height,
        // The demo room's exterior door on the south wall is its glazed
        // balcony door; the west entry door is a plain pass-through.
        glazed: o.kind === 'window' || (o.kind === 'door' && side === 'south'),
      }))
      .sort((a, b) => a.alongMin - b.alongMin);

    /** Push a box in room coordinates from wall-axis-aligned parameters. */
    const boxAlong = (
      alongCenter: number,
      y: number,
      perpCenter: number,
      alongSize: number,
      h: number,
      perpSize: number,
      kind: RoomBoxKind,
      openingId?: string,
    ) => {
      if (axis === 'x') {
        push(kind, alongCenter, y, perpCenter, alongSize, h, perpSize, openingId);
      } else {
        push(kind, perpCenter, y, alongCenter, perpSize, h, alongSize, openingId);
      }
    };

    // Solid wall runs and their baseboards, broken at every opening.
    let cursor = rangeMin;
    const emitRun = (a0: number, a1: number) => {
      const center = (a0 + a1) / 2;
      const extent = a1 - a0;
      boxAlong(center, wallHeight / 2, perp, extent, wallHeight, thickness, 'wall');
      // Baseboards overlap the run ends so their seams hide inside the wall.
      boxAlong(center, BASEBOARD_HEIGHT / 2, innerFace + inward * (BASEBOARD_THICKNESS / 2), extent + PIECE_OVERLAP, BASEBOARD_HEIGHT, BASEBOARD_THICKNESS, 'baseboard');
    };
    for (const cut of cuts) {
      if (cut.alongMin > cursor) {
        emitRun(cursor, cut.alongMin);
      }
      cursor = Math.max(cursor, cut.alongMax);
    }
    if (cursor < rangeMax) {
      emitRun(cursor, rangeMax);
    }

    // Openings: lintel, frame (jambs + header), sill/threshold, glass, clearance.
    for (const cut of cuts) {
      const alongCenter = (cut.alongMin + cut.alongMax) / 2;
      const alongExtent = cut.alongMax - cut.alongMin;

      // Cutaway walls carry no wall above the stub, so their openings need
      // no lintel; the frame header alone caps the opening.
      if (!cutaway && cut.top < H) {
        // Lintel slightly wider than the cut so its ends hide inside the wall runs.
        boxAlong(alongCenter, (cut.top + H) / 2, perp, alongExtent + PIECE_OVERLAP, H - cut.top, thickness, 'lintel');
      }
      // Jambs centered on the cut edges: half inside the wall, half framing the gap.
      boxAlong(cut.alongMin, (cut.sill + cut.top) / 2, perp, JAMB_WIDTH, cut.top - cut.sill, thickness + FRAME_LIP * 2, 'jamb');
      boxAlong(cut.alongMax, (cut.sill + cut.top) / 2, perp, JAMB_WIDTH, cut.top - cut.sill, thickness + FRAME_LIP * 2, 'jamb');
      // Header bridges the jambs, tucked up into the lintel volume.
      boxAlong(alongCenter, cut.top + HEADER_OVERLAP / 2 - HEADER_HEIGHT / 2, perp, alongExtent + JAMB_WIDTH * 2, HEADER_HEIGHT, thickness + FRAME_LIP * 2, 'header');

      if (cut.kind === 'window') {
        // Window sill: fills the cut and protrudes a lip into the room.
        boxAlong(alongCenter, cut.sill + SILL_HEIGHT / 2, innerFace - inward * ((thickness - LIP_DEPTH) / 2), alongExtent + 0.16, SILL_HEIGHT, thickness + LIP_DEPTH, 'sill');
      } else {
        // Door threshold plus the walk-path clearance inlay.
        boxAlong(alongCenter, THRESHOLD_HEIGHT / 2, innerFace - inward * ((thickness - LIP_DEPTH) / 2), alongExtent + 0.1, THRESHOLD_HEIGHT, thickness + LIP_DEPTH, 'threshold');
        // Inlay sinks 2 mm into the floor so only its top face shows above the plane.
        boxAlong(alongCenter, CLEARANCE_THICKNESS / 2 - FLOOR_SINK, innerFace + inward * (CLEARANCE_DEPTH / 2), alongExtent + 0.1, CLEARANCE_THICKNESS, CLEARANCE_DEPTH, 'clearance', cut.id);
      }

      if (cut.glazed) {
        boxAlong(alongCenter, (cut.sill + cut.top) / 2, perp, alongExtent - GLASS_INSET * 2, cut.top - cut.sill - GLASS_INSET * 2, GLASS_THICKNESS, 'glass');
      }
    }
  }

  return { floor: { width: W, depth: D }, boxes };
}

export interface RoomArchitectureProps {
  room: RoomData;
  appearance: RoomAppearance;
  issues: readonly ValidationIssue[];
}

/**
 * Renders the room shell: floor, walls with real openings, baseboards,
 * frames/glass, and clearance inlays, styled by the current room
 * appearance. Receives shadows from the scene's lights; the enclosing
 * Canvas owns lighting and camera.
 */
export function RoomArchitecture({ room, appearance, issues }: RoomArchitectureProps) {
  const geometry = useMemo(() => buildRoomGeometry(room), [room]);
  const materials = useMemo(
    () => createRoomMaterials(room.dimensions, appearance),
    [appearance, room.dimensions],
  );

  // Opening ids whose clearance is currently blocked by a validation issue.
  const blockedOpenings = useMemo(() => {
    const set = new Set<string>();
    for (const issue of issues) {
      if (issue.kind === 'blocks_opening') {
        set.add(issue.refId);
      }
    }
    return set;
  }, [issues]);

  // Dispose the canvas textures and materials we created outside JSX.
  useEffect(() => {
    const mats = materials;
    return () => {
      mats.floorTexture.dispose();
      if (mats.wallpaperTexture !== null) mats.wallpaperTexture.dispose();
      mats.floor.dispose();
      mats.wall.dispose();
      mats.baseboard.dispose();
      mats.frame.dispose();
      mats.stone.dispose();
      mats.glass.dispose();
    };
  }, [materials]);

  return (
    <group>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={materials.floor}>
        <planeGeometry args={[geometry.floor.width, geometry.floor.depth]} />
      </mesh>
      {geometry.boxes.map((box) => {
        if (box.kind === 'clearance') {
          const blocked = blockedOpenings.has(box.openingId ?? '');
          return (
            <mesh key={box.key} position={[box.x, box.y, box.z]} receiveShadow>
              <boxGeometry args={[box.w, box.h, box.d]} />
              <meshStandardMaterial
                color={blocked ? BLOCKED_TINT : CLEARANCE_TINT}
                transparent
                opacity={blocked ? 0.55 : 0.42}
                roughness={0.9}
              />
            </mesh>
          );
        }
        const isGlass = box.kind === 'glass';
        return (
          <mesh
            key={box.key}
            position={[box.x, box.y, box.z]}
            castShadow={!isGlass}
            receiveShadow={!isGlass}
            material={materials[MATERIAL_FOR[box.kind]]}
          >
            <boxGeometry
              args={[box.w, box.h, box.d]}
              onUpdate={box.kind === 'wall' || box.kind === 'lintel' ? (geometry) => mapWallpaperUvs(geometry, box) : undefined}
            />
          </mesh>
        );
      })}
    </group>
  );
}
