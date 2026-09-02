'use client';

import { useCallback, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ContactShadows } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useRoomStore } from '@/store/roomStore';
import { FurnitureMesh } from '@/components/three/FurnitureMesh';
import { RoomArchitecture } from '@/components/three/RoomArchitecture';

/**
 * The live 3D room: architecture, one FurnitureMesh per placed item, and the
 * full lighting rig (RoomArchitecture owns no lights). Everything subscribes
 * to the room store directly, so any store mutation re-renders the scene on
 * the next frame:
 *
 * - `lastMutation` re-keys ContactShadows so the soft shadow capture is
 *   re-baked exactly when furniture changes (one cheap depth pass, never a
 *   per-frame one).
 * - `selectedInstanceId` and the validation issue set drive per-item
 *   selection/invalid visuals through the FurnitureMesh contract props.
 * - A full-room invisible click plane turns floor/wall clicks into
 *   deselects; clicks in the void beyond it fall through to RoomCanvas's
 *   `onPointerMissed`. The plane is `visible={false}`, so the renderer skips
 *   it (it never pollutes the ContactShadows depth pass) while R3F's
 *   raycaster still tests it.
 */
export function RoomScene() {
  const room = useRoomStore((state) => state.room);
  const furniture = useRoomStore((state) => state.furniture);
  const issues = useRoomStore((state) => state.validation.issues);
  const selectedInstanceId = useRoomStore((state) => state.selectedInstanceId);
  const lastMutation = useRoomStore((state) => state.lastMutation);
  const getProductById = useRoomStore((state) => state.getProductById);
  const selectItem = useRoomStore((state) => state.selectItem);

  const invalidIds = useMemo(() => {
    const ids = new Set<string>();
    for (const issue of issues) {
      for (const instanceId of issue.instanceIds) {
        ids.add(instanceId);
      }
    }
    return ids;
  }, [issues]);

  const handleSelect = useCallback((instanceId: string) => selectItem(instanceId), [selectItem]);
  const handleDeselect = useCallback(() => selectItem(null), [selectItem]);
  const backgroundRef = useRef<THREE.Mesh>(null);

  const handleBackgroundPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      // Only act when the background plane itself is the closest hit: a
      // click on a furniture mesh bubbles through this plane as well, and
      // that click belongs to the furniture.
      if (event.intersections[0]?.object === backgroundRef.current) {
        handleDeselect();
      }
    },
    [handleDeselect],
  );

  return (
    <group>
      {/* Warm key/fill/ambient rig; the key light casts the room's hard
          shadows, ContactShadows supplies the soft grounding. */}
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#fff2e3', '#8b7a66', 0.6]} />
      <directionalLight
        position={[4, 6.5, 2.5]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={20}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-4.5, 3, -4]} intensity={0.45} />

      <RoomArchitecture room={room} issues={issues} />

      {furniture.map((item) => {
        const product = getProductById(item.productId);
        if (!product) return null;
        return (
          <FurnitureMesh
            key={item.instanceId}
            item={item}
            product={product}
            selected={item.instanceId === selectedInstanceId}
            invalid={invalidIds.has(item.instanceId)}
            mutationKey={lastMutation}
            onSelect={handleSelect}
          />
        );
      })}

      {/* Click-to-deselect surface over the floor and walls (see module docs). */}
      <mesh
        ref={backgroundRef}
        visible={false}
        rotation-x={-Math.PI / 2}
        position={[0, 0.0005, 0]}
        onPointerDown={handleBackgroundPointerDown}
      >
        <planeGeometry args={[room.dimensions.width + 1.2, room.dimensions.depth + 1.2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Re-baked soft contact shadows, once per store mutation. */}
      <ContactShadows
        key={lastMutation}
        position={[0, 0.002, 0]}
        scale={7.2}
        resolution={512}
        blur={2.2}
        far={4}
        opacity={0.5}
        color="#191611"
        frames={1}
      />
    </group>
  );
}
