import type { ReactNode } from 'react';

import { BENCHMARK_FONT_LABELS, liveWorkloadFontFixtures, type BenchmarkFontFixture } from '../benchmark/font-fixtures';
import type { FontDelivery, RasterFormatName } from '../benchmark/url-state';
import packageSizes from '../generated/package-sizes.json';
import type { BitmapTextLiveStats } from '../techniques/bitmap/persistent-scene';
import type { MtsdfTextLiveStats } from '../techniques/mtsdf/persistent-scene';
import type { SlugTextLiveStats } from '../techniques/slug/persistent-scene';
import bitmapFixtures from '../../fixtures/rendering/showcase-bitmap-density-fixtures-v0.json';
import mtsdfFixtures from '../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json';
import slugFixtures from '../../fixtures/rendering/showcase-slug-fixtures-v0.json';

type LiveTextStats = BitmapTextLiveStats | MtsdfTextLiveStats | SlugTextLiveStats;

function formatLabel(technique: RasterFormatName): 'Bitmap' | 'MSDF' | 'Slug' {
  return technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'Slug' : 'Bitmap';
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function mtsdfFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = mtsdfFixtures.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
  if (fixture === undefined) throw new Error(`MTSDF fixture manifest is missing ${fontFixture}`);
  return fixture;
}

function bitmapFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = bitmapFixtures.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
  if (fixture === undefined) throw new Error(`bitmap fixture manifest is missing ${fontFixture}`);
  return fixture;
}

function slugFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = slugFixtures.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
  if (fixture === undefined) throw new Error(`Slug fixture manifest is missing ${fontFixture}`);
  return fixture;
}

export function PayloadInspector({
  delivery,
  fontFixture,
  liveStats,
  technique,
  workload,
}: {
  readonly delivery: FontDelivery;
  readonly fontFixture: BenchmarkFontFixture;
  readonly liveStats: LiveTextStats | undefined;
  readonly technique: RasterFormatName;
  readonly workload: string;
}) {
  const runtime = measuredPackageSizeIfAvailable(`${technique}-runtime-js`);
  const shaper = measuredPackageSize('text-shaper-wasm');
  const bakerHost = measuredPackageSizeIfAvailable(`${technique}-baker-js`);
  const bakerWasm = measuredPackageSizeIfAvailable(`${technique}-baker-wasm`);
  const runtimeBakerHost = measuredPackageSize('runtime-baker-host-js');
  const runtimeBakerWorker = measuredPackageSize('runtime-baker-worker-js');
  const coreBakerHost = measuredPackageSize('portable-baker-js');
  const coreBakerWasm = measuredPackageSize('portable-baker-wasm');
  const libraryTransferBytes = runtime === undefined ? undefined : runtime.gzipBytes + shaper.gzipBytes;
  const bakerTransferBytes =
    bakerHost === undefined || bakerWasm === undefined
      ? undefined
      : runtimeBakerHost.gzipBytes +
        runtimeBakerWorker.gzipBytes +
        coreBakerHost.gzipBytes +
        coreBakerWasm.gzipBytes +
        bakerHost.gzipBytes +
        bakerWasm.gzipBytes;
  const bitmapStats = liveStats?.technique === 'bitmap' ? liveStats : undefined;
  const mtsdfStats = liveStats?.technique === 'mtsdf' ? liveStats : undefined;
  const slugStats = liveStats?.technique === 'slug' ? liveStats : undefined;
  const workloadFonts = liveWorkloadFontFixtures(workload, fontFixture);
  const selectedFixtures: readonly {
    readonly id: BenchmarkFontFixture;
    readonly role: 'font' | 'icons' | 'labels';
  }[] =
    workloadFonts.kind === 'icon-grid'
      ? [
          { id: workloadFonts.primary, role: 'icons' },
          { id: workloadFonts.labels, role: 'labels' },
        ]
      : [{ id: workloadFonts.primary, role: 'font' }];
  const selectedMtsdfFixtures =
    technique === 'mtsdf'
      ? selectedFixtures.map(({ id, role }) => ({
          fixture: mtsdfFixtureFor(id),
          fontFixture: id,
          role,
        }))
      : [];
  const selectedSlugFixtures =
    technique === 'slug'
      ? selectedFixtures.map(({ id, role }) => ({
          fixture: slugFixtureFor(id),
          fontFixture: id,
          role,
        }))
      : [];
  const selectedBitmapFixtures =
    technique === 'bitmap'
      ? selectedFixtures.map(({ id, role }) => ({
          fixture: bitmapFixtureFor(id),
          fontFixture: id,
          role,
        }))
      : [];
  const mtsdfFixture = selectedMtsdfFixtures[0]?.fixture;
  const slugFixture = selectedSlugFixtures[0]?.fixture;
  const fontTransferBytes =
    technique === 'mtsdf'
      ? sumOptionalBytes(selectedMtsdfFixtures.map(({ fixture }) => fixture.compressed.bytes))
      : technique === 'slug'
        ? sumOptionalBytes(selectedSlugFixtures.map(({ fixture }) => fixture.compressed.bytes))
        : sumOptionalBytes(selectedBitmapFixtures.map(({ fixture }) => fixture.bytes));
  const textureGpuBytes =
    technique === 'mtsdf'
      ? (mtsdfStats?.atlasGpuBytes ??
        sumOptionalBytes(
          selectedMtsdfFixtures.map(({ fixture }) => fixture.raster.runtimeTextureArray.basePaddedGpuBytes),
        ))
      : technique === 'slug'
        ? (slugStats?.slugGpuBytes ??
          sumOptionalBytes(selectedSlugFixtures.map(({ fixture }) => fixture.raster.decodedGpuBytes)))
        : (bitmapStats?.atlasGpuBytes ??
          sumOptionalBytes(selectedBitmapFixtures.map(({ fixture }) => fixture.raster.decodedGpuBytes)));
  const bitmapPages =
    bitmapStats === undefined
      ? selectedBitmapFixtures.flatMap(({ fixture, fontFixture: pageFontFixture, role }) =>
          fixture.raster.pages.map((page) => ({
            key: `${pageFontFixture}-fixture-${page.index}`,
            label: `${BENCHMARK_FONT_LABELS[pageFontFixture]} ${role} · page ${page.index + 1} · ${page.width}×${page.height}`,
            embeddedBytes: page.encodedBytes,
            gpuBytes: page.decodedGpuBytes,
          })),
        )
      : bitmapStats.atlasPages.map((page) => ({
          key: `${page.strikePpem}-${page.pageIndex}`,
          label: `${page.strikePpem} px · page ${page.pageIndex + 1} · ${page.width}×${page.height}`,
          embeddedBytes: undefined,
          gpuBytes: page.gpuBytes,
        }));
  const pages =
    technique === 'mtsdf'
      ? selectedMtsdfFixtures.flatMap(({ fixture, fontFixture: pageFontFixture, role }) =>
          fixture.raster.pages.map((page) => ({
            key: `${pageFontFixture}-${String(page.index)}`,
            label: `${BENCHMARK_FONT_LABELS[pageFontFixture]} ${role} · page ${page.index + 1} · ${page.width}×${page.height}`,
            embeddedBytes: page.encodedBytes,
            gpuBytes: page.decodedGpuBytes,
          })),
        )
      : technique === 'slug'
        ? slugStats === undefined
          ? selectedSlugFixtures.flatMap(({ fixture, fontFixture: pageFontFixture, role }) =>
              fixture.raster.pages.map((page) => ({
                key: `${pageFontFixture}-slug-page-${page.index}`,
                label: `${BENCHMARK_FONT_LABELS[pageFontFixture]} ${role} · page ${page.index + 1} analytic resources · ${page.width}×${page.height}`,
                embeddedBytes: page.encodedBytes,
                gpuBytes: page.decodedGpuBytes,
              })),
            )
          : [
              {
                key: 'slug-curves',
                label: `RGBA16F curves · ${slugStats.slugCurveTexelCount} texels`,
                embeddedBytes: undefined,
                gpuBytes: slugStats.slugCurveGpuBytes,
              },
              {
                key: 'slug-headers',
                label: `R32UI headers · ${slugStats.slugHeaderCount} used`,
                embeddedBytes: undefined,
                gpuBytes: slugStats.slugHeaderGpuBytes,
              },
              {
                key: 'slug-references',
                label: `R16UI references · ${slugStats.slugReferenceCount} used`,
                embeddedBytes: undefined,
                gpuBytes: slugStats.slugReferenceGpuBytes,
              },
            ]
        : bitmapPages;
  const pageGpuBytes = pages.reduce((total, page) => total + page.gpuBytes, 0);
  const textureBaseBytes = technique === 'slug' ? undefined : textureGpuBytes;
  const texturePaddingBytes = textureBaseBytes === undefined ? undefined : Math.max(0, textureBaseBytes - pageGpuBytes);
  const displayedFontTransferBytes = delivery === 'runtime' ? liveStats?.sourceFontBytes : fontTransferBytes;

  return (
    <>
      <div className="rounded-md border border-border bg-surface p-3" data-testid="payload-inspector">
        <InspectorTableHeader label="Payload" valueLabel="Gzip" />
        <InspectorDisclosure
          className="mt-3 border-b border-border pb-3"
          label="Runtime"
          status={runtime === undefined ? 'unloaded' : 'loaded'}
          value={formatBytes(libraryTransferBytes)}
        >
          <PayloadRow
            label={`${formatLabel(technique)} runtime`}
            status={runtime === undefined ? 'unloaded' : 'loaded'}
            value={formatBytes(runtime?.gzipBytes)}
          />
          <PayloadRow label={shaper.label} status="loaded" value={formatBytes(shaper.gzipBytes)} />
          <p className="text-[9px] leading-relaxed text-dim">
            Includes the pmndrs/glyph core, selected raster runtime, and shaper. External Three.js and React peers are
            not included; font assets are listed below.
          </p>
        </InspectorDisclosure>
        <InspectorDisclosure
          className="pt-3"
          label="Bake (lazy)"
          status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
          value={formatBytes(bakerTransferBytes)}
        >
          <PayloadRow
            label="Runtime baker host"
            status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
            value={formatBytes(runtimeBakerHost.gzipBytes)}
          />
          <PayloadRow
            label="Runtime baker worker"
            status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
            value={formatBytes(runtimeBakerWorker.gzipBytes)}
          />
          <PayloadRow
            label="Core baker host"
            status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
            value={formatBytes(coreBakerHost.gzipBytes)}
          />
          <PayloadRow
            label="Core baker Wasm"
            status={delivery === 'runtime' ? 'loaded' : 'unloaded'}
            value={formatBytes(coreBakerWasm.gzipBytes)}
          />
          <PayloadRow
            label={`${formatLabel(technique)} baker host`}
            status={delivery === 'runtime' && bakerHost !== undefined ? 'loaded' : 'unloaded'}
            value={formatBytes(bakerHost?.gzipBytes)}
          />
          <PayloadRow
            label={`${formatLabel(technique)} baker Wasm`}
            status={delivery === 'runtime' && bakerWasm !== undefined ? 'loaded' : 'unloaded'}
            value={formatBytes(bakerWasm?.gzipBytes)}
          />
        </InspectorDisclosure>
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <InspectorTableHeader
          label="Asset"
          valueLabel={delivery === 'baked' && technique !== 'bitmap' ? 'Gzip' : 'Bytes'}
        />
        <div className="mt-3 pl-6">
          <PayloadRow
            label={delivery === 'runtime' ? 'Source font' : 'Font assets'}
            status={displayedFontTransferBytes === undefined ? 'unloaded' : 'loaded'}
            value={formatBytes(displayedFontTransferBytes)}
          />
        </div>
      </div>
      <div className="rounded-md border border-border bg-surface p-3" data-testid="gpu-resource-inspector">
        <InspectorTableHeader label="Resource" valueLabel="GPU" />
        <InspectorDisclosure
          className="mt-3"
          label={technique === 'slug' ? 'Analytic textures' : 'Atlas textures'}
          status={textureGpuBytes === undefined ? 'unloaded' : 'loaded'}
          value={formatBytes(textureGpuBytes)}
        >
          {technique === 'mtsdf' && (
            <p className="text-[9px] leading-relaxed text-dim">
              MSDF · {mtsdfFixture?.configuration.emSize ?? 64} px/em · {mtsdfFixture?.configuration.pixelRange ?? 8} px
              range
            </p>
          )}
          {technique === 'slug' && (
            <p className="text-[9px] leading-relaxed text-dim">
              Slug · exact RGBA16F curves, R32UI band headers, and R16UI references ·{' '}
              {slugStats?.slugPageCount ?? slugFixture?.raster.pages.length ?? '—'} page
              {(slugStats?.slugPageCount ?? slugFixture?.raster.pages.length) === 1 ? '' : 's'}
            </p>
          )}
          {pages.length === 0 ? (
            <p className="text-[9px] text-dim">Page dimensions appear after the font loads.</p>
          ) : (
            pages.map((page) => (
              <PayloadRow key={page.key} label={page.label} status="loaded" value={formatBytes(page.gpuBytes)} />
            ))
          )}
          {texturePaddingBytes !== undefined && texturePaddingBytes > 0 && (
            <PayloadRow label="Layer padding" status="loaded" value={formatBytes(texturePaddingBytes)} />
          )}
        </InspectorDisclosure>
      </div>
    </>
  );
}

function sumOptionalBytes(values: readonly (number | undefined)[]): number | undefined {
  if (values.length === 0) return undefined;
  let total = 0;
  for (const value of values) {
    if (value === undefined) return undefined;
    total += value;
  }
  return total;
}

function PayloadRow({
  emphasis = false,
  label,
  status,
  value,
}: {
  readonly emphasis?: boolean;
  readonly label: string;
  readonly status?: 'loaded' | 'unloaded';
  readonly value: string;
}) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_2.5rem_3.5rem] items-center gap-x-2 text-[10px] ${emphasis ? 'font-medium' : ''}`}
    >
      <span className={emphasis ? 'text-foreground' : 'text-muted'}>{label}</span>
      {status === undefined ? <span aria-hidden="true" /> : <PayloadStatus status={status} />}
      <span className="whitespace-nowrap text-right font-mono tabular-nums text-dim">{value}</span>
    </div>
  );
}

function PayloadStatus({ status }: { readonly status: 'loaded' | 'unloaded' }) {
  return (
    <span
      aria-label={status}
      className={`grid size-4 place-items-center justify-self-center ${status === 'loaded' ? 'text-success' : 'text-dim'}`}
      title={status}
    >
      <svg aria-hidden="true" className="size-3" viewBox="0 0 12 12">
        {status === 'loaded' ? (
          <path
            d="m2 6 2.5 2.5L10 3"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        ) : (
          <path d="m3 3 6 6m0-6L3 9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
        )}
      </svg>
    </span>
  );
}

function InspectorTableHeader({ label, valueLabel }: { label: string; valueLabel: string }) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_2.5rem_3.5rem] items-center gap-x-2">
      <span aria-hidden="true" />
      <p className="eyebrow">{label}</p>
      <span className="text-center font-mono text-[8px] uppercase text-dim">Loaded</span>
      <span className="text-right font-mono text-[8px] uppercase text-dim">{valueLabel}</span>
    </div>
  );
}

function InspectorDisclosure({
  children,
  className,
  label,
  status,
  value,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly label: string;
  readonly status: 'loaded' | 'unloaded';
  readonly value: string;
}) {
  return (
    <details className={`group ${className ?? ''}`}>
      <summary className="grid cursor-pointer list-none grid-cols-[1rem_minmax(0,1fr)_2.5rem_3.5rem] items-center gap-x-2 text-[10px] font-medium [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          className="size-4 shrink-0 origin-center text-dim transition-transform duration-150 group-open:rotate-90"
          viewBox="0 0 16 16"
        >
          <path
            d="m6 3 5 5-5 5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.75"
          />
        </svg>
        <span className="text-foreground">{label}</span>
        <PayloadStatus status={status} />
        <span className="whitespace-nowrap text-right font-mono tabular-nums text-dim">{value}</span>
      </summary>
      <div className="mt-3 grid gap-2 pl-6">{children}</div>
    </details>
  );
}

interface MeasuredPackageSize {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly gzipBytes: number;
}

function measuredPackageSize(id: string): MeasuredPackageSize {
  const entry = measuredPackageSizeIfAvailable(id);
  if (entry === undefined) throw new Error(`Missing measured package size: ${id}`);
  return entry;
}

function measuredPackageSizeIfAvailable(id: string): MeasuredPackageSize | undefined {
  const entry = packageSizes.entries.find((candidate) => candidate.id === id);
  return entry?.status === 'measured' ? entry : undefined;
}
