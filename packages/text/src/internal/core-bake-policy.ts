import type { FontBakeDescriptorV0 } from '@pmndrs/text-font-baker';

interface CoreFontArtifact {
  readonly role: 'font';
}

export function fontBakeDescriptorV0(fontFaceIndex: number): FontBakeDescriptorV0 {
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
