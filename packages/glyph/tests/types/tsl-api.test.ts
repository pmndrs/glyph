import type { Node } from 'three/webgpu';

import {
  bitmapShader,
  type TslBitmapInstanceNodes,
  type TslBitmapShaderOptions,
  type TslBitmapShaderOutput,
  type TslBitmapShaderResources,
} from '@pmndrs/glyph/shaders/tsl';
import {
  decorationShader,
  type TslDecorationInstanceNodes,
  type TslDecorationShaderOutput,
} from '@pmndrs/glyph/shaders/tsl';
import {
  msdfShader,
  type TslMsdfInstanceNodes,
  type TslMsdfShaderOutput,
  type TslMsdfShaderResources,
} from '@pmndrs/glyph/shaders/tsl';
import {
  slugShader,
  type TslSlugFillRule,
  type TslSlugInstanceNodes,
  type TslSlugPageResources,
  type TslSlugShaderOutput,
} from '@pmndrs/glyph/shaders/tsl';

// The TSL shader entry exposes each technique graph without a renderer integration.
declare const bitmapInstance: TslBitmapInstanceNodes;
declare const bitmapResources: TslBitmapShaderResources;
declare const bitmapOptions: TslBitmapShaderOptions;
const bitmapOut: TslBitmapShaderOutput = bitmapShader(bitmapInstance, bitmapResources, bitmapOptions);
const bitmapColor: Node<'vec3'> = bitmapOut.color;
void bitmapColor;

declare const msdfInstance: TslMsdfInstanceNodes;
declare const msdfResources: TslMsdfShaderResources;
const msdfOut: TslMsdfShaderOutput = msdfShader(msdfInstance, msdfResources);
const fillDistance: Node<'float'> = msdfOut.fillDistance;
const trueDistance: Node<'float'> = msdfOut.trueDistance;
const pixelRange: Node<'float'> = msdfOut.pixelRange;
void fillDistance;
void trueDistance;
void pixelRange;

declare const slugInstance: TslSlugInstanceNodes;
declare const slugPages: readonly TslSlugPageResources[];
declare const fillRule: TslSlugFillRule;
void slugShader;
void slugPages;
void fillRule;
declare const slugOut: TslSlugShaderOutput;
void slugOut;
void slugInstance;

declare const decorationInstance: TslDecorationInstanceNodes;
const decorationOut: TslDecorationShaderOutput = decorationShader(decorationInstance);
const decorationOpacity: Node<'float'> = decorationOut.opacity;
void decorationOpacity;
