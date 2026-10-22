export interface EditorialCaptureIdentity {
  readonly scenario: {
    readonly editorialPixelRole: 'candidate' | 'cold-main';
    readonly requestedBackend: string;
    readonly observedBackend: string;
  };
  readonly archive: { readonly archiveSha256: string; readonly packageRoot: string };
  readonly editorialPixelCapture: { readonly state: { readonly backend: string } };
}

/** Pins the two receipts to externally named archives and their actual rendered backends. */
export function assertEditorialCaptureIdentity(
  candidate: EditorialCaptureIdentity,
  reference: EditorialCaptureIdentity,
  expectedCandidateSha256: string,
  expectedReferenceSha256: string,
): void {
  if (candidate.scenario.editorialPixelRole !== 'candidate' || reference.scenario.editorialPixelRole !== 'cold-main') {
    throw new Error('Editorial receipts have incorrect candidate/cold-main roles');
  }
  if (
    candidate.archive.archiveSha256 !== expectedCandidateSha256 ||
    reference.archive.archiveSha256 !== expectedReferenceSha256
  ) {
    throw new Error('Capture archive SHA-256 does not match externally pinned candidate/reference digests');
  }
  if (
    candidate.archive.archiveSha256 === reference.archive.archiveSha256 ||
    candidate.archive.packageRoot === reference.archive.packageRoot
  ) {
    throw new Error('Editorial captures must use distinct archives and installed roots');
  }
  for (const receipt of [candidate, reference]) {
    if (
      receipt.scenario.requestedBackend !== receipt.scenario.observedBackend ||
      receipt.editorialPixelCapture.state.backend !== receipt.scenario.requestedBackend
    ) {
      throw new Error('Editorial capture backend differs from requested or observed backend');
    }
  }
}
