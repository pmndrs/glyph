import type { PayloadSummary, PayloadSummaryMetric } from '../benchmark/payload-summary';

export function PresentationPayloadPills({ summary }: { readonly summary: PayloadSummary }) {
  return (
    <>
      <PresentationPayloadPill metric={summary.runtime} />
      <PresentationPayloadPill metric={summary.font} />
      <PresentationPayloadPill metric={summary.gpu} />
      {summary.lazyBake !== undefined && <PresentationPayloadPill metric={summary.lazyBake} />}
    </>
  );
}

function PresentationPayloadPill({ metric }: { readonly metric: PayloadSummaryMetric }) {
  const formatted = formatPayloadMetric(metric);
  return (
    <div className="rounded-md border border-border bg-black/80 px-3 py-1.25 font-mono text-[11px] uppercase tracking-wide text-accent-hover">
      {metric.label}{' '}
      <span className="ml-1 text-foreground tracking-normal">
        {formatted.value}
        {'\u202f'}
        {formatted.unit}
      </span>
      {formatted.qualifier !== '' && <span className="text-muted"> {formatted.qualifier}</span>}
    </div>
  );
}

function formatPayloadMetric(metric: PayloadSummaryMetric): {
  readonly qualifier: string;
  readonly unit: string;
  readonly value: string;
} {
  if (metric.bytes === undefined) return { qualifier: '', unit: '', value: '—' };
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = metric.bytes;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  const unit = units[unitIndex];
  if (unit === undefined) throw new RangeError(`Unsupported payload unit index: ${unitIndex}`);
  return {
    qualifier: metric.valueKind === 'gzip' ? 'gzip' : metric.valueKind === 'gpu' ? 'GPU' : '',
    unit,
    value: value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1),
  };
}
