import { Text, TextGroup } from '@pmndrs/glyph/react';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { positionWorld, smoothstep } from 'three/tsl';
import { DoubleSide, type Group, MeshBasicNodeMaterial } from 'three/webgpu';

import { ICON_CODE_POINTS } from '../content';
import type { Faces } from '../fonts';
import { footprint, type Footprint } from './floor';
import { heroReady, textPrepared, usePreparation } from '../startup';

const COUNT = 128;
const SPACING = 0.09;
const BASE_Z = 0.12;
const RISE = 0.8;
const SYMBOLS = Object.values(ICON_CODE_POINTS).map((point) => String.fromCodePoint(point));

/** Repeatable variation without changing the glyph layout on every emission. */
function random(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.545_3;
  return value - Math.floor(value);
}

const SLOTS = Array.from({ length: COUNT }, (_, index) => ({
  index,
  symbol: SYMBOLS[Math.floor(random(index + 17) * SYMBOLS.length)]!,
}));

// Height encodes lifetime, so all particles share one material and fade without re-shaping their text.
const dust = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false });
  material.name = 'robot-glyph-dust';
  material.positionNode = context.position;
  material.colorNode = context.shader.color;
  material.opacityNode = context.shader.coverage.mul(
    smoothstep(BASE_Z + RISE * 0.15, BASE_Z + RISE, positionWorld.z)
      .oneMinus()
      .mul(0.65),
  );
  return material;
});

interface Particle {
  age: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  roll: number;
  spin: number;
  size: number;
}

function createParticle(): Particle {
  return { age: 1, life: 1, x: 0, y: 0, vx: 0, vy: 0, roll: 0, spin: 0, size: 1 };
}

/** A bounded trail in world space, fed by distance travelled rather than time spent on screen. */
export function RobotDust({ faces }: { readonly faces: Faces }) {
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('dust', () => groups.current.length === COUNT && groups.current.every(textPrepared));
  const particles = useRef<Particle[]>(SLOTS.map(createParticle));
  const previous = useRef<Footprint | undefined>(undefined);
  const carry = useRef(0);
  const emitted = useRef(0);

  useFrame((_, delta) => {
    if (!heroReady()) return;
    const step = Math.min(delta, 0.1);
    for (const particle of particles.current) particle.age += step;

    // Robot publishes in the start phase; this callback consumes the current frame's footprint.
    const current = footprint();
    const before = previous.current;
    if (current !== undefined && before !== undefined) {
      const dx = current.x - before.x;
      const dy = current.y - before.y;
      const distance = Math.hypot(dx, dy);
      // A development pose jump is not a driven path. Never bridge a teleport with a burst of particles.
      if (distance > 4) carry.current = 0;
      else if (distance > 0) {
        const cos = Math.cos(current.heading);
        const sin = Math.sin(current.heading);
        const speed = distance / Math.max(step, 0.001);
        for (let along = SPACING - carry.current; along <= distance; along += SPACING) {
          const serial = emitted.current++;
          const particle = particles.current[serial % COUNT]!;
          const side = serial % 2 === 0 ? -1 : 1;
          const across = side * current.halfExtents[1] * 0.85 + (random(serial + 31) - 0.5) * 0.2;
          const rear = current.halfExtents[0] + random(serial + 53) * 0.25;
          const fraction = along / distance;
          const kick = 0.25 + Math.min(speed, 15) * 0.035;
          const spread = side * (0.25 + random(serial + 71) * 0.65);
          particle.age = 0;
          particle.life = 1.1 + random(serial + 97) * 0.7;
          particle.x = before.x + dx * fraction - cos * rear - sin * across;
          particle.y = before.y + dy * fraction - sin * rear + cos * across;
          particle.vx = -cos * kick - sin * spread;
          particle.vy = -sin * kick + cos * spread;
          particle.roll = random(serial + 113) * Math.PI * 2;
          particle.spin = (random(serial + 137) - 0.5) * 3;
          particle.size = 0.16 + random(serial + 151) * 0.19;
        }
        carry.current = (carry.current + distance) % SPACING;
      }
    } else carry.current = 0;
    previous.current = current;

    const drag = Math.exp(-step * 1.8);
    particles.current.forEach((particle, index) => {
      const group = groups.current[index];
      if (group == null) return;
      group.visible = particle.age < particle.life;
      if (!group.visible) return;
      const progress = particle.age / particle.life;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vx *= drag;
      particle.vy *= drag;
      particle.roll += particle.spin * step;
      group.position.set(particle.x, particle.y, BASE_Z + RISE * progress);
      group.rotation.z = particle.roll;
      group.scale.setScalar(particle.size * (1 - progress * 0.55));
    });
  });

  return (
    <TextGroup name="robot-glyph-dust">
      {SLOTS.map(({ index, symbol }) => (
        <group
          key={index}
          name="robot-dust-particle"
          ref={(group) => {
            groups.current[index] = group;
          }}
          visible={false}
        >
          <Text
            constraints={{ width: { mode: 'exact', size: 2 } }}
            font={faces.icons}
            layout={{ align: 'center', wrap: 'none' }}
            material={dust}
            position={[-1, 0.5, 0]}
            style={{ color: '#676779', fontSize: 1, lineHeight: 1 }}
          >
            {symbol}
          </Text>
        </group>
      ))}
    </TextGroup>
  );
}
