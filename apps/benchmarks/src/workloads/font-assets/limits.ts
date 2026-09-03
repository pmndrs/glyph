import showcaseMtsdfManifest from '../../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json' with { type: 'json' };

const defaultArtifactByteLimit = 64 * 1024 * 1024;

/** Largest checked-in font artifact the shared benchmark cache must admit. */
export const benchmarkFontArtifactByteLimit = Math.max(
  defaultArtifactByteLimit,
  ...showcaseMtsdfManifest.artifacts.map(({ uncompressed }) => uncompressed.bytes),
);
