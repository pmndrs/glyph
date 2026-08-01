#[cfg(feature = "profiling")]
use core::time::Duration;

#[cfg(feature = "profiling")]
use std::time::Instant;

#[cfg(feature = "profiling")]
use serde::Serialize;

pub(crate) struct PhaseTimer {
    #[cfg(feature = "profiling")]
    started: Instant,
}

impl PhaseTimer {
    #[inline]
    pub(crate) fn start() -> Self {
        Self {
            #[cfg(feature = "profiling")]
            started: Instant::now(),
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum BakePhase {
    Selection,
    OutlineExtraction,
    TexelGeneration,
    Packing,
    TextureEncoding,
}

#[derive(Default)]
pub(crate) struct BakeProfiler {
    #[cfg(feature = "profiling")]
    started: Option<Instant>,
    #[cfg(feature = "profiling")]
    selection: Duration,
    #[cfg(feature = "profiling")]
    outline_extraction: Duration,
    #[cfg(feature = "profiling")]
    texel_generation: Duration,
    #[cfg(feature = "profiling")]
    packing: Duration,
    #[cfg(feature = "profiling")]
    texture_encoding: Duration,
    #[cfg(feature = "profiling")]
    container_serialization: Duration,
    #[cfg(feature = "profiling")]
    selected_glyphs: u64,
    #[cfg(feature = "profiling")]
    generated_glyphs: u64,
    #[cfg(feature = "profiling")]
    generated_texels: u64,
    #[cfg(feature = "profiling")]
    edges_visited: u64,
}

impl BakeProfiler {
    pub(crate) fn start() -> Self {
        Self {
            #[cfg(feature = "profiling")]
            started: Some(Instant::now()),
            ..Self::default()
        }
    }

    #[inline]
    pub(crate) fn measure<Result>(
        &mut self,
        phase: BakePhase,
        operation: impl FnOnce() -> Result,
    ) -> Result {
        #[cfg(feature = "profiling")]
        let started = Instant::now();
        let result = operation();
        #[cfg(feature = "profiling")]
        self.add_duration(phase, started.elapsed());
        #[cfg(not(feature = "profiling"))]
        let _ = phase;
        result
    }

    #[inline]
    pub(crate) fn finish_phase(&mut self, phase: BakePhase, timer: PhaseTimer) {
        #[cfg(feature = "profiling")]
        self.add_duration(phase, timer.started.elapsed());
        #[cfg(not(feature = "profiling"))]
        let _ = (phase, timer);
    }

    #[inline]
    pub(crate) fn finish_container(
        &mut self,
        timer: PhaseTimer,
        #[cfg(feature = "profiling")] texture_encoding_before: Duration,
    ) {
        #[cfg(feature = "profiling")]
        {
            let texture_encoding = self
                .texture_encoding
                .saturating_sub(texture_encoding_before);
            self.container_serialization +=
                timer.started.elapsed().saturating_sub(texture_encoding);
        }
        #[cfg(not(feature = "profiling"))]
        let _ = timer;
    }

    #[cfg(feature = "profiling")]
    pub(crate) fn duration(&self, phase: BakePhase) -> Duration {
        match phase {
            BakePhase::Selection => self.selection,
            BakePhase::OutlineExtraction => self.outline_extraction,
            BakePhase::TexelGeneration => self.texel_generation,
            BakePhase::Packing => self.packing,
            BakePhase::TextureEncoding => self.texture_encoding,
        }
    }

    #[cfg(feature = "profiling")]
    pub(crate) fn add_duration(&mut self, phase: BakePhase, duration: Duration) {
        match phase {
            BakePhase::Selection => self.selection += duration,
            BakePhase::OutlineExtraction => self.outline_extraction += duration,
            BakePhase::TexelGeneration => self.texel_generation += duration,
            BakePhase::Packing => self.packing += duration,
            BakePhase::TextureEncoding => self.texture_encoding += duration,
        }
    }

    #[cfg(feature = "profiling")]
    pub(crate) fn set_selected_glyphs(&mut self, selected_glyphs: u16) {
        self.selected_glyphs = u64::from(selected_glyphs);
    }

    #[cfg(not(feature = "profiling"))]
    pub(crate) fn set_selected_glyphs(&mut self, _selected_glyphs: u16) {}

    #[cfg(feature = "profiling")]
    pub(crate) fn record_generated_glyph(&mut self, texels: usize, edges: usize) {
        self.generated_glyphs += 1;
        let texels = u64::try_from(texels).unwrap_or(u64::MAX);
        let edges = u64::try_from(edges).unwrap_or(u64::MAX);
        self.generated_texels = self.generated_texels.saturating_add(texels);
        self.edges_visited = self
            .edges_visited
            .saturating_add(texels.saturating_mul(edges));
    }

    #[cfg(not(feature = "profiling"))]
    pub(crate) fn record_generated_glyph(&mut self, _texels: usize, _edges: usize) {}

    #[cfg(feature = "profiling")]
    pub(crate) fn finish(self) -> MtsdfBakeProfile {
        MtsdfBakeProfile {
            phases_ns: MtsdfBakePhaseDurations {
                selection: nanos(self.selection),
                outline_extraction: nanos(self.outline_extraction),
                texel_generation: nanos(self.texel_generation),
                packing: nanos(self.packing),
                texture_encoding: nanos(self.texture_encoding),
                container_serialization: nanos(self.container_serialization),
                total: nanos(
                    self.started
                        .map_or(Duration::ZERO, |started| started.elapsed()),
                ),
            },
            counters: MtsdfBakeCounters {
                selected_glyphs: self.selected_glyphs,
                generated_glyphs: self.generated_glyphs,
                generated_texels: self.generated_texels,
                edges_visited: self.edges_visited,
            },
        }
    }
}

#[cfg(feature = "profiling")]
fn nanos(duration: Duration) -> u64 {
    u64::try_from(duration.as_nanos()).unwrap_or(u64::MAX)
}

#[cfg(feature = "profiling")]
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtsdfBakeProfile {
    pub phases_ns: MtsdfBakePhaseDurations,
    pub counters: MtsdfBakeCounters,
}

#[cfg(feature = "profiling")]
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtsdfBakePhaseDurations {
    pub selection: u64,
    pub outline_extraction: u64,
    pub texel_generation: u64,
    pub packing: u64,
    pub texture_encoding: u64,
    pub container_serialization: u64,
    pub total: u64,
}

#[cfg(feature = "profiling")]
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtsdfBakeCounters {
    pub selected_glyphs: u64,
    pub generated_glyphs: u64,
    pub generated_texels: u64,
    pub edges_visited: u64,
}

#[cfg(feature = "profiling")]
pub struct ProfiledMtsdfBake {
    pub result: crate::MtsdfBakeResultV0,
    pub profile: MtsdfBakeProfile,
}
