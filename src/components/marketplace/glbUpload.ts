/**
 * Client-side GLB upload handling for the room editor.
 *
 * Uploads never leave the browser: the file is parsed straight from an
 * object URL and measured with Three.js, and only the object URL plus the
 * measured extents reach the store. Models are auto-fitted so the largest
 * extent lands at {@link UPLOAD_FIT_TARGET} meters — matching the room's
 * scale without asking the user for units.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Reject uploads above this size; model files over it stall low-end devices. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Uploaded models are auto-fitted so their largest extent equals this (m). */
export const UPLOAD_FIT_TARGET = 1.8;

export interface PreparedUserGlb {
  ok: true;
  /** Display name derived from the file name. */
  name: string;
  /** Object URL of the uploaded file; call {@link revokePreparedGlb} when removed. */
  url: string;
  /** Auto-fitted extents in meters. */
  width: number;
  depth: number;
  height: number;
}

export interface UserGlbError {
  ok: false;
  code: 'file_type' | 'file_too_large' | 'parse_failed' | 'empty_geometry';
  message: string;
}

/** Release the object URL created by {@link prepareUserGlb}. */
export function revokePreparedGlb(url: string): void {
  URL.revokeObjectURL(url);
}

/** Measure a user-selected GLB file and prepare it for placement. */
export function prepareUserGlb(file: File): Promise<PreparedUserGlb | UserGlbError> {
  if (!/\.glb$/i.test(file.name)) {
    return Promise.resolve({
      ok: false,
      code: 'file_type',
      message: 'Only .glb model files are supported.',
    });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Promise.resolve({
      ok: false,
      code: 'file_too_large',
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
    });
  }

  const name = file.name.replace(/\.glb$/i, '').trim() || 'Custom model';
  const url = URL.createObjectURL(file);

  return new Promise((resolve) => {
    file
      .arrayBuffer()
      .then((buffer) => {
        const loader = new GLTFLoader();
        loader.parse(
          buffer,
          '',
          (gltf) => {
            const box = new THREE.Box3().setFromObject(gltf.scene);
            if (box.isEmpty()) {
              URL.revokeObjectURL(url);
              resolve({ ok: false, code: 'empty_geometry', message: 'The model contains no renderable geometry.' });
              return;
            }
            const size = box.getSize(new THREE.Vector3());
            const largest = Math.max(size.x, size.y, size.z);
            if (largest <= 1e-4) {
              URL.revokeObjectURL(url);
              resolve({ ok: false, code: 'empty_geometry', message: 'The model has no measurable size.' });
              return;
            }
            const scale = UPLOAD_FIT_TARGET / largest;
            resolve({
              ok: true,
              name,
              url,
              width: size.x * scale,
              depth: size.z * scale,
              height: size.y * scale,
            });
          },
          () => {
            URL.revokeObjectURL(url);
            resolve({ ok: false, code: 'parse_failed', message: 'This file could not be read as a GLB model.' });
          },
        );
      })
      .catch(() => {
        URL.revokeObjectURL(url);
        resolve({ ok: false, code: 'parse_failed', message: 'The file could not be read.' });
      });
  });
}
