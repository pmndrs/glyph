import type { Node } from 'three/webgpu';

import {
  bitmapShader,
  decorationShader,
  msdfShader,
  slugShader,
  type TslBitmapInstanceNodes,
  type TslBitmapShaderOptions,
  type TslBitmapShaderOutput,
  type TslBitmapShaderResources,
  type TslDecorationInstanceNodes,
  type TslDecorationShaderOutput,
  type TslMsdfInstanceNodes,
  type TslMsdfShaderOutput,
  type TslMsdfShaderResources,
  type TslSlugFillRule,
  type TslSlugInstanceNodes,
  type TslSlugPageResources,
  type TslSlugShaderOutput,
} from '@pmndrs/text/tsl';

// The four technique node graphs are one shader library, importable without the
// Three integration so future renderer integrations reuse them.
declare const bitmapInstance: TslBitmapInstanceNodes;
declare const bitmapResources: TslBitmapShaderResources;
declare const bitmapOptions: TslBitmapShaderOptions;
const bitmapOut: TslBitmapShaderOutput = bitmapShader(bitmapInstance, bitmapResources, bitmapOptions);
const bitmapColor: Node<'vec3'> = bitmapOut.color;
void bitmapColor;

declare const msdfInstance: TslMsdfInstanceNodes;
declare const msdfResources: TslMsdfShaderResources;
const msdfOut: TslMsdfShaderOutput = msdfShader(msdfInstance, msdfResources);
void msdfOut;

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
