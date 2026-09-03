/**
 * Runtime product-thumbnail service.
 *
 * Renders one-time studio thumbnails on a small offscreen WebGL canvas for:
 *
 * - GLB-backed products that ship without a committed `previewImage` (and
 *   session user uploads), by loading their model;
 * - every other catalog product, by reusing the same procedural part
 *   builders the live 3D scene renders (`buildModel` from FurnitureMesh),
 *   keyed per product + colorway so a colorway switch regenerates on demand.
 *
 * Results are cached for the session as blob URLs, so a given model/colorway
 * is never rendered twice and no product model is kept alive just to fill a
 * catalog tile. Rendering is single-flight: one shared offscreen renderer
 * serves every thumbnail sequentially, so pages never create more than one
 * WebGL context.
 *
 * The composition mirrors the committed assets under `public/previews/`
 * (validated against `public/models/sofa-ak-studio.glb`): light warm-gray
 * seamless backdrop, soft contact + cast shadows, gentle 3/4 elevation.
 *
 * Failures (unsupported WebGL, undecodable GLB, ...) reject and callers keep
 * their gradient placeholder — thumbnails are progressive enhancement.
 */
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildModel, type Part } from './FurnitureMesh';
import type { FurnitureProduct, FurnitureVariant } from '@/domain/types';

const SIZE = 512;
const AZIMUTH_DEG = 35;
const ELEVATION_DEG = 17;
const MARGIN = 1.12;

/** Dispose every GPU resource reachable from a loaded GLTF scene. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry?.dispose();
      const material = object.material;
      const materials = Array.isArray(material) ? material : [material];
      for (const entry of materials) {
        if (!entry) continue;
        const textures = [
          entry.map,
          entry.normalMap,
          entry.roughnessMap,
          entry.metalnessMap,
          entry.aoMap,
          entry.emissiveMap,
          entry.alphaMap,
          entry.bumpMap,
          entry.lightMap,
        ];
        for (const texture of textures) {
          if (texture) texture.dispose();
        }
        entry.dispose();
      }
    }
  });
}

/** Builds the three.js geometry for one procedural part. */
function geometryFor(part: Part): THREE.BufferGeometry {
  switch (part.kind) {
    case 'box':
      return new THREE.BoxGeometry(part.args[0], part.args[1], part.args[2]);
    case 'cylinder':
      return new THREE.CylinderGeometry(part.args[0], part.args[1], part.args[2], part.args[3]);
    case 'sphere':
      return new THREE.SphereGeometry(part.args[0], part.args[1], part.args[2]);
  }
}

interface Studio {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  modelGroup: THREE.Group;
  key: THREE.DirectionalLight;
  blob: THREE.Mesh;
}

let studioPromise: Promise<Studio | null> | null = null;

function ensureStudio(): Promise<Studio | null> {
  if (studioPromise === null) {
    studioPromise = (async () => {
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          preserveDrawingBuffer: true,
        });
      } catch {
        return null; // WebGL unavailable — callers keep placeholders.
      }
      renderer.setSize(SIZE, SIZE);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.5;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      // Subtle vertical sweep: slightly deeper at the top so pale pieces
      // separate from the backdrop instead of vanishing into a flat wall.
      const makeBackdrop = (top: string, mid: string, bottom: string): THREE.Texture => {
        const bg = document.createElement('canvas');
        bg.width = 4;
        bg.height = 256;
        const g = bg.getContext('2d');
        if (g) {
          const grad = g.createLinearGradient(0, 0, 0, 256);
          grad.addColorStop(0, top);
          grad.addColorStop(0.55, mid);
          grad.addColorStop(1, bottom);
          g.fillStyle = grad;
          g.fillRect(0, 0, 4, 256);
        }
        const texture = new THREE.CanvasTexture(bg);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
      };
      // Mid-gray sweep that survives tone mapping; pale pieces stay visible.
      const backdrop = makeBackdrop('#a79d8e', '#b9b0a1', '#cbc3b6');
      scene.background = backdrop;

      // Studio reflections so dark upholstery still reads as material.
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8074, 0.95));

      const key = new THREE.DirectionalLight(0xfff3e2, 3.1);
      key.position.set(3.2, 4.5, 3.2);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 40;
      key.shadow.radius = 8;
      scene.add(key);

      const frontMain = new THREE.DirectionalLight(0xffffff, 2.4);
      frontMain.position.set(-0.4, 2.6, 5.2);
      scene.add(frontMain);

      const fill = new THREE.DirectionalLight(0xdde4ff, 1.5);
      fill.position.set(-4.5, 1.6, -3);
      scene.add(fill);

      const bounce = new THREE.DirectionalLight(0xffffff, 0.8);
      bounce.position.set(0.5, -1.2, 3.2);
      scene.add(bounce);

      const rim = new THREE.DirectionalLight(0xffffff, 1.9);
      rim.position.set(-4.2, 2.6, -4.6);
      scene.add(rim);

      // Warm light-gray seamless floor receiving the key-light shadow.
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.MeshStandardMaterial({ color: 0xd1cbbf, roughness: 1, metalness: 0 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.002;
      ground.receiveShadow = true;
      scene.add(ground);

      // Tight soft contact shadow under the footprint.
      const blobTexture = (() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const g = canvas.getContext('2d');
        if (g) {
          const grad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
          grad.addColorStop(0, 'rgba(28, 22, 14, 0.6)');
          grad.addColorStop(0.55, 'rgba(30, 24, 16, 0.22)');
          grad.addColorStop(1, 'rgba(30, 24, 16, 0)');
          g.fillStyle = grad;
          g.fillRect(0, 0, 256, 256);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
      })();
      const blob = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false }),
      );
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.0005;
      scene.add(blob);

      const modelGroup = new THREE.Group();
      scene.add(modelGroup);

      return { renderer, scene, camera, modelGroup, key, blob };
    })();
  }
  return studioPromise;
}

/** Exact-fit the model group's bounding box into the square view (3/4 arc). */
function frameCamera(studio: Studio, size: THREE.Vector3, elevationDeg = ELEVATION_DEG): void {
  const { camera } = studio;
  const azRad = (AZIMUTH_DEG * Math.PI) / 180;
  const elRad = (elevationDeg * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(azRad) * Math.cos(elRad),
    Math.sin(elRad),
    Math.cos(azRad) * Math.cos(elRad),
  ).normalize();

  const targetY = size.y * 0.42;
  const target = new THREE.Vector3(0, targetY, 0);
  const fwd = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

  const half = size.clone().multiplyScalar(0.5);
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360); // aspect 1
  let dist = 0.5;
  for (const [sx, sy, sz] of [
    [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
  ]) {
    // Corner relative to the look target.
    const corner = new THREE.Vector3(sx * half.x, sy * half.y - targetY, sz * half.z);
    const nr = Math.abs(corner.dot(right));
    const nu = Math.abs(corner.dot(up));
    const nf = corner.dot(dir); // > 0 when the corner leans toward the camera
    // |projection| <= tanHalf  =>  d >= nr/tanHalf + nf
    dist = Math.max(dist, nr / tanHalf + nf, nu / tanHalf + nf);
  }
  dist *= MARGIN;

  camera.position.copy(target).addScaledVector(dir, dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
}

/** Frame whatever is in the model group, render once, and return a PNG blob URL. */
async function captureStudio(studio: Studio, size?: THREE.Vector3, elevationDeg = ELEVATION_DEG): Promise<string> {
  if (size === undefined) {
    const box = new THREE.Box3().setFromObject(studio.modelGroup);
    if (box.isEmpty()) {
      throw new Error('Empty model');
    }
    size = box.getSize(new THREE.Vector3());
  }
  const footprint = Math.max(size.x, size.z);

  // Contact shadow sized to the footprint; shadow frustum around the model.
  studio.blob.scale.set(footprint * 1.4, footprint * 1.05, 1);
  studio.key.shadow.camera.left = -footprint - 1;
  studio.key.shadow.camera.right = footprint + 1;
  studio.key.shadow.camera.top = size.y + 1;
  studio.key.shadow.camera.bottom = -1;
  studio.key.shadow.camera.updateProjectionMatrix();

  frameCamera(studio, size, elevationDeg);
  studio.renderer.render(studio.scene, studio.camera);

  const blobUrl = await new Promise<string | null>((resolve) =>
    studio.renderer.domElement.toBlob((result) => resolve(result ? URL.createObjectURL(result) : null), 'image/png'),
  );
  if (blobUrl === null) {
    throw new Error('Thumbnail encode failed');
  }
  return blobUrl;
}

async function renderGlbOne(uri: string): Promise<string> {
  const studio = await ensureStudio();
  if (studio === null) {
    throw new Error('WebGL unavailable');
  }
  const { modelGroup } = studio;

  const gltf = await new GLTFLoader().loadAsync(uri);
  const root = gltf.scene;
  try {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        const entry = object.material;
        const materials = Array.isArray(entry) ? entry : [entry];
        for (const material of materials) {
          if (material && material.isMeshStandardMaterial) {
            if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
            if (material.roughnessMap) material.roughnessMap.colorSpace = THREE.NoColorSpace;
          }
        }
      }
    });

    // Sit the model on the floor, centered at the origin.
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;

    modelGroup.add(root);
    return await captureStudio(studio);
  } finally {
    modelGroup.clear();
    disposeObject(root);
  }
}

async function renderProceduralOne(product: FurnitureProduct, variant: FurnitureVariant): Promise<string> {
  const studio = await ensureStudio();
  if (studio === null) {
    throw new Error('WebGL unavailable');
  }
  const { modelGroup } = studio;

  const built = buildModel(product, variant, false);
  // Bright lamp shades are authored for dark rooms; damp strong emissives so
  // they read as warm glows instead of clipping on the light studio backdrop.
  for (const material of built.materials) {
    if (material.emissiveIntensity > 0.3) {
      material.emissiveIntensity *= 0.45;
    }
    if (material.metalness >= 0.5) {
      material.envMapIntensity = 0.55;
    }
  }
  const meshes = built.parts.map((part) => {
    const mesh = new THREE.Mesh(geometryFor(part), built.materials[part.mat]);
    mesh.position.set(part.position[0], part.position[1], part.position[2]);
    if (part.rotation) {
      mesh.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
    }
    mesh.castShadow = part.cast ?? true;
    mesh.receiveShadow = part.receive ?? true;
    return mesh;
  });

  try {
    for (const mesh of meshes) {
      modelGroup.add(mesh);
    }
    // Flat products (rugs) read best from a steeper, near-top-down view.
    const box = new THREE.Box3().setFromObject(modelGroup);
    const size = box.getSize(new THREE.Vector3());
    const elevation =
      size.y > 0 && size.y < Math.max(size.x, size.z) * 0.12 ? 55 : ELEVATION_DEG;
    return await captureStudio(studio, size, elevation);
  } finally {
    modelGroup.clear();
    for (const mesh of meshes) {
      mesh.geometry.dispose();
    }
    for (const material of built.materials) {
      material.dispose();
    }
  }
}

const glbCache = new Map<string, Promise<string>>();
const productCache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

/** Run one render at a time; concurrent callers share the in-flight promise. */
function enqueue(key: string, cache: Map<string, Promise<string>>, run: () => Promise<string>): Promise<string> {
  const pending = cache.get(key);
  if (pending !== undefined) return pending;
  const task = queue.then(run);
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  cache.set(key, task);
  return task;
}

/**
 * Render (once per session) a studio thumbnail for a GLB URL and resolve to
 * a blob URL. Concurrent callers share the same in-flight render.
 */
export function renderModelThumbnail(uri: string): Promise<string> {
  return enqueue(`glb:${uri}`, glbCache, () => renderGlbOne(uri));
}

/**
 * Render (once per session, per product + colorway) a studio thumbnail of the
 * procedural model for a catalog product and resolve to a blob URL.
 */
export function renderProductThumbnail(product: FurnitureProduct, variant: FurnitureVariant): Promise<string> {
  const key = `proc:${product.id}|${variant.color}|${variant.material}`;
  return enqueue(key, productCache, () => renderProceduralOne(product, variant));
}

/**
 * Session thumbnail for a model URL: `undefined` while rendering (or when
 * generation fails) — render `<img>`s only once it resolves, keeping the
 * gradient placeholder underneath.
 */
export function useModelThumbnail(uri: string | undefined): string | undefined {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    setSrc(undefined);
    if (!uri) return;
    let alive = true;
    renderModelThumbnail(uri)
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        // Keep the placeholder; thumbnails are progressive enhancement.
      });
    return () => {
      alive = false;
    };
  }, [uri]);

  return src;
}

/**
 * Session thumbnail for a catalog product card: committed `previewImage`
 * assets are the caller's job — this hook covers everything else, choosing
 * the GLB render when the product is model-backed and the procedural render
 * otherwise. Regenerates (from cache) when the chosen colorway changes.
 */
export function useProductThumbnail(product: FurnitureProduct | undefined, color: string): string | undefined {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const productId = product?.id;
  const modelUri = product?.modelUri;
  const material = product?.material;

  useEffect(() => {
    setSrc(undefined);
    if (!product || !productId) return;
    let alive = true;
    const run =
      modelUri !== undefined
        ? renderModelThumbnail(modelUri)
        : renderProductThumbnail(product, { color, material: material ?? 'linen' });
    run
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        // Keep the placeholder; thumbnails are progressive enhancement.
      });
    return () => {
      alive = false;
    };
    // product fields are stable per catalog entry; only id/model/material/color matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, modelUri, material, color]);

  return src;
}
