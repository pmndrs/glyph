const sizeFields = ['optimizedBytes', 'gzipBytes', 'brotliBytes'];

export function assertHostVariantSizeEvidenceFresh(recordedHost, currentHost, recorded, current, budget) {
  if (!sameStrings(recorded?.targetFeatures ?? [], current.targetFeatures)) {
    throw new Error('variant target-feature contract is stale');
  }
  for (const field of sizeFields) {
    const value = current[field];
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`variant size evidence has invalid ${field}`);
    if (value > budget[field]) throw new Error(`variant size evidence exceeds the reviewed ${field} budget`);
  }
  if (typeof current.optimizedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(current.optimizedSha256)) {
    throw new Error('variant size evidence has an invalid optimizedSha256');
  }
  if (recordedHost === currentHost && !sameMeasurement(recorded, current)) {
    throw new Error('same-host variant size evidence is stale');
  }
}

function sameMeasurement(recorded, current) {
  return (
    sizeFields.every((field) => recorded?.[field] === current[field]) &&
    recorded?.optimizedSha256 === current.optimizedSha256
  );
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
