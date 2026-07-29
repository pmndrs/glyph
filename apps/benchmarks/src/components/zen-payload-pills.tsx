import type { PayloadSummary, PayloadSummaryMetric } from '../benchmark/payload-summary';

export function ZenPayloadPills({ summary }: { readonly summary: PayloadSummary }) {
  return (
    <>
      <ZenPayloadPill metric={summary.runtime} />
      <ZenPayloadPill metric={summary.font} />
      <ZenPayloadPill metric={summary.gpu} />
      {summary.lazyBake !== undefined && <ZenPayloadPill metric={summary.lazyBake} />}
    </>
  );
}

function ZenPayloadPill({ metric }: { readonly metric: PayloadSummaryMetric }) {
  return (
    <div className="rounded-full border border-border/80 bg-black/70 px-2.5 py-1 font-mono text-[8px] uppercase tracking-wide text-muted">
      {metric.label} <span className="ml-1 text-foreground">{formatPayloadMetric(metric)}</span>
    </div>
  );
}

function formatPayloadMetric(metric: PayloadSummaryMetric): string {
  if (metric.bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = metric.bytes;
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  const suffix = metric.valueKind === 'gzip' ? ' gzip' : metric.valueKind === 'gpu' ? ' GPU' : '';
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}${suffix}`;
}
