import type { FontBakeDescriptor } from '../font-baker/index.js';

interface CoreFontArtifact {
  readonly role: 'font';
}

export function fontBakeDescriptorV0(fontFaceIndex: number): FontBakeDescriptor {
  return { formatVersion: 0, fontFaceIndex };
}

export function soleCoreFontArtifact<Artifact extends CoreFontArtifact>(result: {
  readonly artifacts: readonly Artifact[];
}): Artifact {
  const artifact = result.artifacts[0];
  if (result.artifacts.length !== 1 || artifact?.role !== 'font') {
    throw new TypeError('font bake result must contain exactly one core font artifact');
  }
  return artifact;
}
