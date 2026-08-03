import { lazy, Suspense, type ReactNode } from 'react';

import type { BenchmarkSummary } from '../benchmark/contracts';
import { createPayloadSummary } from '../benchmark/payload-summary';
import { useRuntimeTelemetry } from '../benchmark/runtime-world';
import type { LiveBenchmarkCapture } from '../benchmark/product-result';
import type { AdvancedShapingFrame } from '../workloads/advanced-shaping';
import {
  benchmarkWorkloadDefinition,
  isBenchmarkWorkloadId,
  type BenchmarkWorkloadDefinition,
} from '../workloads/catalog';
import {
  ADVANCED_FONT_FIXTURES,
  BENCHMARK_FONT_LABELS,
  SELECTABLE_FONT_FIXTURES,
  type BenchmarkFontFixture,
  selectableFontFixture,
} from '../benchmark/font-fixtures';
import { workloadsFor } from '../benchmark/workloads';
import type { HarnessLocation, HarnessMode, RasterTechnique } from '../benchmark/url-state';
import bitmapFixtures from '../../fixtures/rendering/showcase-bitmap-density-fixtures-v0.json';
import mtsdfFixtures from '../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json';
import slugFixtures from '../../fixtures/rendering/showcase-slug-fixtures-v0.json';
import packageSizes from '../generated/package-sizes.json';
import { CompactSheet, CompactWorkloadPanel, MobileNavigation } from './responsive-shell';
import { ExportPanel } from './export-panel';
import { PresentationLayout } from './presentation-layout';
import { PresentationPayloadPills } from './presentation-payload-pills';
import { Report } from './report';
import { TechniqueSwitcher } from './technique-switcher';
import { TelemetryCharts } from './telemetry-charts';
import { TopBar } from './top-bar';
import { WorkloadRail } from './workload-rail';

const FontNoticesDialog = lazy(() => import('./font-notices-dialog'));

export interface HarnessLayoutProps {
  readonly actionEligible: boolean;
  readonly activeFontFixture: BenchmarkFontFixture;
  readonly controls: ReactNode;
  readonly desktop: boolean;
  readonly fontNoticesOpen: boolean;
  readonly isPending: boolean;
  readonly liveCapture: LiveBenchmarkCapture | undefined;
  readonly liveTechniqueComparison: boolean;
  readonly location: HarnessLocation;
  readonly phone: boolean;
  readonly presentationPlaying: boolean;
  readonly scene: ReactNode;
  readonly showcaseFrame: AdvancedShapingFrame;
  readonly summary: BenchmarkSummary | undefined;
  readonly webgpu: boolean;
  readonly workloadPanelOpen: boolean;
  readonly onAction: () => void;
  readonly onAdvancedFontFixture: (value: BenchmarkFontFixture) => void;
  readonly onCloseFontNotices: () => void;
  readonly onLocation: (value: Partial<HarnessLocation>) => void;
  readonly onMode: (mode: HarnessMode) => void;
  readonly onTechnique: (technique: RasterTechnique) => void;
  readonly onWorkloadPanelOpen: (open: boolean | ((current: boolean) => boolean)) => void;
}

export function HarnessLayout({
  actionEligible,
  activeFontFixture,
  controls,
  desktop,
  fontNoticesOpen,
  isPending,
  liveCapture,
  liveTechniqueComparison,
  location,
  phone,
  presentationPlaying,
  scene,
  showcaseFrame,
  summary,
  webgpu,
  workloadPanelOpen,
  onAction,
  onAdvancedFontFixture,
  onCloseFontNotices,
  onLocation,
  onMode,
  onTechnique,
  onWorkloadPanelOpen,
}: HarnessLayoutProps) {
  const { stats: liveStats } = useRuntimeTelemetry();
  const actionReady = actionEligible && (location.mode === 'conformance' || liveStats !== undefined);
  const presentationMode = location.layout === 'presentation' && location.mode === 'benchmark';
  if (presentationMode) {
    const presentationWorkload = isBenchmarkWorkloadId(location.workload) ? location.workload : 'benchmark-ipsum';
    const presentationDefinition = benchmarkWorkloadDefinition(presentationWorkload);
    const presentationPayload = createPayloadSummary({
      delivery: location.delivery,
      fixtureManifests: { bitmap: bitmapFixtures, mtsdf: mtsdfFixtures, slug: slugFixtures },
      fontFixture: activeFontFixture,
      ...(liveStats === undefined ? {} : { liveStats }),
      packageSizes,
      technique: location.technique,
      workload: location.workload,
    });
    return (
      <>
        <PresentationLayout
          controls={controls}
          fontOptions={presentationFontOptions(presentationDefinition)}
          fontValue={presentationFontValue(presentationDefinition, activeFontFixture)}
          payload={<PresentationPayloadPills summary={presentationPayload} />}
          playing={presentationPlaying}
          scene={scene}
          techniqueControl={
            <TechniqueSwitcher
              className="w-44"
              presentation="presentation"
              technique={location.technique}
              onTechnique={onTechnique}
            />
          }
          telemetry={<TelemetryCharts presentation="presentation" stats={liveStats} />}
          workloadOptions={workloadsFor('benchmark').map((option) => ({
            disabled: option.techniques[location.technique].kind !== 'ready',
            label: option.label,
            value: option.id,
          }))}
          workloadValue={presentationWorkload}
          onExit={() => onLocation({ layout: 'main' })}
          onFont={(value) => {
            const policy = presentationDefinition.fontPolicy;
            if (policy.kind === 'fixed' || policy.kind === 'icon-grid') return;
            if (policy.kind === 'advanced-case') {
              onAdvancedFontFixture(value as BenchmarkFontFixture);
              return;
            }
            onLocation({ fontFixture: selectableFontFixture(value) });
          }}
          onWorkload={(workloadId) => onLocation({ workload: workloadId, view: 'scene' })}
        />
        {fontNoticesOpen && (
          <Suspense fallback={null}>
            <FontNoticesDialog onClose={onCloseFontNotices} />
          </Suspense>
        )}
      </>
    );
  }

  return (
    <div className="relative h-dvh overflow-hidden bg-background text-foreground">
      <TopBar
        compact={!desktop}
        phone={phone}
        location={location}
        mode={location.mode}
        liveTechniqueComparison={liveTechniqueComparison}
        pending={isPending}
        ready={Boolean(actionReady)}
        webgpu={webgpu}
        onAction={
          location.mode === 'benchmark'
            ? location.view === 'report'
              ? () => onLocation({ view: 'scene' })
              : onAction
            : onAction
        }
        onControls={() => {
          onWorkloadPanelOpen(false);
          onLocation({ view: location.view === 'controls' ? 'scene' : 'controls' });
        }}
        onMenu={() => {
          if (!workloadPanelOpen && location.view === 'controls') onLocation({ view: 'scene' });
          onWorkloadPanelOpen((open) => !open);
        }}
        onMode={onMode}
        onTechnique={onTechnique}
        onPresentationMode={() => onLocation({ layout: 'presentation', mode: 'benchmark', view: 'scene' })}
        workloadPanelOpen={workloadPanelOpen}
      />
      <div
        className={
          desktop
            ? 'grid h-[calc(100dvh-52px)] transition-[grid-template-columns] duration-200'
            : phone
              ? 'h-[calc(100dvh-52px)] pb-[58px]'
              : 'h-[calc(100dvh-52px)]'
        }
        style={
          desktop
            ? {
                gridTemplateColumns: workloadPanelOpen
                  ? '224px minmax(640px, 1fr) 288px'
                  : '0 minmax(640px, 1fr) 288px',
              }
            : undefined
        }
      >
        <div className={desktop ? 'min-w-0 overflow-hidden' : 'hidden'}>
          <WorkloadRail
            activeFontFixture={activeFontFixture}
            className="h-full w-56"
            location={location}
            showcaseFrame={showcaseFrame}
            onFontFixture={(value) => onLocation({ fontFixture: value })}
            onAdvancedFontFixture={onAdvancedFontFixture}
            onLocation={onLocation}
            onTechnique={onTechnique}
          />
        </div>
        <main
          className={
            desktop
              ? 'min-w-0 overflow-hidden border-r border-border bg-background p-4'
              : 'h-full min-h-0 overflow-hidden p-3'
          }
        >
          <div className={location.view !== 'report' && location.view !== 'export' ? 'h-full' : 'hidden'}>{scene}</div>
          {!desktop && location.view === 'controls' && (
            <CompactSheet phone={phone} title="Controls" onClose={() => onLocation({ view: 'scene' })}>
              {controls}
            </CompactSheet>
          )}
          {location.view === 'report' && (
            <div className="h-full overflow-y-auto overscroll-contain">
              <Report liveCapture={liveCapture} summary={summary} />
            </div>
          )}
          {location.view === 'export' && (
            <div className="h-full overflow-y-auto overscroll-contain">
              <ExportPanel liveCapture={liveCapture} summary={summary} />
            </div>
          )}
        </main>
        <aside className={desktop ? 'overflow-auto overscroll-contain bg-chrome p-4' : 'hidden'}>{controls}</aside>
        {!desktop && workloadPanelOpen && (
          <CompactWorkloadPanel phone={phone} onClose={() => onWorkloadPanelOpen(false)}>
            <WorkloadRail
              activeFontFixture={activeFontFixture}
              className="h-full w-full border-r-0"
              location={location}
              showcaseFrame={showcaseFrame}
              showTechnique={false}
              onFontFixture={(value) => onLocation({ fontFixture: value })}
              onAdvancedFontFixture={onAdvancedFontFixture}
              onLocation={(value) => {
                onLocation({ ...value, view: 'scene' });
                onWorkloadPanelOpen(false);
              }}
              onTechnique={onTechnique}
            />
          </CompactWorkloadPanel>
        )}
        {!desktop && phone && <MobileNavigation location={location} onLocation={onLocation} />}
      </div>
      {fontNoticesOpen && (
        <Suspense fallback={null}>
          <FontNoticesDialog onClose={onCloseFontNotices} />
        </Suspense>
      )}
    </div>
  );
}

function presentationFontOptions(definition: BenchmarkWorkloadDefinition) {
  const policy = definition.fontPolicy;
  if (policy.kind === 'advanced-case') {
    return ADVANCED_FONT_FIXTURES.map((fixture) => ({ label: fixture.label, value: fixture.id }));
  }
  if (policy.kind === 'icon-grid') {
    return [{ label: BENCHMARK_FONT_LABELS[policy.iconFixture], value: policy.iconFixture }];
  }
  if (policy.kind === 'fixed') {
    return [{ label: BENCHMARK_FONT_LABELS[policy.defaultFixture], value: policy.defaultFixture }];
  }
  return SELECTABLE_FONT_FIXTURES.map((fixture) => ({ label: fixture.label, value: fixture.id }));
}

function presentationFontValue(
  definition: BenchmarkWorkloadDefinition,
  activeFontFixture: BenchmarkFontFixture,
): BenchmarkFontFixture {
  const policy = definition.fontPolicy;
  if (policy.kind === 'icon-grid') return policy.iconFixture;
  if (policy.kind === 'fixed') return policy.defaultFixture;
  return activeFontFixture;
}
