'use client';

import { Suspense, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { useRoomStore } from '@/store/roomStore';
import { CameraController } from '@/components/three/CameraController';
import { RoomScene } from '@/components/three/RoomScene';

/**
 * Client-only full-container 3D viewport for the living-room editor.
 *
 * The canvas subscribes to the store's camera mode and selection, while
 * RoomScene subscribes to room/furniture/validation/lastMutation — so every
 * store mutation reaches the renderer directly, with each component reading
 * only the narrow slice it needs. Rendering stays laptop-friendly: DPR is
 * capped at 2, shadows are soft PCF, the scene is procedural (no remote
 * environment), and the camera starts on the orbit preset CameraController
 * maintains. The Suspense fallback preserves a quiet room-like surface while
 * the scene readies rather than exposing an ambiguous blank canvas.
 *
 * The viewport itself is decorative (`aria-hidden`): the surrounding UI
 * supplies the semantic, keyboard-accessible room summary.
 */
function RoomCanvasFallback() {
  return (
    <group>
      <ambientLight intensity={1.15} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[16, 16]} />
        <meshStandardMaterial color="#cbd5e1" roughness={1} />
      </mesh>
      <mesh position={[0, 0.62, 0]}>
        <boxGeometry args={[2.1, 1.24, 1.2]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.88} />
      </mesh>
    </group>
  );
}

export function RoomCanvas() {
  const cameraMode = useRoomStore((state) => state.cameraMode);
  const selectItem = useRoomStore((state) => state.selectItem);
  const handlePointerMissed = useCallback(() => selectItem(null), [selectItem]);

  return (
    <div className="relative h-full w-full overflow-hidden" aria-hidden="true">
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        camera={{ position: [4.5, 3.4, 5.5], fov: 50, near: 0.1, far: 80 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={handlePointerMissed}
        style={{ position: 'absolute', inset: 0 }}
      >
        <color attach="background" args={['#e2e8f0']} />
        <Suspense fallback={<RoomCanvasFallback />}>
          <RoomScene />
          <CameraController mode={cameraMode} />
        </Suspense>
      </Canvas>
    </div>
  );
}
