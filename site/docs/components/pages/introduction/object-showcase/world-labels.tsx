import { createFontStack } from '@pmndrs/glyph';
import { Text, TextGroup, useFont } from '@pmndrs/glyph/react';
import type { TextGroup as ThreeTextGroup } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Group, Object3D } from 'three';
import { Quaternion, Vector3 } from 'three';

import iconMap from '../../../../assets/fonts/font-awesome-icons.json';
import { ICON_FONT, MSDF_FONT } from '../fonts';
import { paragraphTopFromCenter } from '../scene-layout';
import { CameraBillboard } from './camera-billboard';
import { DENSE_SHOWCASE_CAPACITY } from './dense-showcase';
import { createFadingTextMaterial } from './fading-text-material';
import { selectedShowcaseIndex, showcaseLabelOpacityTarget, type ShowcaseInteraction } from './interaction-state';
import { isShowcaseLabelVisible } from './label-visibility';
import { generatedLabelFontSize } from './label-size';
import {
  labelAnchor,
  SHOWCASE_FLOOR_Y,
  SHOWCASE_LABEL_CLEARANCE,
  SHOWCASE_OBJECTS,
  type ShowcaseObject,
} from './showcase-objects';
import type { ShowcaseSelectionMotionSource } from './use-selection-motion';

const LABEL_WIDTH = 2.15;
const LABEL_FONT_SIZE = 0.4;
const GENERATED_LABEL_WIDTH_AT_BASE_SIZE = 2.2;
const GENERATED_LABEL_BASE_SIZE = 0.52;

export function WorldLabels({
  denseScale,
  denseMode,
  hoveredIndex,
  interaction,
  items,
  motion,
  visibleCount,
}: {
  denseScale: Readonly<{ current: number }>;
  denseMode: boolean;
  hoveredIndex: number | undefined;
  interaction: ShowcaseInteraction;
  items: readonly ShowcaseObject[];
  motion: ShowcaseSelectionMotionSource;
  visibleCount: Readonly<{ current: number }>;
}) {
  const font = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const iconFont = useFont(ICON_FONT.input, ICON_FONT.raster.technique, ICON_FONT.raster.options);
  const fontStack = useMemo(() => createFontStack(font, iconFont), [font, iconFont]);
  const camera = useThree((state) => state.camera);
  const primaryGroup = useRef<ThreeTextGroup>(null);
  const generatedGroup = useRef<ThreeTextGroup>(null);
  const billboards = useRef<(Group | null)[]>([]);
  const texts = useRef<(Object3D | null)[]>([]);
  const elapsed = useRef(0);
  const anchor = useRef(new Vector3());
  const cameraWorld = useRef(new Quaternion());
  const primaryParentInverse = useRef(new Quaternion());
  const generatedParentInverse = useRef(new Quaternion());
  const distances = useRef(new Float64Array(DENSE_SHOWCASE_CAPACITY));
  const labelOrder = useRef<number[]>([]);
  const compareLabelOrder = useMemo(
    () => (left: number, right: number) => distances.current[right]! - distances.current[left]! || left - right,
    [],
  );
  const fading = useMemo(() => createFadingTextMaterial(), []);
  const generatedFading = useMemo(() => createFadingTextMaterial(), []);
  const selectedMaterial = useMemo(() => createFadingTextMaterial(), []);
  const opacity = useRef(1);
  const renderedSelectedIndex = selectedShowcaseIndex(interaction);

  useLayoutEffect(() => {
    labelOrder.current = Array.from({ length: items.length }, (_, index) => index);
  }, [items.length]);

  useFrame((_state, delta) => {
    elapsed.current += delta;
    const damping = 1 - Math.exp(-12 * delta);
    const opacityTarget = showcaseLabelOpacityTarget(interaction);
    opacity.current += (opacityTarget - opacity.current) * damping;
    fading.setOpacity(opacity.current);
    generatedFading.setOpacity(denseScale.current);
    const visibilityScale = 0.82 + opacity.current * 0.18;
    const selectedIndex = motion.current.selectedIndex;
    const selectedScale = motion.current.scale;
    camera.getWorldQuaternion(cameraWorld.current);
    primaryGroup.current?.getWorldQuaternion(primaryParentInverse.current).invert();
    generatedGroup.current?.getWorldQuaternion(generatedParentInverse.current).invert();
    const activeCount =
      !denseMode && denseScale.current === 0 ? Math.min(SHOWCASE_OBJECTS.length, items.length) : items.length;
    const order = labelOrder.current;
    for (let index = order.length; index < activeCount; index += 1) order[index] = index;
    order.length = activeCount;
    for (let index = 0; index < activeCount; index += 1) {
      const object = items[index]!;
      const billboard = billboards.current[index];
      if (billboard !== null && billboard !== undefined) {
        const hovered = interaction.phase === 'orbiting' && index === hoveredIndex;
        const scaleY = object.role === 'generated' ? denseScale.current : index === selectedIndex ? selectedScale : 1;
        setLabelAnchor(
          billboard.position,
          object,
          hovered ? Math.sin(elapsed.current * 4.2) * 0.035 : 0,
          scaleY,
          object.role === 'generated' ? denseScale.current : 1,
        );
        billboard.quaternion
          .copy(cameraWorld.current)
          .premultiply(object.role === 'generated' ? generatedParentInverse.current : primaryParentInverse.current);
        const visible = isShowcaseLabelVisible(
          object.role,
          index,
          visibleCount.current,
          denseMode,
          selectedIndex,
          interaction.phase === 'open',
        );
        billboard.visible = visible;
        const generatedScale = object.role === 'generated' ? denseScale.current : 1;
        const targetScale = visible
          ? (index === selectedIndex ? 1 : visibilityScale * (hovered ? 1.2 : 1)) * generatedScale
          : 0;
        const scale = billboard.scale.x + (targetScale - billboard.scale.x) * damping;
        billboard.scale.setScalar(scale);
      }
      const text = texts.current[index];
      const orderScaleY =
        object.role === 'generated' ? denseScale.current : index === selectedIndex ? selectedScale : 1;
      distances.current[index] =
        text === null || text === undefined
          ? Number.NEGATIVE_INFINITY
          : camera.position.distanceToSquared(
              setLabelAnchor(
                anchor.current,
                object,
                0,
                orderScaleY,
                object.role === 'generated' ? denseScale.current : 1,
              ),
            );
    }
    order.sort(compareLabelOrder);
    for (let renderOrder = 0; renderOrder < order.length; renderOrder += 1) {
      const labelIndex = order[renderOrder]!;
      const text = texts.current[labelIndex];
      if (text !== null && text !== undefined) text.renderOrder = renderOrder;
    }
  });

  function renderLabel(object: ShowcaseObject, index: number) {
    const generated = object.role === 'generated';
    const fontSize = generated ? generatedLabelFontSize(object.size) : LABEL_FONT_SIZE;
    const labelWidth = generated
      ? GENERATED_LABEL_WIDTH_AT_BASE_SIZE * (fontSize / GENERATED_LABEL_BASE_SIZE)
      : LABEL_WIDTH;
    return (
      <CameraBillboard
        key={object.id}
        position={labelAnchor(object)}
        ref={(node) => {
          billboards.current[index] = node;
        }}
      >
        <Text
          constraints={{ width: { mode: 'exact', size: labelWidth } }}
          font={generated ? font : fontStack}
          layout={{ align: 'center', wrap: 'none' }}
          {...(index === renderedSelectedIndex ? { material: selectedMaterial.material } : {})}
          position={[-labelWidth / 2, paragraphTopFromCenter(fontSize), 0]}
          ref={(node) => {
            texts.current[index] = node;
          }}
          style={{
            color: generated ? '#080a0f' : '#f8fafc',
            fontSize,
            ...(generated
              ? {
                  outline: { color: '#ffffffd9', width: 0.006 },
                  shadow: { color: '#ffffffa6', offset: [0.008, -0.009] as const },
                }
              : {
                  outline: { color: '#05070b', width: 0.015 },
                  shadow: { color: '#000000b3', offset: [0.012, -0.016] as const },
                }),
          }}
        >
          {!generated && <Text style={{ color: object.iconColor }}>{iconFor(object)} </Text>}
          {object.label}
        </Text>
      </CameraBillboard>
    );
  }

  return (
    <>
      <TextGroup compositing="ordered" material={fading.material} name="world-label-batch" ref={primaryGroup}>
        {items.map((object, index) => (object.role === 'generated' ? null : renderLabel(object, index)))}
      </TextGroup>
      <TextGroup
        compositing="ordered"
        material={generatedFading.material}
        name="generated-label-batch"
        ref={generatedGroup}
      >
        {items.map((object, index) => (object.role === 'generated' ? renderLabel(object, index) : null))}
      </TextGroup>
    </>
  );
}

function setLabelAnchor(
  target: Vector3,
  item: ShowcaseObject,
  bob: number,
  scaleY: number,
  clearanceScale: number,
): Vector3 {
  return target.set(
    item.position[0],
    SHOWCASE_FLOOR_Y + item.size[1] * scaleY + SHOWCASE_LABEL_CLEARANCE * clearanceScale + bob,
    item.position[1],
  );
}

function iconFor(object: ShowcaseObject): string {
  return String.fromCodePoint(iconMap.icons[object.icon]);
}
