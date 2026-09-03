/**
 * Live 3D-scene capture for the WebMCP layer.
 *
 * Renders the room scene on demand and encodes it as a JPEG data URL so a
 * model-context agent with vision can judge the *visual* result, not just the
 * text state. The capture is purely local: it renders the same procedural
 * scene the user sees (canvas only — never DOM/UI overlays, never activity
 * text), and nothing leaves the browser.
 *
 * The live view uses the editor's current camera; preset views build a
 * temporary camera from the same PRESETS the CameraController flies to
 * (including the aspect-based radius framing), so a snapshot never disturbs
 * the user's camera. Rendering happens synchronously and is captured in the
 * same task (valid even without `preserveDrawingBuffer`), then the frame is
 * downscaled to a token-friendly width.
 */
import * as THREE from 'three';
import { PRESETS } from '@/components/three/CameraController';
import type { CameraMode } from '@/domain/types';

/** Camera modes accepted by the snapshot tool; `live` = current editor view. */
export type SnapshotView = 'live' | CameraMode;

export interface SceneCaptureHandle {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
}

let activeHandle: SceneCaptureHandle | null = null;

/** Register/unregister the live canvas handle (see SceneSnapshotBridge). */
export function setSceneCaptureHandle(handle: SceneCaptureHandle | null): void {
  activeHandle = handle;
}

export interface SnapshotOptions {
  view: SnapshotView;
  /** Output width cap in pixels; height scales to keep the canvas aspect. */
  maxWidth: number;
  /** JPEG quality in [0, 1]. */
  quality: number;
}

export type SnapshotResult =
  | {
      ok: true;
      dataUrl: string;
      width: number;
      height: number;
      view: SnapshotView;
    }
  | { ok: false; code: 'capture_unavailable' | 'capture_failed'; message: string };

/** Downscale a full-res data URL to `maxWidth` on a 2D canvas. */
async function downscaleFrame(
  fullDataUrl: string,
  maxWidth: number,
  quality: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (typeof Image === 'undefined') {
    return { dataUrl: fullDataUrl, width: 0, height: 0 };
  }
  const image = new Image();
  image.src = fullDataUrl;
  await image.decode();
  if (image.naturalWidth <= maxWidth) {
    return { dataUrl: fullDataUrl, width: image.naturalWidth, height: image.naturalHeight };
  }
  const scale = maxWidth / image.naturalWidth;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: fullDataUrl, width: image.naturalWidth, height: image.naturalHeight };
  }
  ctx.drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height };
}

/** Render the scene once and return a JPEG data URL of the requested view. */
export async function captureSceneSnapshot(options: SnapshotOptions): Promise<SnapshotResult> {
  const handle = activeHandle;
  if (handle === null || handle.width < 2 || handle.height < 2) {
    return {
      ok: false,
      code: 'capture_unavailable',
      message: 'The 3D viewport is not mounted yet; wait for the room to render and retry.',
    };
  }
  const { gl, scene } = handle;
  const aspect = handle.width / handle.height;

  let camera: THREE.PerspectiveCamera = handle.camera;
  let tempCamera: THREE.PerspectiveCamera | null = null;
  if (options.view !== 'live') {
    const preset = PRESETS[options.view];
    // Same aspect-based radius framing the CameraController applies.
    const scale = Math.max(1, handle.height / Math.max(handle.width, 1));
    const radius = preset.radius * scale;
    tempCamera = new THREE.PerspectiveCamera(preset.fov, aspect, 0.1, 80);
    const offset = new THREE.Vector3().setFromSphericalCoords(
      radius,
      preset.phi,
      preset.theta,
    );
    tempCamera.position.set(
      preset.target[0] + offset.x,
      preset.target[1] + offset.y,
      preset.target[2] + offset.z,
    );
    tempCamera.lookAt(preset.target[0], preset.target[1], preset.target[2]);
    tempCamera.updateProjectionMatrix();
    camera = tempCamera;
  }

  try {
    gl.render(scene, camera);
    const fullDataUrl = gl.domElement.toDataURL('image/jpeg', 0.92);
    const scaled = await downscaleFrame(fullDataUrl, options.maxWidth, options.quality);
    return {
      ok: true,
      dataUrl: scaled.dataUrl,
      width: scaled.width,
      height: scaled.height,
      view: options.view,
    };
  } catch {
    return {
      ok: false,
      code: 'capture_failed',
      message: 'Could not capture the 3D viewport (renderer or canvas unavailable).',
    };
  } finally {
    if (tempCamera !== null) {
      tempCamera.clearViewOffset();
      tempCamera = null;
    }
  }
}
