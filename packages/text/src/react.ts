import type { ThreeElements } from '@react-three/fiber'
import type { ReactElement } from 'react'
import type {
  AnyFontToken,
  FontInput,
  FontToken,
  LoadedFont,
  RegisteredFont,
} from './font.js'
import type { FontLoadOptions } from './loader.js'
import type { AnyRasterModule } from './raster.js'
import type { TextProperties } from './text.js'

export type ReactTextElement = ReactElement<ReactTextProps>

export type TextChild = string | number | null | false | ReactTextElement

type DistributiveOmit<Value, Keys extends PropertyKey> = Value extends unknown
  ? Omit<Value, Keys & keyof Value>
  : never

type ReactTextCoreProps = DistributiveOmit<TextProperties, 'text' | 'spans'> & {
    readonly children?: TextChild | readonly TextChild[]
  }

export type ReactTextProps = Omit<
  ThreeElements['group'],
  keyof TextProperties | 'children'
> &
  ReactTextCoreProps

export interface UseFont {
  (input: FontInput, options?: FontLoadOptions): RegisteredFont
  <Input extends FontInput, Module extends AnyRasterModule>(
    token: FontToken<Module, Input>,
  ): LoadedFont<Module, Input>
  preload(input: FontInput, options?: FontLoadOptions): Promise<RegisteredFont>
  preload<Input extends FontInput, Module extends AnyRasterModule>(
    token: FontToken<Module, Input>,
  ): Promise<LoadedFont<Module, Input>>
  clear(input: FontInput | AnyFontToken): void
}

export type LazyRaster = <Module extends AnyRasterModule>(
  load: () => Promise<Module | { readonly default: Module }>,
) => Module
