'use client';

/**
 * One user-uploaded GLB model in the room.
 *
 * Uploads are a session-local visual layer outside the catalog: the model is
 * fetched from its object URL, auto-fitted to the stored extents, centered,
 * and lifted to the floor exactly like catalog models. Interaction matches
 * furniture (pointer select + selection ring), while move/rotate/lock/remove
 * happen through the store's user-model actions from the inspector.
 */
import { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { UserModelItem } from '@/store/roomStore';
import { revokePreparedGlb } from '@/components/marketplace/glbUpload';

const DEG2RAD = Math.PI / 180;
const SELECT_RING_COLOR = '#E4B95B';

/** Normalization per object URL: uniform scale + floor lift (deterministic). */
const fitCache = new Map<string, { scale: number; offset: [number, number, number]; lift: number }>();

function fitModel(scene: THREE.Object3D, width: number) {
  const cached = fitCache.get(scene.uuid);
  if (cached !== undefined) return cached;
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.x > 1e-4 ? width / size.x : 1;
  const center = box.getCenter(new THREE.Vector3());
  const next = {
    scale,
    offset: [-center.x, 0, -center.z] as [number, number, number],
    lift: -box.min.y * scale,
  };
  fitCache.set(scene.uuid, next);
  return next;
}

function LoadedUserModel({ model }: { model: UserModelItem }) {
  const { scene } = useGLTF(model.url);
  const instance = useMemo(() => {
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

  const fit = useMemo(() => fitModel(instance, model.width), [instance, model.width]);
  return (
    <group position={[0, fit.lift, 0]}>
      <group scale={fit.scale}>
        <group position={fit.offset}>
          <primitive object={instance} />
        </group>
      </group>
    </group>
  );
}

/** Ghost silhouette shown while the uploaded model decodes. */
function LoadingGhost({ model }: { model: UserModelItem }) {
  return (
    <mesh position={[0, model.height / 2, 0]}>
      <boxGeometry args={[model.width * 0.92, model.height * 0.92, model.depth * 0.92]} />
      <meshStandardMaterial color="#B9B4AB" transparent opacity={0.3} roughness={1} />
    </mesh>
  );
}

export interface UserModelMeshProps {
  model: UserModelItem;
  selected: boolean;
  onSelect: (userModelId: string) => void;
}

export function UserModelMesh({ model, selected, onSelect }: UserModelMeshProps) {
  // Release the object URL once the model leaves the scene (removal or reset).
  useEffect(() => () => revokePreparedGlb(model.url), [model.url]);

  const handlePointerDown = useMemo(
    () => (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      onSelect(model.id);
    },
    [model.id, onSelect],
  );

  const ringRadius = Math.hypot(model.width, model.depth) / 2 + 0.07;

  return (
    <group
      position={[model.position.x, 0, model.position.z]}
      rotation={[0, model.rotation * DEG2RAD, 0]}
      onPointerDown={handlePointerDown}
    >
      <Suspense fallback={<LoadingGhost model={model} />}>
        <LoadedUserModel model={model} />
      </Suspense>
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, 0]}>
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
    </group>
  );
}
