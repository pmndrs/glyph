import {
  addF32,
  constantF32,
  constantU32,
  multiplyF32,
  policyProgram,
  subtractF32,
  u32ToF32,
  type PolicyF32Value,
  type PolicyU32Value,
} from '../../dist/core.js';

// A program declares its named inputs once; every later reference is a handle,
// never a number.
const p = policyProgram({
  scope: 'strike',
  bindingF32: ['bearingX', 'bearingY', 'width', 'height'] as const,
  bindingU32: ['page'] as const,
});

const { inlineOrigin, blockOrigin, fontSize, color, transformIndex, stableGlyphId } = p.semantics;
const { bearingX, bearingY, width, height, page } = p.binding;

const left: PolicyF32Value = addF32(inlineOrigin, multiplyF32(bearingX, fontSize));
const top: PolicyF32Value = subtractF32(blockOrigin, multiplyF32(bearingY, fontSize));
p.storeF32(1, [left, top, multiplyF32(width, fontSize), multiplyF32(height, fontSize)]);
p.storeF32(2, [color.red, color.green, color.blue, color.alpha]);
p.storeF32(3, [u32ToF32(page), constantF32(0), constantF32(0), constantF32(0)]);
p.storeU32(14, [stableGlyphId]);
p.storeU32(15, [transformIndex]);

const compiled = p.compile();
void compiled.inputs;
void compiled.operations;
const f32Count: number = compiled.f32InputCount;
const u32Count: number = compiled.u32InputCount;
void f32Count;
void u32Count;

declare const u32Value: PolicyU32Value;
// @ts-expect-error A u32 value cannot feed f32 arithmetic without an explicit conversion.
addF32(inlineOrigin, u32Value);
// @ts-expect-error An f32 value cannot be stored into a u32 buffer lane.
p.storeU32(14, [left]);
// @ts-expect-error Binding names are declared, not invented at use sites.
void p.binding.kerning;
void constantU32;
