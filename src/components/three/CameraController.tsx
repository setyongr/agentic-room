'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { CameraMode } from '@/domain/types';
import { useRoomStore } from '@/store/roomStore';

/** Radians per degree; every preset angle below is authored in degrees. */
const DEG = Math.PI / 180;

/** Duration of a view-mode flight, in seconds. */
const FLIGHT_DURATION = 0.7;

/**
 * Minimum flight radius. The room's corner half-diagonal is ≈ 3.75 m, so
 * flying any closer can clip through the walls; 5.2 m keeps every mode
 * transition arc clear of the room shell.
 */
const SAFE_FLIGHT_RADIUS = 5.2;

/** Half-diagonal of the demo room's floor (6 × 4.5 m), the framing reference. */
const DEMO_ROOM_HALF_DIAGONAL = Math.hypot(6, 4.5) / 2;

/**
 * Framing multiplier for the camera presets, derived from the live room
 * dimensions: 1× for the demo room, never below 0.85× (small rooms stay
 * close enough to read) and never above 1.9× (large rooms are never
 * cropped by a preset view).
 */
export function roomFramingScale(width: number, depth: number): number {
  const halfDiagonal = Math.hypot(width, depth) / 2;
  return Math.min(1.9, Math.max(0.85, halfDiagonal / DEMO_ROOM_HALF_DIAGONAL));
}

/**
 * One camera view mode: an orbit target plus the spherical preset the
 * camera lands on, and the constraint envelope OrbitControls is limited to
 * while the mode is active. Spherical angles are polar `phi` from +y and
 * azimuth `theta` from +z (the OrbitControls convention).
 */
export interface CameraPreset {
  /** point the camera keeps framing */
  target: readonly [number, number, number];
  /** distance from the target, meters */
  radius: number;
  /** polar angle from +y, radians */
  phi: number;
  /** azimuth around +y from +z, radians */
  theta: number;
  /** vertical field of view, degrees */
  fov: number;
  minDistance: number;
  maxDistance: number;
  minPolar: number;
  maxPolar: number;
  minAzimuth: number;
  maxAzimuth: number;
}

export const PRESETS: Record<CameraMode, CameraPreset> = {
  /** Free three-quarter design view with a tight zoom floor and a wide orbit. */
  orbit: {
    target: [0, 1.3, 0],
    radius: 9,
    phi: 60 * DEG,
    theta: 39 * DEG,
    fov: 50,
    minDistance: 3.5,
    maxDistance: 14,
    minPolar: 8.6 * DEG,
    maxPolar: 83 * DEG,
    minAzimuth: -Infinity,
    maxAzimuth: Infinity,
  },
  /**
   * Plan view: high above the floor center at a compressed field of view so
   * the perspective reads almost orthographic, with only a slight tilt
   * allowed for peeking at furniture fronts.
   */
  top: {
    target: [0, 0.25, 0],
    radius: 12.25,
    phi: 2.9 * DEG,
    theta: 0,
    fov: 35,
    minDistance: 8,
    maxDistance: 22,
    minPolar: 1.2 * DEG,
    maxPolar: 20 * DEG,
    minAzimuth: -Infinity,
    maxAzimuth: Infinity,
  },
  /**
   * Front overview: camera on the balcony side (camera +z, looking -z)
   * through the cutaway south wall, panning within a ±26° azimuth band
   * around dead-on.
   */
  front: {
    target: [0, 1.3, 0],
    radius: 8.5,
    phi: 71.6 * DEG,
    theta: 0,
    fov: 50,
    minDistance: 4,
    maxDistance: 12,
    minPolar: 60 * DEG,
    maxPolar: 87 * DEG,
    minAzimuth: -26 * DEG,
    maxAzimuth: 26 * DEG,
  },
  /** East overview: same envelope, framing the interior through the cutaway east wall. */
  side: {
    target: [0, 1.3, 0],
    radius: 8.5,
    phi: 71.6 * DEG,
    theta: 90 * DEG,
    fov: 50,
    minDistance: 4,
    maxDistance: 12,
    minPolar: 60 * DEG,
    maxPolar: 87 * DEG,
    minAzimuth: 90 * DEG - 26 * DEG,
    maxAzimuth: 90 * DEG + 26 * DEG,
  },
};

/** One animated camera flight between view modes. */
interface Flight {
  active: boolean;
  elapsed: number;
  duration: number;
  startRadius: number;
  startPhi: number;
  startTheta: number;
  endRadius: number;
  endPhi: number;
  endTheta: number;
  startFov: number;
  endFov: number;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
}

function createFlight(): Flight {
  return {
    active: false,
    elapsed: 0,
    duration: FLIGHT_DURATION,
    startRadius: 0,
    startPhi: 0,
    startTheta: 0,
    endRadius: 0,
    endPhi: 0,
    endTheta: 0,
    startFov: 50,
    endFov: 50,
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Place the camera directly on a preset: no animation, no constraints check. */
function snapToPreset(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsImpl,
  preset: CameraPreset,
  scratchOffset: THREE.Vector3,
  scratchTarget: THREE.Vector3,
): void {
  scratchOffset.setFromSphericalCoords(preset.radius, preset.phi, preset.theta);
  scratchTarget.set(preset.target[0], preset.target[1], preset.target[2]);
  camera.position.copy(scratchTarget).add(scratchOffset);
  controls.target.copy(scratchTarget);
  camera.lookAt(scratchTarget);
  camera.fov = preset.fov;
  camera.updateProjectionMatrix();
}

/**
 * Constrained camera rig for the room editor. Maps the store's view mode to
 * an orbit camera: `orbit` is a free three-quarter design view, `top` a
 * near-orthographic plan view, `front`/`side` stable one-sided overviews
 * facing the cutaway south/east walls so the interior stays in frame.
 *
 * OrbitControls is always constrained (no pan, zoom-only, per-mode distance
 * and polar/azimuth envelopes) so the user can never get lost; switching
 * modes flies the camera along a spherical arc that never tunnels through
 * the room. Reduced-motion users get an instant snap instead of the flight.
 */
export function CameraController({ mode }: { mode: CameraMode }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const size = useThree((state) => state.size);
  const roomWidth = useRoomStore((state) => state.room.dimensions.width);
  const roomDepth = useRoomStore((state) => state.room.dimensions.depth);
  const preset = useMemo(() => {
    const base = PRESETS[mode];
    // Keep the room in frame when the stage is narrower than it is tall.
    const scale = Math.max(1, size.height / Math.max(size.width, 1));
    return {
      ...base,
      radius: base.radius * scale * roomFramingScale(roomWidth, roomDepth),
      maxDistance: base.maxDistance * scale * roomFramingScale(roomWidth, roomDepth),
    };
  }, [mode, size.width, size.height, roomWidth, roomDepth]);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // Scratch objects reused by the flight loop: no per-frame allocation.
  const scratchOffset = useMemo(() => new THREE.Vector3(), []);
  const scratchTarget = useMemo(() => new THREE.Vector3(), []);
  const scratchSpherical = useMemo(() => new THREE.Spherical(), []);
  const flightRef = useRef<Flight | null>(null);
  if (flightRef.current === null) flightRef.current = createFlight();

  const reduceMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const firstMount = useRef(true);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    // The canvas camera already starts on the orbit preset; snap so the
    // very first frame is always the store's active mode, no startup flight.
    if (firstMount.current) {
      firstMount.current = false;
      snapToPreset(camera, controls, preset, scratchOffset, scratchTarget);
      return;
    }

    // Fly from the live camera to the new mode's preset along a spherical
    // arc (radius/phi/theta lerp), which never passes through the room.
    const flight = flightRef.current;
    if (!flight) return;
    scratchOffset.copy(camera.position).sub(controls.target);
    scratchSpherical.setFromVector3(scratchOffset);
    let startTheta = scratchSpherical.theta;
    const thetaDelta = preset.theta - startTheta;
    if (thetaDelta > Math.PI) startTheta += 2 * Math.PI;
    else if (thetaDelta < -Math.PI) startTheta -= 2 * Math.PI;

    flight.active = true;
    flight.elapsed = 0;
    flight.duration = reduceMotion ? 0 : FLIGHT_DURATION;
    flight.startRadius = Math.max(
      scratchSpherical.radius,
      SAFE_FLIGHT_RADIUS * roomFramingScale(roomWidth, roomDepth),
    );
    flight.startPhi = scratchSpherical.phi;
    flight.startTheta = startTheta;
    flight.endRadius = preset.radius;
    flight.endPhi = preset.phi;
    flight.endTheta = preset.theta;
    flight.startFov = camera.fov;
    flight.endFov = preset.fov;
    flight.startTarget.copy(controls.target);
    flight.endTarget.set(preset.target[0], preset.target[1], preset.target[2]);
    // Drei drives controls.update() every frame; disabling the controls
    // while the flight owns the camera keeps its clamps from fighting the
    // animation. Re-enabled when the flight lands.
    controls.enabled = false;
  }, [preset, camera, reduceMotion, scratchOffset, scratchTarget, scratchSpherical]);

  useFrame((_, delta) => {
    const flight = flightRef.current;
    const controls = controlsRef.current;
    if (!flight || !flight.active || !controls) return;

    flight.elapsed += delta;
    const progress = flight.duration > 0 ? Math.min(flight.elapsed / flight.duration, 1) : 1;
    const t = easeInOutCubic(progress);

    const radius = THREE.MathUtils.lerp(flight.startRadius, flight.endRadius, t);
    const phi = THREE.MathUtils.lerp(flight.startPhi, flight.endPhi, t);
    const theta = THREE.MathUtils.lerp(flight.startTheta, flight.endTheta, t);
    scratchOffset.setFromSphericalCoords(radius, phi, theta);
    scratchTarget.lerpVectors(flight.startTarget, flight.endTarget, t);
    camera.position.copy(scratchTarget).add(scratchOffset);
    controls.target.copy(scratchTarget);
    camera.lookAt(scratchTarget);

    const fov = THREE.MathUtils.lerp(flight.startFov, flight.endFov, t);
    if (fov !== camera.fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    if (progress >= 1) {
      flight.active = false;
      camera.fov = flight.endFov;
      camera.updateProjectionMatrix();
      controls.enabled = true;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={false}
      enableZoom
      enableDamping
      dampingFactor={0.08}
      zoomSpeed={0.8}
      rotateSpeed={0.9}
      minDistance={preset.minDistance}
      maxDistance={preset.maxDistance}
      minPolarAngle={preset.minPolar}
      maxPolarAngle={preset.maxPolar}
      minAzimuthAngle={preset.minAzimuth}
      maxAzimuthAngle={preset.maxAzimuth}
    />
  );
}
