import {
  defineTechniqueSchema,
  registerRasterPlanProgram,
  type CompiledPolicyProgramBody,
  type RasterFontBinding,
} from '../../dist/index.js';
import type { RasterResourceId, RasterTechnique, RasterTechniqueId } from '../../dist/index.js';

declare const technique: RasterTechnique<
  RasterTechniqueId & 'vendor.plan-contract',
  'plan-contract',
  never,
  {},
  { readonly opacity: number }
>;
declare const otherTechnique: RasterTechnique<
  RasterTechniqueId & 'vendor.other-contract',
  'other-contract',
  never,
  {},
  { readonly opacity: number }
>;
declare const colors: RasterResourceId;
declare const mesh: RasterResourceId;

const schema = defineTechniqueSchema({
  technique: technique.id,
  scope: 'glyph',
  binding: { f32: ['opacity'], u32: ['page'] },
  buffers: {},
  resources: {
    colors: { kind: 'buffer' },
    mesh: {
      kind: 'geometry',
      attributes: [{ semantic: 'position', componentType: 'f32', components: 3 }],
    },
  },
  render: { resource: 'colors', geometry: { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' } },
});

const otherSchema = defineTechniqueSchema({
  technique: otherTechnique.id,
  scope: 'glyph',
  binding: {},
  buffers: {},
});
// @ts-expect-error Resourceful schemas must select one declared resource as the per-draw render role.
defineTechniqueSchema({
  technique: otherTechnique.id,
  scope: 'glyph',
  binding: {},
  buffers: {},
  resources: { payload: { kind: 'buffer' } },
});
type ResourceCoordinates = Parameters<RasterFontBinding<typeof schema.binding>['resource']>;
const resourceCoordinates: ResourceCoordinates = [0, 1];
void resourceCoordinates;
// @ts-expect-error Resource selection always receives both glyph and strike coordinates.
const incompleteResourceCoordinates: ResourceCoordinates = [0];
void incompleteResourceCoordinates;
declare const body: CompiledPolicyProgramBody<typeof schema>;
declare const otherBody: CompiledPolicyProgramBody<typeof otherSchema>;

registerRasterPlanProgram({
  technique: otherTechnique,
  // @ts-expect-error Raster plans publish glyph resources, so their schema cannot be resource-free.
  schema: otherSchema,
  policyBody: () => otherBody,
  compileFont() {
    throw new Error('unreachable');
  },
});

const program = registerRasterPlanProgram({
  technique,
  schema,
  policyBody: () => body,
  compileFont(compiler) {
    compiler.retain('colors', colors, { kind: 'buffer', bytes: new Uint8Array(4) });
    compiler.retain('mesh', mesh, {
      kind: 'geometry',
      topology: 'triangle-list',
      bytes: new Uint8Array(12),
      views: [{ offset: 0, length: 12 }],
      accessors: [{ componentType: 'f32', components: 3, view: 0, count: 1 }],
      attributes: [{ semantic: 'position', accessor: 0 }],
    });
    return compiler.compile({
      strikes: [0],
      resource: () => colors,
      f32: { opacity: () => compiler.font.data.opacity },
      u32: { page: () => 0 },
    });
  },
});

void program.schema.resources.mesh;

registerRasterPlanProgram({
  technique,
  // @ts-expect-error A plan schema must carry the same technique identity as its technique.
  schema: otherSchema,
  policyBody: () => otherBody,
  compileFont() {
    throw new Error('unreachable');
  },
});

registerRasterPlanProgram({
  technique,
  schema,
  policyBody: () => body,
  // @ts-expect-error Font compilation is synchronous and must return compiler.compile directly.
  async compileFont(compiler) {
    return compiler.compile({
      strikes: [0],
      resource: () => colors,
      f32: { opacity: () => 1 },
      u32: { page: () => 0 },
    });
  },
});

registerRasterPlanProgram({
  technique,
  schema,
  policyBody: () => body,
  compileFont(compiler) {
    // @ts-expect-error Retention names are derived from the exact schema.
    compiler.retain('atlas', colors, { kind: 'buffer', bytes: new Uint8Array(4) });
    // @ts-expect-error A geometry declaration cannot retain a buffer payload.
    compiler.retain('mesh', mesh, { kind: 'buffer', bytes: new Uint8Array(4) });
    return compiler.compile({
      strikes: [0],
      resource: () => colors,
      // @ts-expect-error Every declared f32 reader is required by name.
      f32: {},
      u32: { page: () => 0 },
    });
  },
});

registerRasterPlanProgram({
  technique,
  schema,
  policyBody: () => body,
  compileFont(compiler) {
    return compiler.compile({
      strikes: [0],
      resource: () => colors,
      f32: { opacity: () => 1 },
      u32: { page: () => 0 },
      // @ts-expect-error Technique IDs and row counts are compiler-owned metadata.
      techniqueId: 1,
    });
  },
});
