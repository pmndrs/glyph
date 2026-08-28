import { f32, id, policyProgram, u32, type PolicyF32Value, type PolicyU32Value } from '../../dist/core.js';

// A program declares its named inputs once; every later reference is a handle,
// never a number.
const p = policyProgram({
  scope: 'strike',
  bindingF32: ['bearingX', 'bearingY', 'width', 'height'] as const,
  bindingU32: ['page'] as const,
});

const { inlineOrigin, blockOrigin, fontSize, color, transformIndex, stableGlyphId } = p.semantics;
const { bearingX, bearingY, width, height, page } = p.binding;

const left: PolicyF32Value = f32.add(inlineOrigin, f32.mul(bearingX, fontSize));
const top: PolicyF32Value = f32.sub(blockOrigin, f32.mul(bearingY, fontSize));
p.storeF32(id('buffer', 'type-test/rect'), [left, top, f32.mul(width, fontSize), f32.mul(height, fontSize)]);
p.storeF32(id('buffer', 'type-test/color'), [color.red, color.green, color.blue, color.alpha]);
p.storeF32(id('buffer', 'type-test/page-f32'), [u32.toF32(page), f32.const(0), f32.const(0), f32.const(0)]);
p.storeU32(id('buffer', 'type-test/stable-glyph'), [stableGlyphId]);
p.storeU32(id('buffer', 'type-test/transform-index'), [transformIndex]);

const compiled = p.compile();
void compiled.inputs;
void compiled.operations;
const f32Count: number = compiled.f32InputCount;
const u32Count: number = compiled.u32InputCount;
void f32Count;
void u32Count;

declare const u32Value: PolicyU32Value;
// @ts-expect-error A u32 value cannot feed f32 arithmetic without an explicit conversion.
f32.add(inlineOrigin, u32Value);
// @ts-expect-error An f32 value cannot be stored into a u32 buffer lane.
p.storeU32(id('buffer', 'type-test/wrong-scalar'), [left]);
// @ts-expect-error Buffer stores reject arbitrary numeric IDs at typecheck.
p.storeF32(1, [left]);
// @ts-expect-error ID domains cannot be interchanged.
p.storeF32(id('retained-plan', 'type-test/retained-plan'), [left]);
// @ts-expect-error Binding names are declared, not invented at use sites.
void p.binding.kerning;
void u32.const;
