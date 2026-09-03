'use client';

/**
 * Registers the live R3F canvas (renderer, scene, camera, size) with the
 * WebMCP scene-snapshot capture module so `render_scene_snapshot` can render
 * and encode the current room on demand. Renders nothing itself.
 */
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { setSceneCaptureHandle } from '@/webmcp/sceneSnapshot';

export function SceneSnapshotBridge() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  useEffect(() => {
    const width = Math.max(0, Math.floor(size.width));
    const height = Math.max(0, Math.floor(size.height));
    setSceneCaptureHandle({
      gl,
      scene,
      camera: camera as THREE.PerspectiveCamera,
      width,
      height,
    });
    return () => setSceneCaptureHandle(null);
  }, [camera, gl, scene, size.height, size.width]);

  return null;
}
