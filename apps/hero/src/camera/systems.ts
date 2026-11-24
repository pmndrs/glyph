import type { World } from 'koota';
import { clamp, lerp, vec3 } from 'math';
import { easing } from 'math/time';
import { Caret } from '../editor/traits';
import { DropCap } from '../page/traits';
import { pageToWorldX, pageToWorldY } from '../page/utils';
import { Quality } from '../quality/traits';
import { sequenceActions } from '../sequence/actions';
import { Stone } from '../stone/traits';
import { Time } from '../time/traits';
import { Viewport } from '../viewport/traits';
import { FREE_LEAN, SHOTS } from './content';
import { CameraView, Rig, Shot } from './traits';

/**
 * Place the shots that follow something, advance the dive, and let Klipp blend the live shot. The stone's shot
 * rides with the stone and the edit shot stands over the caret; the dive closes on the drop cap while its lens
 * opens, until the letter fills the frame, and goes through the counter. A narrow canvas stands every shot further back so the spread still fits across it.
 */
export function directCamera(world: World): void {
  const rig = world.get(Rig);

  if (rig === undefined) return;

  const { delta } = world.get(Time)!;
  const shot = world.get(Shot)!;
  const stone = world.get(Stone)!;
  const caret = world.get(Caret)!;
  const cap = world.get(DropCap)!;
  const { aspect, width, height } = world.get(Viewport)!;
  const still = world.get(Quality)!.reducedMotion;
  const { cameras, klipp } = rig;
  // The shots are composed for a 16:9 frame. A narrower one backs off, up to a point.
  const back = clamp(1.72 / aspect, 1, 2.3);

  for (const name of ['crane', 'columns', 'free'] as const) {
    const plan = SHOTS[name];
    const lean = name === 'free' && !still ? FREE_LEAN : 0;
    vec3.set(
      cameras[name].stand.position,
      plan.position[0] + shot.leanX * lean,
      plan.position[1] * back + shot.leanY * lean * 0.6,
      plan.position[2] * back,
    );
  }

  const stoneX = pageToWorldX(stone.x);
  const stoneY = pageToWorldY(stone.y);
  vec3.set(
    cameras.stone.stand.position,
    stoneX * 0.82 + SHOTS.stone.position[0],
    stoneY + SHOTS.stone.position[1] * back,
    SHOTS.stone.position[2] * back,
  );
  vec3.set(cameras.stone.subject.position, stoneX * 0.9, stoneY + SHOTS.stone.target[1], 0);
  const caretX = pageToWorldX(caret.x);
  const caretY = pageToWorldY(caret.y + caret.height / 2);
  // The opening shot trails the caret along the headline.
  vec3.set(
    cameras.caret.stand.position,
    caretX + SHOTS.caret.position[0],
    caretY + SHOTS.caret.position[1],
    SHOTS.caret.position[2] * Math.min(back, 1.5),
  );
  vec3.set(cameras.caret.subject.position, caretX + SHOTS.caret.target[0], caretY + SHOTS.caret.target[1], 0);
  // The edit shot scales with the line it is over, so a specimen's larger type is framed like the body's.
  const reach = clamp(caret.height / 0.37, 1, 2.2) * back;
  vec3.set(
    cameras.edit.stand.position,
    caretX + SHOTS.edit.position[0] * reach,
    caretY + SHOTS.edit.position[1] * reach,
    SHOTS.edit.position[2] * reach,
  );
  vec3.set(cameras.edit.subject.position, caretX + SHOTS.edit.target[0], caretY, 0);

  // The dive.
  const step = shot.diveSpeed * delta;
  const dive =
    Math.abs(shot.diveTarget - shot.dive) <= step
      ? shot.diveTarget
      : shot.dive + Math.sign(shot.diveTarget - shot.dive) * step;
  const capX = pageToWorldX(cap.x);
  const capY = pageToWorldY(cap.y);
  // A dolly zoom in: the camera closes on the letter while its lens opens, so the letter grows to fill the frame
  // and the page stretches away round it.
  const approach = easing.cubicInOut(clamp(dive / 0.64, 0, 1));
  // Then through the counter, the lens still opening, faster and faster.
  const through = easing.cubicIn(clamp((dive - 0.64) / 0.36, 0, 1));
  const fov = lerp(lerp(SHOTS.dive.fov, 60, approach), 84, through);
  const frame = cap.size * 1.22 * Math.max(1, 1.2 / aspect);
  const hold = frame / (2 * Math.tan((60 * Math.PI) / 360));
  const distance = lerp(lerp(SHOTS.dive.position[2] * back, hold, approach), -0.5, through);
  const tilt = (1 - approach) * (1 - approach);
  vec3.set(cameras.dive.stand.position, capX, capY + SHOTS.dive.position[1] * tilt, distance);
  vec3.set(cameras.dive.subject.position, capX, capY, Math.min(0, distance - 1));
  cameras.dive.lens.fov = fov;

  for (const name of Object.keys(SHOTS) as (keyof typeof SHOTS)[]) {
    cameras[name].noise.amplitudeGain = still ? 0 : name === 'dive' ? 1 - approach : 1;
  }

  klipp.setSize(width, height);
  klipp.update(delta);
  const live = klipp.shot;
  vec3.copy(shot.position, live.position);
  shot.quaternion[0] = live.quaternion[0];
  shot.quaternion[1] = live.quaternion[1];
  shot.quaternion[2] = live.quaternion[2];
  shot.quaternion[3] = live.quaternion[3];
  // The view direction's z, from the quaternion: the camera looks down its own -z.
  const [qx, qy] = live.quaternion;
  const towardPage = 1 - 2 * (qx * qx + qy * qy);
  const focus = towardPage > 1e-3 ? live.position[2] / towardPage : 100;
  const aperture = SHOTS[shot.name].aperture;
  world.set(Shot, {
    position: shot.position,
    quaternion: shot.quaternion,
    fov: live.fov,
    focus: clamp(focus, 0.3, 200),
    aperture: shot.aperture + (aperture - shot.aperture) * (1 - Math.exp(-delta * 1.5)),
    dive,
  });

  if (dive >= 1 && shot.dive < 1) sequenceActions(world).triggerSequence('dive-through');
}

/** Write the blended shot into the real camera, and its focus into the lens the post pass reads. */
export function syncCameraView(world: World): void {
  const view = world.get(CameraView);

  if (view === undefined) return;

  const shot = world.get(Shot)!;
  const { camera, uniforms } = view;
  camera.position.fromArray(shot.position);
  camera.quaternion.fromArray(shot.quaternion);

  if (camera.fov !== shot.fov) {
    camera.fov = shot.fov;
    camera.updateProjectionMatrix();
  }

  camera.updateMatrixWorld();
  uniforms.uFocus.value = shot.focus;
  uniforms.uAperture.value = shot.aperture;
  uniforms.uDive.value = shot.dive;
}
