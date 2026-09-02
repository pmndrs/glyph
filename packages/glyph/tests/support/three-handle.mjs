import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';

let nextTestHandle = 1;

/** Create one isolated public Three handle and bind its disposal to a Node test lifecycle. */
export async function createThreeTestHandle(testContext, config = ThreeConfig) {
  await glyph.init();
  const handle = glyph.handle(`three:test:${String(nextTestHandle)}`, config);
  nextTestHandle += 1;
  testContext.after(() => handle.dispose());
  return handle;
}
