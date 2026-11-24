import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { InstancedMesh, Matrix4, PerspectiveCamera, Quaternion, Raycaster, Vector2, Vector3 } from 'three';

import type { GlyphInputStream } from '../../../explainer/channel';
import { showcaseFocusPose, showcaseOrbitCoordinates, showcaseOrbitReturnSettled } from './camera-framing';
import type { ShowcaseControl } from './info-panel';
import type { ShowcaseInteraction } from './interaction-state';
import { canSelectShowcaseObject, selectedShowcaseIndex } from './interaction-state';
import {
  completeOrbitDistanceTransition,
  initialOrbitDistanceTransition,
  retargetOrbitDistance,
} from './orbit-distance-transition';
import type { ShowcaseObject } from './showcase-objects';
import { containsScreenPoint, showcaseUiLayout } from './ui-layout';

const ORBIT_TARGET = new Vector3(0, -0.25, 0);
const MIN_ELEVATION = 0.24;
const MAX_ELEVATION = 1.05;
const CLICK_SLOP = 6;

export function ShowcaseCameraRig({
  children,
  denseMode,
  inputs,
  interaction,
  items,
  objects,
  orbitDistance,
  onClose,
  onClosed,
  onControlHover,
  onControlPress,
  onExitDense,
  onFocused,
  onHover,
  onLaunch,
  onOrbitDistanceSettled,
  onSelect,
}: {
  children?: ReactNode;
  denseMode: boolean;
  inputs: GlyphInputStream;
  interaction: ShowcaseInteraction;
  items: readonly ShowcaseObject[];
  objects: InstancedMesh | null;
  orbitDistance: number;
  onClose: () => void;
  onClosed: () => void;
  onControlHover: (control: ShowcaseControl | undefined) => void;
  onControlPress: (control: ShowcaseControl | undefined) => void;
  onExitDense: () => void;
  onFocused: () => void;
  onHover: (index: number | undefined) => void;
  onLaunch: () => void;
  onOrbitDistanceSettled: () => void;
  onSelect: (index: number) => void;
}) {
  const set = useThree((state) => state.set);
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  const drag = useRef<Readonly<{ x: number; y: number }> | undefined>(undefined);
  const press = useRef<
    Readonly<{ x: number; y: number; control: ShowcaseControl | undefined; selectedOnDown: boolean }> | undefined
  >(undefined);
  const pointer = useRef<Readonly<{ x: number; y: number }> | undefined>(undefined);
  const hovered = useRef<number | undefined>(undefined);
  const hoveredControl = useRef<ShowcaseControl | undefined>(undefined);
  const focusBasis = useRef<Readonly<{ index: number; quaternion: Quaternion }> | undefined>(undefined);
  const completion = useRef<ShowcaseInteraction['phase'] | undefined>(undefined);
  const previousPhase = useRef<ShowcaseInteraction['phase']>(interaction.phase);
  const orbit = useRef({
    distance: orbitDistance,
    elevation: 0.42,
    targetElevation: 0.42,
    targetYaw: 0.64,
    yaw: 0.64,
  });
  const orbitDistanceTransition = useRef(initialOrbitDistanceTransition(orbitDistance));
  const camera = useRef<PerspectiveCamera>(null);
  const raycaster = useRef(new Raycaster());
  const ndc = useRef(new Vector2());

  useLayoutEffect(() => {
    const previous = get().camera;
    const next = camera.current;
    if (next === null) return;
    next.aspect = size.width / size.height;
    next.updateProjectionMatrix();
    set({ camera: next });
    return () => set({ camera: previous });
  }, [get, set, size.height, size.width]);

  useFrame((_state, delta) => {
    const current = orbit.current;
    const selectedIndex = selectedShowcaseIndex(interaction);
    const canSelectObject = !denseMode && canSelectShowcaseObject(interaction);
    const layout = showcaseUiLayout(size.width, size.height);
    orbitDistanceTransition.current = retargetOrbitDistance(orbitDistanceTransition.current, orbitDistance);
    current.distance += (orbitDistance - current.distance) * damping(delta, 5.5);
    const orbitCompletion = completeOrbitDistanceTransition(orbitDistanceTransition.current, current.distance);
    orbitDistanceTransition.current = orbitCompletion.transition;
    if (orbitCompletion.completed) {
      onOrbitDistanceSettled();
    }
    let released: Readonly<{ x: number; y: number }> | undefined;
    for (const input of inputs.drain()) {
      if (input.type === 'pointerdown' && input.x !== undefined && input.y !== undefined) {
        pointer.current = { x: input.x, y: input.y };
        const control = denseMode
          ? controlAt(layout, input.x, input.y, true)
          : selectedIndex === undefined || interaction.phase === 'closing'
            ? undefined
            : controlAt(layout, input.x, input.y, false);
        const activeCamera = camera.current;
        const hit =
          control === undefined && canSelectObject && activeCamera !== null && objects !== null
            ? objectAt(input.x, input.y, size.width, size.height, activeCamera, objects, raycaster.current, ndc.current)
            : undefined;
        const selectedOnDown = hit !== undefined;
        press.current = { control, selectedOnDown, x: input.x, y: input.y };
        onControlPress(control);
        if (hit !== undefined) onSelect(hit);
        else if (interaction.phase === 'orbiting') drag.current = { x: input.x, y: input.y };
      } else if (input.type === 'pointermove' && input.x !== undefined && input.y !== undefined) {
        pointer.current = { x: input.x, y: input.y };
        const previous = drag.current;
        if (selectedIndex !== undefined || previous === undefined) continue;
        current.targetYaw -= (input.x - previous.x) * 0.007;
        current.targetElevation = clamp(
          current.targetElevation + (input.y - previous.y) * 0.006,
          MIN_ELEVATION,
          MAX_ELEVATION,
        );
        drag.current = { x: input.x, y: input.y };
      } else if (input.type === 'pointerup' && input.x !== undefined && input.y !== undefined) {
        pointer.current = { x: input.x, y: input.y };
        released = { x: input.x, y: input.y };
        drag.current = undefined;
        onControlPress(undefined);
      } else if (input.type === 'pointercancel' || input.type === 'pointerleave') {
        drag.current = undefined;
        press.current = undefined;
        onControlPress(undefined);
        if (input.type === 'pointerleave') pointer.current = undefined;
      }
    }

    const next = camera.current;
    if (next === null) return;
    let orbitPose = orbitCameraPose(current, current.distance);
    if (selectedIndex === undefined) {
      focusBasis.current = undefined;
      if (interaction.phase === 'orbiting' && drag.current === undefined) current.targetYaw += delta * 0.055;
      if (interaction.phase === 'orbiting') {
        current.yaw += (current.targetYaw - current.yaw) * damping(delta, 9);
        current.elevation += (current.targetElevation - current.elevation) * damping(delta, 9);
        const pose = orbitCameraPose(current, current.distance);
        next.position.copy(pose.position);
        next.quaternion.copy(pose.quaternion);
      }
    } else {
      if (
        focusBasis.current?.index !== selectedIndex ||
        (interaction.phase === 'focusing' && previousPhase.current !== 'focusing')
      ) {
        focusBasis.current = { index: selectedIndex, quaternion: next.quaternion.clone() };
        completion.current = undefined;
      }
      const focus = showcaseFocusPose(
        items[selectedIndex]!,
        focusBasis.current.quaternion,
        size.width,
        size.height,
        next.fov,
      );
      const returning = interaction.phase === 'closing';
      if (returning) {
        current.targetYaw += delta * 0.055;
        current.yaw += (current.targetYaw - current.yaw) * damping(delta, 9);
        current.elevation += (current.targetElevation - current.elevation) * damping(delta, 9);
        orbitPose = orbitCameraPose(current, current.distance);
      }
      const targetPosition = returning ? orbitPose.position : focus.position;
      const targetQuaternion = returning ? orbitPose.quaternion : focus.quaternion;
      const blend = damping(delta, returning ? 7 : 8);
      next.position.lerp(targetPosition, blend);
      next.quaternion.slerp(targetQuaternion, blend);
      const transitionComplete = returning
        ? showcaseOrbitReturnSettled(next.position, ORBIT_TARGET, orbitDistance)
        : settled(next, targetPosition, targetQuaternion);
      if (transitionComplete && completion.current !== interaction.phase) {
        completion.current = interaction.phase;
        if (interaction.phase === 'focusing') onFocused();
        else if (interaction.phase === 'closing') {
          adoptCameraOrbit(current, next.position);
          onClosed();
        }
      }
    }
    next.updateMatrixWorld(true);

    const point = pointer.current;
    const nextControl =
      point === undefined
        ? undefined
        : denseMode
          ? controlAt(layout, point.x, point.y, true)
          : selectedIndex === undefined
            ? undefined
            : controlAt(layout, point.x, point.y, false);
    if (hoveredControl.current !== nextControl) {
      hoveredControl.current = nextControl;
      onControlHover(nextControl);
    }

    let nextHovered: number | undefined;
    if (point !== undefined && canSelectObject && objects !== null) {
      nextHovered = objectAt(point.x, point.y, size.width, size.height, next, objects, raycaster.current, ndc.current);
    }
    if (hovered.current !== nextHovered) {
      hovered.current = nextHovered;
      onHover(nextHovered);
    }

    if (released !== undefined && press.current !== undefined) {
      const down = press.current;
      press.current = undefined;
      if (down.selectedOnDown) {
        previousPhase.current = interaction.phase;
        return;
      }
      if (Math.hypot(released.x - down.x, released.y - down.y) <= CLICK_SLOP) {
        const control = denseMode
          ? controlAt(layout, released.x, released.y, true)
          : selectedIndex === undefined
            ? undefined
            : controlAt(layout, released.x, released.y, false);
        if (control === down.control && control === 'launch') onLaunch();
        else if (control === down.control && control === 'dense-exit') onExitDense();
        else if (denseMode) {
          previousPhase.current = interaction.phase;
          return;
        } else if (interaction.phase === 'closing' && objects !== null) {
          const hit = objectAt(
            released.x,
            released.y,
            size.width,
            size.height,
            next,
            objects,
            raycaster.current,
            ndc.current,
          );
          if (hit !== undefined) onSelect(hit);
        } else if (selectedIndex !== undefined) onClose();
        else if (objects !== null) {
          const hit = objectAt(
            released.x,
            released.y,
            size.width,
            size.height,
            next,
            objects,
            raycaster.current,
            ndc.current,
          );
          if (hit !== undefined) onSelect(hit);
        }
      }
    }
    previousPhase.current = interaction.phase;
  });

  return (
    <perspectiveCamera args={[35, 1, 0.01, 100]} ref={camera}>
      {children}
    </perspectiveCamera>
  );
}

function orbitCameraPose(orbit: Readonly<{ elevation: number; yaw: number }>, orbitDistance: number) {
  const horizontal = Math.cos(orbit.elevation) * orbitDistance;
  const position = new Vector3(
    ORBIT_TARGET.x + Math.sin(orbit.yaw) * horizontal,
    ORBIT_TARGET.y + Math.sin(orbit.elevation) * orbitDistance,
    ORBIT_TARGET.z + Math.cos(orbit.yaw) * horizontal,
  );
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(position, ORBIT_TARGET, _up));
  return { position, quaternion } as const;
}

function objectAt(
  x: number,
  y: number,
  width: number,
  height: number,
  camera: PerspectiveCamera,
  objects: InstancedMesh,
  raycaster: Raycaster,
  ndc: Vector2,
) {
  ndc.set((x / width) * 2 - 1, 1 - (y / height) * 2);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(objects, false)[0]?.instanceId;
}

function controlAt(
  layout: ReturnType<typeof showcaseUiLayout>,
  x: number,
  y: number,
  denseMode: boolean,
): ShowcaseControl | undefined {
  if (denseMode && containsScreenPoint(layout.denseExit, x, y)) return 'dense-exit';
  if (containsScreenPoint(layout.launch, x, y)) return 'launch';
  return undefined;
}

function damping(delta: number, speed: number): number {
  return 1 - Math.exp(-speed * delta);
}

function settled(camera: PerspectiveCamera, position: Vector3, quaternion: Quaternion): boolean {
  return (
    camera.position.distanceToSquared(position) < 0.0001 && 1 - Math.abs(camera.quaternion.dot(quaternion)) < 0.00001
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function adoptCameraOrbit(
  orbit: {
    distance: number;
    elevation: number;
    targetElevation: number;
    targetYaw: number;
    yaw: number;
  },
  cameraPosition: Vector3,
): void {
  const adopted = showcaseOrbitCoordinates(cameraPosition, ORBIT_TARGET);
  orbit.distance = adopted.distance;
  orbit.elevation = adopted.elevation;
  orbit.targetElevation = adopted.elevation;
  orbit.yaw = adopted.yaw;
  orbit.targetYaw = adopted.yaw;
}

const _up = new Vector3(0, 1, 0);
