const measurementFields = ['rawBytes', 'optimizedBytes', 'gzipBytes', 'brotliBytes', 'optimizedSha256'];

export function assertHostSizeEvidenceFresh(recorded, current, budgets) {
  const recordedContract = withoutMeasurement(recorded);
  const currentContract = withoutMeasurement(current);
  if (JSON.stringify(recordedContract) !== JSON.stringify(currentContract)) {
    throw new Error('size evidence contract is stale');
  }

  for (const field of measurementFields.slice(0, 4)) {
    const value = current[field];
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`size evidence has invalid ${field}`);
    if (value > budgets[field]) throw new Error(`size evidence exceeds the reviewed ${field} budget`);
  }
  if (typeof current.optimizedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(current.optimizedSha256)) {
    throw new Error('size evidence has an invalid optimizedSha256');
  }

  const sameHost =
    recorded.measurementHost?.platform === current.measurementHost?.platform &&
    recorded.measurementHost?.architecture === current.measurementHost?.architecture;
  if (sameHost && JSON.stringify(recorded) !== JSON.stringify(current)) {
    throw new Error('same-host size evidence is stale');
  }
}

function withoutMeasurement(evidence) {
  return Object.fromEntries(
    Object.entries(evidence).filter(([field]) => field !== 'measurementHost' && !measurementFields.includes(field)),
  );
}
