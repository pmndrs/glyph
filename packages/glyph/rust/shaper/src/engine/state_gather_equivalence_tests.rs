// Seeded differential proof of the gather, included into `state::tests`.
//
// After every publication of a random change, three independent derivations of the same
// prepared state must agree: the retained workspace the engine patched in place, a fresh
// write-only gather, and the canonical row projection (one projected row per glyph, read
// field by field). The host model then replays only the patches the engine published and
// must hold the bytes a fresh compilation of the fresh gather publishes.

mod gather_equivalence {
    use super::*;
    use crate::engine::{
        codec::{InputScope, InputSource},
        codec_gather::srgb8_to_linear,
        frame::{
            ALIGN_CENTER, ALIGN_JUSTIFY, OVERFLOW_VISIBLE, STYLE_FIELD_LETTER_SPACING, STYLE_FIELD_OPACITY,
            STYLE_FIELD_OUTLINE, STYLE_FIELD_SHADOW,
            SEMANTIC_F32_BLOCK_ORIGIN, SEMANTIC_F32_FOREGROUND_ALPHA, SEMANTIC_F32_FOREGROUND_BLUE,
            SEMANTIC_F32_FOREGROUND_GREEN, SEMANTIC_F32_FOREGROUND_RED, SEMANTIC_F32_INLINE_ORIGIN,
            SEMANTIC_F32_INVERSE_FONT_SIZE, SEMANTIC_F32_OUTLINE_WIDTH_EM,
            SEMANTIC_F32_SHADOW_OFFSET_X_EM, SEMANTIC_F32_SHADOW_OFFSET_Y_EM,
            SEMANTIC_U32_PLACEMENT_SLOT,
        },
        ordered_plan::replay::TestHost,
        placement_state::SegmentTranslation,
        plan_input::PlanGlyph,
        positioning::ProjectedSourceRow,
        render_plan_compiler::RenderPlanCompiler,
    };

    const CAPABILITY: CapabilitySetId = CapabilitySetId(1);
    const F32_SEMANTIC_FIELDS: u8 = SEMANTIC_F32_SHADOW_OFFSET_Y_EM + 1;
    const U32_SEMANTIC_FIELDS: u8 = SEMANTIC_U32_PLACEMENT_SLOT + 1;

    const INTER: &[u8] =
        include_bytes!("../../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
    const FREDOKA: &[u8] = include_bytes!(
        "../../../../../../benches/fixtures/fonts/fredoka-issue-216/Fredoka-Regular.ttf"
    );
    const AMIRI: &[u8] =
        include_bytes!("../../../../../../benches/fixtures/fonts/amiri-1.002/Amiri-Regular.ttf");
    const DEVANAGARI: &[u8] = include_bytes!(
        "../../../../../../benches/fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf"
    );
    const DOT_GOTHIC: &[u8] = include_bytes!(
        "../../../../../../benches/fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf"
    );

    const LATIN: &str = "Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning \
        pairs while a responsive panel changes the space around them. Repeated office, affine, \
        difficult and shuffle words keep ff, fi, fl, ffi and ffl candidates 0123456789.";
    const ROUNDED: &str = "Reveals one grapheme at a time over a duration. Layout stays put and \
        a trigger fires at the end. Reveals one grapheme at a time over a duration.";
    const ARABIC: &str = "الطباعة نظام متحرك يتغير مع تغير المساحة حوله. النص العربي يتصل \
        بحروفه ويتشكل حسب موضعه في الكلمة. الطباعة نظام متحرك يتغير مع تغير المساحة حوله.";
    const HINDI: &str = "देवनागरी लिपि में लिखा गया पाठ संयुक्ताक्षरों और मात्राओं के साथ आकार \
        लेता है। क्ष त्र ज्ञ श्र द्ध क्त स्त्र प्र ग्र द्र ट्र हिन्दी शब्द फिर से आते हैं।";
    const JAPANESE: &str = "日本語のテキストは行の途中で折り返されます。文字の間隔と行の高さを\
        変えて配置を確かめます。日本語のテキストは行の途中で折り返されます。";
    const MIXED: &str = "Latin words then العربية نص متصل and back to Latin 123, then مرة أخرى \
        العربية before a closing Latin phrase.";

    #[derive(Clone, Copy, PartialEq)]
    enum Shape {
        Plain,
        DropCapExclusion,
        Ellipsis,
    }

    #[derive(Clone, Copy)]
    struct Scenario {
        name: &'static str,
        fonts: &'static [&'static [u8]],
        text: &'static str,
        inline: bool,
        shape: Shape,
        align: u8,
        spans: bool,
        decorated: bool,
        /// Every unit starts a grapheme, so any offset is a style boundary. Such a span can
        /// start inside a layout run, where positioning does not yet accept a size change
        /// (it asserts one font size per run), so its second span restyles paint instead.
        unit_boundaries: bool,
    }

    const PLAIN: Scenario = Scenario {
        name: "inter",
        fonts: &[INTER],
        text: LATIN,
        inline: false,
        shape: Shape::Plain,
        align: ALIGN_START,
        spans: false,
        decorated: false,
        unit_boundaries: false,
    };

    const SCENARIOS: &[Scenario] = &[
        PLAIN,
        Scenario {
            name: "inter multi-style",
            spans: true,
            ..PLAIN
        },
        Scenario {
            name: "inter justified",
            align: ALIGN_JUSTIFY,
            ..PLAIN
        },
        Scenario {
            name: "inter drop cap and exclusion",
            shape: Shape::DropCapExclusion,
            spans: true,
            ..PLAIN
        },
        Scenario {
            name: "inter ellipsis",
            shape: Shape::Ellipsis,
            ..PLAIN
        },
        Scenario {
            name: "inter decorated",
            decorated: true,
            ..PLAIN
        },
        Scenario {
            name: "inter inline label",
            text: "label 012",
            inline: true,
            ..PLAIN
        },
        Scenario {
            name: "fredoka",
            fonts: &[FREDOKA],
            text: ROUNDED,
            spans: true,
            ..PLAIN
        },
        Scenario {
            name: "amiri",
            fonts: &[AMIRI],
            text: ARABIC,
            spans: true,
            ..PLAIN
        },
        Scenario {
            name: "amiri centred",
            fonts: &[AMIRI],
            text: ARABIC,
            align: ALIGN_CENTER,
            ..PLAIN
        },
        Scenario {
            name: "devanagari",
            fonts: &[DEVANAGARI],
            text: HINDI,
            spans: true,
            ..PLAIN
        },
        Scenario {
            name: "japanese",
            fonts: &[DOT_GOTHIC],
            text: JAPANESE,
            spans: true,
            unit_boundaries: true,
            ..PLAIN
        },
        Scenario {
            name: "latin and arabic stack",
            fonts: &[INTER, AMIRI],
            text: MIXED,
            spans: true,
            ..PLAIN
        },
    ];

    struct Random(u32);

    impl Random {
        fn next(&mut self) -> u32 {
            self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            self.0 >> 8
        }

        fn below(&mut self, bound: usize) -> usize {
            self.next() as usize % bound
        }

        fn pick<T: Copy>(&mut self, values: &[T]) -> T {
            values[self.below(values.len())]
        }
    }

    #[derive(Clone, Copy)]
    struct Style {
        id: u32,
        start: u32,
        end: u32,
        font_size: Option<f32>,
        line_height: Option<f32>,
        ratio: Option<f32>,
        letter_spacing: Option<f32>,
        foreground: Option<u32>,
        opacity: Option<f32>,
        outline: Option<(u32, f32)>,
        shadow: Option<(u32, f32, f32)>,
        decorated: bool,
    }

    impl Style {
        fn span(id: u32) -> Self {
            Self {
                id,
                start: 0,
                end: 0,
                font_size: None,
                line_height: None,
                ratio: None,
                letter_spacing: None,
                foreground: None,
                opacity: None,
                outline: None,
                shadow: None,
                decorated: false,
            }
        }

        fn write(&self, record: &mut [u8]) {
            let root = self.id == 1;
            record[abi::ENGINE_STYLE_MUTATION_OPCODE] = STYLE_MUTATION_UPSERT;
            record[abi::ENGINE_STYLE_MUTATION_FLAGS] = if root { STYLE_FLAG_ROOT } else { 0 };
            write_u32(record, abi::ENGINE_STYLE_MUTATION_STYLE_ID, self.id);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_PARAGRAPH_ID, 1);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_CASCADE_ORDER, self.id - 1);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_TEXT_START, self.start);
            write_u32(record, abi::ENGINE_STYLE_MUTATION_TEXT_END, self.end);
            let mut mask = 0;
            if root {
                mask |= STYLE_FIELD_FONT_STACK;
                write_u32(record, abi::ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE, 7);
            }
            let mut float = |field: u32, offset: usize, value: Option<f32>| {
                if let Some(value) = value {
                    mask |= field;
                    write_f32(record, offset, value);
                }
            };
            float(
                STYLE_FIELD_FONT_SIZE,
                abi::ENGINE_STYLE_MUTATION_FONT_SIZE,
                self.font_size,
            );
            float(
                STYLE_FIELD_LINE_HEIGHT,
                abi::ENGINE_STYLE_MUTATION_LINE_HEIGHT,
                self.line_height,
            );
            float(
                STYLE_FIELD_RASTER_PIXEL_RATIO,
                abi::ENGINE_STYLE_MUTATION_RASTER_PIXEL_RATIO,
                self.ratio,
            );
            float(
                STYLE_FIELD_LETTER_SPACING,
                abi::ENGINE_STYLE_MUTATION_LETTER_SPACING,
                self.letter_spacing,
            );
            float(
                STYLE_FIELD_OPACITY,
                abi::ENGINE_STYLE_MUTATION_OPACITY,
                self.opacity,
            );
            if let Some(foreground) = self.foreground {
                mask |= STYLE_FIELD_FOREGROUND;
                write_u32(record, abi::ENGINE_STYLE_MUTATION_FOREGROUND_RGBA, foreground);
            }
            if let Some((rgba, width)) = self.outline {
                mask |= STYLE_FIELD_OUTLINE;
                write_u32(record, abi::ENGINE_STYLE_MUTATION_OUTLINE_RGBA, rgba);
                write_f32(record, abi::ENGINE_STYLE_MUTATION_OUTLINE_WIDTH, width);
            }
            if let Some((rgba, x, y)) = self.shadow {
                mask |= STYLE_FIELD_SHADOW;
                write_u32(record, abi::ENGINE_STYLE_MUTATION_SHADOW_RGBA, rgba);
                write_f32(record, abi::ENGINE_STYLE_MUTATION_SHADOW_OFFSET_X, x);
                write_f32(record, abi::ENGINE_STYLE_MUTATION_SHADOW_OFFSET_Y, y);
            }
            if self.decorated {
                mask |= STYLE_FIELD_DECORATION;
                record[abi::ENGINE_STYLE_MUTATION_DECORATION_STYLE] = DECORATION_SOLID;
                write_u32(
                    record,
                    abi::ENGINE_STYLE_MUTATION_DECORATION_FLAGS,
                    DECORATION_UNDERLINE,
                );
                write_u32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_RGBA, u32::MAX);
                write_f32(record, abi::ENGINE_STYLE_MUTATION_DECORATION_THICKNESS, 1.0);
            }
            write_u32(record, abi::ENGINE_STYLE_MUTATION_FIELD_MASK, mask);
        }
    }

    fn style_bytes(styles: &[Style]) -> Vec<u8> {
        let header = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
        let size = abi::ENGINE_STYLE_MUTATION_RECORD_SIZE as usize;
        let mut bytes = vec![0; header + size * styles.len()];
        for (index, style) in styles.iter().enumerate() {
            style.write(&mut bytes[header + index * size..header + (index + 1) * size]);
        }
        bytes
    }

    /// Outline every glyph but `.notdef`, the space and one glyph in eleven, so source rows
    /// include glyphs positioning never outlines.
    fn register_face(shaper: &mut ShaperRegistry, handle: u32, font: &[u8]) -> u32 {
        let face = read_fonts::FontRef::new(font).unwrap();
        let glyph_count = u32::from(face.maxp().unwrap().num_glyphs());
        let space = face
            .cmap()
            .unwrap()
            .map_codepoint(u32::from(' '))
            .map_or(0, |glyph| glyph.to_u32() as usize);
        let mut extents = vec![0; glyph_count as usize * 8];
        let mut availability = vec![0; (glyph_count as usize).div_ceil(8)];
        for glyph in 1..glyph_count as usize {
            if glyph == space || glyph % 11 == 5 {
                continue;
            }
            availability[glyph >> 3] |= 1 << (glyph & 7);
            extents[glyph * 8 + 4..glyph * 8 + 6].copy_from_slice(&500_i16.to_le_bytes());
            extents[glyph * 8 + 6..glyph * 8 + 8].copy_from_slice(&1_000_i16.to_le_bytes());
        }
        assert_eq!(
            shaper.register_font(handle, font, &extents, &availability, 0, 0),
            0
        );
        glyph_count
    }

    /// Two strikes and three resources. One outlined glyph in thirteen has no raster in the
    /// small strike, so a size or pixel-ratio change moves which source rows own a record.
    fn rich_binding(glyph_count: u32, technique: u32) -> FontRenderBinding {
        let strike_rows = glyph_count * 2;
        let resources = (0..strike_rows)
            .map(|row| {
                let (strike, glyph) = (row / glyph_count, row % glyph_count);
                if glyph == 0 || (strike == 0 && glyph % 13 == 7) {
                    MISSING_RESOURCE_INDEX
                } else {
                    (glyph + strike) % 3
                }
            })
            .collect();
        FontRenderBinding::new(
            TechniqueId(technique),
            0,
            glyph_count,
            vec![FontStrike { ppem: 16 }, FontStrike { ppem: 32 }],
            (1..=3)
                .map(|id| FontResource {
                    id,
                    generation: 1,
                    kind: 1,
                    reference: id * 10,
                })
                .collect(),
            resources,
            FieldTable::new(
                glyph_count,
                1,
                (0..glyph_count).map(|glyph| glyph as f32 * 0.25).collect(),
            )
            .unwrap(),
            FieldTable::new(
                glyph_count,
                1,
                (0..glyph_count).map(|glyph| glyph ^ 0x5a5a).collect(),
            )
            .unwrap(),
            FieldTable::new(
                strike_rows,
                1,
                (0..strike_rows).map(|row| row as f32 * 0.5).collect(),
            )
            .unwrap(),
            FieldTable::new(strike_rows, 1, (0..strike_rows).map(|row| row * 3).collect())
                .unwrap(),
            FieldTable::new(3, 1, vec![0.5, 1.5, 2.5]).unwrap(),
            FieldTable::new(3, 1, vec![7, 9, 11]).unwrap(),
        )
        .unwrap()
    }

    /// Declares every semantic input and one input of each binding scope, and stores each
    /// of them in a buffer lane so a change mask that is too narrow leaves stale bytes.
    fn complete_codec() -> ValidatedCodec {
        let base = validated_codec(TechniqueId(1));
        let mut capability_sets = base.capability_sets().to_vec();
        for set in &mut capability_sets {
            set.max_buffer_bytes = 1 << 22;
            set.max_buffers_per_draw = 16;
        }
        let mut program = base.programs()[0].clone();
        let scoped = |scope| InputSource { scope, field: 0 };
        let f32_inputs: Vec<_> = (0..F32_SEMANTIC_FIELDS)
            .map(InputSource::semantic)
            .chain([InputScope::Glyph, InputScope::Strike, InputScope::Resource].map(scoped))
            .collect();
        let u32_inputs: Vec<_> = (0..U32_SEMANTIC_FIELDS)
            .map(InputSource::semantic)
            .chain([InputScope::Glyph, InputScope::Strike, InputScope::Resource].map(scoped))
            .collect();
        program.f32_input_count = f32_inputs.len() as u8;
        program.u32_input_count = u32_inputs.len() as u8;
        program.buffers.clear();
        program.operations.clear();
        let mut buffer = 0_u16;
        for (scalar, count, first_register) in [
            (ScalarType::F32, f32_inputs.len(), 0),
            (ScalarType::U32, u32_inputs.len(), f32_inputs.len()),
        ] {
            for lane_start in (0..count).step_by(4) {
                buffer += 1;
                let width = (count - lane_start).min(4);
                program.buffers.push(BufferSchema::packed(
                    BufferId(buffer),
                    scalar,
                    width as u8,
                    BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    1,
                ));
                for lane in 0..width {
                    let field = (lane_start + lane) as u8;
                    let register = (first_register + lane_start + lane) as u8;
                    program.operations.extend(if scalar == ScalarType::F32 {
                        [
                            Operation::LoadF32 {
                                target: register,
                                field,
                            },
                            Operation::StoreF32 {
                                source: register,
                                buffer: BufferId(buffer),
                                lane: lane as u8,
                            },
                        ]
                    } else {
                        [
                            Operation::LoadU32 {
                                target: register,
                                field,
                            },
                            Operation::StoreU32 {
                                source: register,
                                buffer: BufferId(buffer),
                                lane: lane as u8,
                            },
                        ]
                    });
                }
            }
        }
        program.inputs = f32_inputs.into_iter().chain(u32_inputs).collect();
        ValidatedCodec::new(CodecDescriptor {
            capability_sets,
            programs: vec![program],
        })
        .unwrap()
    }

    struct Fixture {
        scenario: Scenario,
        engine: TextEngine,
        shaper: ShaperRegistry,
        host: TestHost,
        step: u32,
        text: Vec<u16>,
        alphabet: Vec<u16>,
        styles: Vec<Style>,
        width: f32,
        geometry_revision: u32,
    }

    #[derive(Default)]
    struct Change {
        text: Option<(u32, u32, Vec<u16>)>,
        styles: bool,
        geometry: bool,
    }

    impl Fixture {
        fn new(scenario: Scenario) -> Self {
            let mut shaper = ShaperRegistry::default();
            let mut engine = TextEngine::default();
            engine.register_codec(9, complete_codec()).unwrap();
            let mut stack = Vec::new();
            for (index, font) in scenario.fonts.iter().enumerate() {
                let shaping = index as u32 + 1;
                let glyph_count = register_face(&mut shaper, shaping, font);
                engine
                    .register_font_binding(42 + shaping, shaping, glyph_count, rich_binding(glyph_count, 1))
                    .unwrap();
                stack.push(42 + shaping);
            }
            engine.register_font_stack(7, &stack).unwrap();
            engine.create_root(4).unwrap();
            let text = utf16(scenario.text);
            engine.reserve_root_text(4, text.len() as u32).unwrap();
            if !scenario.inline {
                engine
                    .planners
                    .get_mut(&4)
                    .unwrap()
                    .spare_paragraph
                    .as_mut()
                    .unwrap()
                    .disable_inline = true;
            }
            let mut alphabet: Vec<u16> = text
                .iter()
                .copied()
                .filter(|unit| *unit != u16::from(b' '))
                .collect();
            alphabet.sort_unstable();
            alphabet.dedup();
            let mut styles = vec![Style {
                font_size: Some(16.0),
                line_height: Some(1.2),
                ratio: Some(1.0),
                decorated: scenario.decorated,
                ..Style::span(1)
            }];
            if scenario.spans {
                styles.push(Style {
                    foreground: Some(0xff20_40ff),
                    ..Style::span(2)
                });
                styles.push(if scenario.unit_boundaries {
                    Style {
                        opacity: Some(0.5),
                        ..Style::span(3)
                    }
                } else {
                    Style {
                        font_size: Some(22.0),
                        ..Style::span(3)
                    }
                });
            }
            let mut fixture = Self {
                scenario,
                engine,
                shaper,
                host: TestHost::default(),
                step: 0,
                alphabet,
                styles,
                width: if scenario.inline { 4_096.0 } else { 260.0 },
                geometry_revision: 1,
                text: Vec::new(),
            };
            fixture.publish(
                Change {
                    text: Some((0, 0, text)),
                    styles: true,
                    geometry: true,
                },
                "initial publication",
            );
            assert_eq!(
                fixture
                    .engine
                    .planners
                    .get(&4)
                    .unwrap()
                    .first_paragraph_state()
                    .unwrap()
                    .active_inline()
                    .is_some(),
                scenario.inline,
                "{}: prepared owner kind",
                scenario.name
            );
            fixture
        }

        /// Style boundaries that never split a grapheme: after a space, or every unit for a
        /// script whose units are whole graphemes.
        fn boundaries(&self) -> Vec<u32> {
            let mut boundaries = vec![0];
            for (index, unit) in self.text.iter().enumerate() {
                if self.scenario.unit_boundaries || *unit == u16::from(b' ') {
                    boundaries.push(index as u32 + 1);
                }
            }
            boundaries.push(self.text.len() as u32);
            boundaries.dedup();
            boundaries
        }

        /// Places the two spans on disjoint boundary ranges in the two halves of the text.
        fn place_spans(&mut self, random: &mut Random) {
            let boundaries = self.boundaries();
            let end = self.text.len() as u32;
            self.styles[0].end = end;
            if self.styles.len() < 3 {
                return;
            }
            // Two non-empty ranges, the first inside the first half of the boundaries and
            // the second inside the rest; every scenario text has far more than four.
            let last = boundaries.len() - 1;
            let half = last / 2;
            assert!(half >= 1 && last - half >= 1, "too few style boundaries");
            let mut range = |from: usize, to: usize| {
                let start = from + random.below(to - from);
                let end = start + 1 + random.below(to - start);
                (boundaries[start], boundaries[end])
            };
            (self.styles[1].start, self.styles[1].end) = range(0, half);
            (self.styles[2].start, self.styles[2].end) = range(half, last);
        }

        fn geometry(&self) -> (Vec<u8>, u32) {
            let constraint = ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
            let region = constraint + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
            let (mut bytes, exclusions) = match self.scenario.shape {
                Shape::DropCapExclusion => (
                    drop_cap_exclusion_geometry_bytes(0.0, self.geometry_revision),
                    1,
                ),
                Shape::Plain | Shape::Ellipsis => (multiline_root_geometry_bytes(), 0),
            };
            if self.scenario.inline {
                // A one-line label that may overflow is what the Inline owner admits.
                bytes = root_geometry_bytes();
                bytes[constraint + abi::ENGINE_CONSTRAINT_OVERFLOW] = OVERFLOW_VISIBLE;
            }
            if self.scenario.shape == Shape::Ellipsis {
                write_u32(&mut bytes, constraint + abi::ENGINE_CONSTRAINT_MAX_LINES, 3);
                bytes[constraint + abi::ENGINE_CONSTRAINT_OVERFLOW] = OVERFLOW_ELLIPSIS;
            }
            bytes[constraint + abi::ENGINE_CONSTRAINT_ALIGN] = self.scenario.align;
            write_f32(
                &mut bytes,
                constraint + abi::ENGINE_CONSTRAINT_WIDTH,
                self.width,
            );
            for field in [
                abi::ENGINE_REGION_INLINE_END,
                abi::ENGINE_REGION_CLIP_INLINE_END,
            ] {
                write_f32(&mut bytes, region + field, self.width);
            }
            write_u32(
                &mut bytes,
                region + abi::ENGINE_REGION_GEOMETRY_REVISION,
                self.geometry_revision,
            );
            (bytes, exclusions)
        }

        fn publish(&mut self, change: Change, label: &str) {
            let label = alloc::format!(
                "{}, step {}: {label}",
                self.scenario.name,
                self.step
            );
            if std::env::var_os("GATHER_EQUIVALENCE_TRACE").is_some() {
                std::eprintln!("{label}");
            }
            let mut restyle = change.styles;
            let text_bytes = change.text.map(|(start, delete, insert)| {
                let bytes = text_mutation_bytes(&[(start, delete, &insert)]);
                // Style ranges only have to follow a text whose length changed.
                restyle |= delete as usize != insert.len();
                self.text
                    .splice(start as usize..(start + delete) as usize, insert);
                bytes
            });
            if restyle {
                // Ranges follow the text; a fixed seed keeps the placement reproducible.
                let mut random = Random(self.step.wrapping_mul(2_654_435_761) ^ 0x9e37_79b9);
                self.place_spans(&mut random);
            }
            let styles = style_bytes(&self.styles);
            let (geometry, exclusions) = self.geometry();
            let mut request = update(self.step, self.step, self.step);
            request.limits.max_clusters = (self.text.len() as u32 + 64).max(256);
            request.limits.max_lines = (self.text.len() as u32 + 64).max(256);
            request.limits.max_output_bytes = 1 << 22;
            request.limits.max_slots_per_band = if exclusions == 0 { 1 } else { 4 };
            if let Some(bytes) = &text_bytes {
                request.text_mutations =
                    parse_text_mutations(bytes, ENGINE_UPDATE_REQUEST_HEADER_SIZE, 1).unwrap();
            }
            if restyle {
                request.style_mutations = parse_style_mutations(
                    &styles,
                    ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                    self.styles.len() as u32,
                )
                .unwrap();
            }
            if change.geometry {
                request.geometry =
                    parse_root_geometry_with_exclusions(&geometry, exclusions, request.limits);
            }
            let prepared = self
                .engine
                .prepare_update_with_shaper(&mut self.shaper, request, self.step + 1)
                .unwrap_or_else(|error| panic!("{label}: preparation failed: {error:?}"));
            let view = self.engine.prepared_plan(prepared).unwrap();
            let replace = !view.buffers.is_empty() || !view.draws.is_empty();
            self.host.accept(view, replace);
            self.engine.commit_update(prepared).unwrap();
            self.step += 1;
            self.assert_equivalent(&label);
        }

        fn assert_equivalent(&mut self, label: &str) {
            let fresh = fresh_gather(&mut self.engine);
            let expected = project_rows(&self.engine);
            let fresh_view = fresh.view();
            let fresh_input = fresh_view.plan_input();
            let warm_view = self.engine.gather.view();
            let warm_input = warm_view.plan_input();
            for (name, actual) in [("fresh", fresh_input), ("retained", warm_input)] {
                assert_eq!(
                    actual.glyphs.len(),
                    expected.glyphs.len(),
                    "{label}: {name} record count"
                );
                for (index, (actual, expected)) in
                    actual.glyphs.iter().zip(&expected.glyphs).enumerate()
                {
                    assert_ne!(actual.content_revision, 0, "{label}: {name} revision {index}");
                    assert_eq!(
                        PlanGlyph {
                            content_revision: 0,
                            ..*actual
                        },
                        *expected,
                        "{label}: {name} record {index}"
                    );
                }
                assert_eq!(
                    actual.placement_slots, expected.slots,
                    "{label}: {name} placement slots"
                );
                assert_eq!(actual.f32_fields.len(), expected.f32_fields.len());
                assert_eq!(actual.u32_fields.len(), expected.u32_fields.len());
                for (field, (actual, expected)) in
                    actual.f32_fields.iter().zip(&expected.f32_fields).enumerate()
                {
                    let actual: Vec<u32> = actual.iter().map(|value| value.to_bits()).collect();
                    assert_eq!(&actual, expected, "{label}: {name} f32 input {field}");
                }
                for (field, (actual, expected)) in
                    actual.u32_fields.iter().zip(&expected.u32_fields).enumerate()
                {
                    assert_eq!(*actual, expected, "{label}: {name} u32 input {field}");
                }
            }

            // The host holds only what the published patches wrote. A fresh compilation of
            // the fresh gather is what a host that had never seen this root would hold.
            let codec = self.engine.codecs.get(&9).unwrap();
            let mut compiler = RenderPlanCompiler::default();
            compiler
                .prepare(codec, CAPABILITY, fresh_input, true, 1, 0)
                .unwrap();
            let mut oracle = TestHost::default();
            oracle.accept(
                compiler
                    .plan_view(9, CAPABILITY, codec.fingerprint())
                    .unwrap(),
                true,
            );
            // Storage batches keep the order their history gave them, so buffers are paired
            // by schema and content rather than by position.
            let buffers = |host: &TestHost| {
                let snapshot = host.snapshot();
                let mut buffers: Vec<_> = snapshot
                    .bindings
                    .iter()
                    .zip(snapshot.active_bytes)
                    .map(|(binding, bytes)| {
                        (
                            binding.codec_buffer_id,
                            binding.scalar_type,
                            binding.vector_width,
                            binding.live_records,
                            bytes,
                        )
                    })
                    .collect();
                buffers.sort();
                let mut resources: Vec<_> = snapshot
                    .resources
                    .iter()
                    .map(|resource| alloc::format!("{resource:?}"))
                    .collect();
                resources.sort();
                (
                    buffers,
                    resources,
                    snapshot.primitives.len(),
                    snapshot.draws.len(),
                )
            };
            let (applied, cold) = (buffers(&self.host), buffers(&oracle));
            assert_eq!(applied.0.len(), cold.0.len(), "{label}: buffer count");
            for (applied, cold) in applied.0.iter().zip(&cold.0) {
                assert_eq!(applied, cold, "{label}: applied buffer bytes");
            }
            assert_eq!(applied.1, cold.1, "{label}: resources");
            assert_eq!(applied.2, cold.2, "{label}: primitive spans");
            assert_eq!(applied.3, cold.3, "{label}: draws");
        }
    }

    fn fresh_gather(engine: &mut TextEngine) -> CodecGatherWorkspace {
        let codec = engine.codecs.get(&9).unwrap();
        let planner = engine.planners.get_mut(&4).unwrap();
        let count = planner
            .active_order()
            .iter()
            .map(|order| {
                planner
                    .paragraph(order.id)
                    .unwrap()
                    .state
                    .active_outlined_count()
            })
            .sum();
        let ranges: Vec<_> = planner
            .paragraphs
            .iter()
            .map(|paragraph| paragraph.gather_range)
            .collect();
        let mut fresh = CodecGatherWorkspace::default();
        fresh.begin(codec, count).unwrap();
        append_planner_gather(
            &mut fresh,
            planner,
            codec,
            CAPABILITY,
            &engine.font_bindings,
            false,
            false,
            false,
        )
        .unwrap();
        for (paragraph, range) in planner.paragraphs.iter_mut().zip(ranges) {
            paragraph.gather_range = range;
        }
        fresh
    }

    #[derive(Default)]
    struct ExpectedGather {
        glyphs: Vec<PlanGlyph>,
        slots: Vec<u32>,
        f32_fields: Vec<Vec<u32>>,
        u32_fields: Vec<Vec<u32>>,
    }

    /// The row-major projection the column gather replaced: one canonical projected row per
    /// outlined glyph, every declared input read from that row or from the binding tables.
    fn project_rows(engine: &TextEngine) -> ExpectedGather {
        let codec = engine.codecs.get(&9).unwrap();
        let planner = engine.planners.get(&4).unwrap();
        let program = &codec.programs()[0];
        let mut expected = ExpectedGather {
            f32_fields: vec![Vec::new(); usize::from(program.f32_input_count)],
            u32_fields: vec![Vec::new(); usize::from(program.u32_input_count)],
            ..ExpectedGather::default()
        };
        for order in planner.active_order() {
            let paragraph = planner.paragraph(order.id).unwrap();
            let styles = paragraph.state.styles.active().resolved.segments();
            let mut push = |row: ProjectedSourceRow<'_>, translation: SegmentTranslation| {
                push_expected_row(engine, &mut expected, program, order.id, row, translation);
            };
            if let Some(leaf) = paragraph.state.active_inline() {
                for source in leaf.outlined_sources() {
                    let segment = leaf.row(source).unwrap().semantic.placement_segment as usize;
                    let slot = leaf.placement_handle(segment).unwrap().slot().get();
                    push(
                        leaf.projected_source_row(source, source, slot, styles)
                            .unwrap(),
                        leaf.placement_translations()[segment],
                    );
                }
                continue;
            }
            let positioned = paragraph.state.positioned.active();
            let clusters = paragraph.state.clusters.active();
            let boundary = paragraph.state.visible_boundary_shape();
            let context = PositionedSourceContext { styles, clusters };
            let mut cursor = positioned.outlined_cursor(clusters, boundary);
            while let Some(mark) = cursor.next_mark().unwrap() {
                let occurrence = positioned
                    .project_outlined_mark(mark, clusters, boundary)
                    .unwrap();
                let segment = occurrence.semantic.placement_segment as usize;
                let slot = positioned.placement_handle(segment).unwrap().slot().get();
                push(
                    positioned
                        .projected_occurrence_row(occurrence, mark.semantic_index, slot, context)
                        .unwrap(),
                    positioned.placement_translations()[segment],
                );
            }
        }
        expected
    }

    fn push_expected_row(
        engine: &TextEngine,
        expected: &mut ExpectedGather,
        program: &ProgramDescriptor,
        transform_id: u32,
        row: ProjectedSourceRow<'_>,
        translation: SegmentTranslation,
    ) {
        let glyph = row.glyph;
        let binding = &engine
            .font_bindings
            .iter()
            .find(|binding| binding.handle == glyph.binding_handle)
            .unwrap()
            .binding;
        let Some(selected) = binding.select(glyph.glyph_id, glyph.font_size, glyph.raster_pixel_ratio)
        else {
            return;
        };
        let resource = binding.resources()[selected.resource as usize];
        expected.glyphs.push(PlanGlyph {
            stable_id: glyph.stable_id,
            content_revision: 0,
            technique: binding.technique(),
            program_variant: binding.program_variant(),
            resource_id: resource.id,
            resource_generation: resource.generation,
            resource_kind: resource.kind,
            resource_reference: resource.reference,
            semantic_id: row.semantic.cluster,
            transform_id,
            material_id: glyph.material_id,
            clip_id: glyph.clip_id,
            depth_key: glyph.depth_key,
            inline_start: row.semantic.ink_inline_start + translation.translation_inline as f32,
            block_start: row.semantic.ink_block_start + translation.translation_block as f32,
            inline_extent: glyph.inline_extent,
            block_extent: glyph.block_extent,
        });
        expected.slots.push(glyph.placement_slot);
        let f32_count = usize::from(program.f32_input_count);
        for (field, source) in program.inputs[..f32_count].iter().enumerate() {
            let table = match source.scope {
                InputScope::Semantic => {
                    expected.f32_fields[field].push(semantic_f32(source.field, row).to_bits());
                    continue;
                }
                InputScope::Glyph => (binding.glyph_f32(), glyph.glyph_id),
                InputScope::Strike => (binding.strike_f32(), selected.strike_row),
                InputScope::Resource => (binding.resource_f32(), selected.resource),
            };
            expected.f32_fields[field]
                .push(table.0.field(source.field).unwrap()[table.1 as usize].to_bits());
        }
        for (field, source) in program.inputs[f32_count..].iter().enumerate() {
            let table = match source.scope {
                InputScope::Semantic => {
                    expected.u32_fields[field].push(if source.field == SEMANTIC_U32_PLACEMENT_SLOT {
                        glyph.placement_slot
                    } else {
                        row.u32(usize::from(source.field)).unwrap()
                    });
                    continue;
                }
                InputScope::Glyph => (binding.glyph_u32(), glyph.glyph_id),
                InputScope::Strike => (binding.strike_u32(), selected.strike_row),
                InputScope::Resource => (binding.resource_u32(), selected.resource),
            };
            expected.u32_fields[field].push(table.0.field(source.field).unwrap()[table.1 as usize]);
        }
    }

    fn semantic_f32(field: u8, row: ProjectedSourceRow<'_>) -> f32 {
        let foreground = || row.u32(0).unwrap();
        let linear = |shift: u32| srgb8_to_linear(((foreground() >> shift) & 0xff) as u8);
        match field {
            SEMANTIC_F32_INLINE_ORIGIN => row.glyph.inline_start,
            SEMANTIC_F32_BLOCK_ORIGIN => row.glyph.block_start,
            SEMANTIC_F32_INVERSE_FONT_SIZE => 1.0 / row.glyph.font_size,
            SEMANTIC_F32_OUTLINE_WIDTH_EM => row.f32(6).unwrap(),
            SEMANTIC_F32_SHADOW_OFFSET_X_EM => row.f32(7).unwrap(),
            SEMANTIC_F32_SHADOW_OFFSET_Y_EM => row.f32(8).unwrap(),
            SEMANTIC_F32_FOREGROUND_RED => linear(0),
            SEMANTIC_F32_FOREGROUND_GREEN => linear(8),
            SEMANTIC_F32_FOREGROUND_BLUE => linear(16),
            SEMANTIC_F32_FOREGROUND_ALPHA => (f64::from(foreground() >> 24) / 255.0) as f32,
            field => row.f32(usize::from(field)).unwrap(),
        }
    }

    /// One random change of one class. Every class leaves the text non-empty.
    fn random_change(fixture: &mut Fixture, random: &mut Random) -> (Change, &'static str) {
        let styled = Change {
            styles: true,
            ..Change::default()
        };
        let spans = fixture.styles.len() > 1;
        match random.below(if fixture.scenario.inline { 9 } else { 14 }) {
            0 => {
                fixture.styles[0].font_size = Some(random.pick(&[11.0, 14.0, 16.0, 19.5, 24.0, 33.0]));
                (styled, "font size")
            }
            1 => {
                fixture.styles[0].foreground = Some(random.next().wrapping_mul(0x0101_0101) | 0xff);
                (styled, "colour")
            }
            2 => {
                fixture.styles[0].line_height = Some(random.pick(&[1.0, 1.2, 1.45, 1.8]));
                (styled, "line height")
            }
            3 => {
                fixture.styles[0].letter_spacing = Some(random.pick(&[0.0, 0.5, 1.25]));
                (styled, "letter spacing")
            }
            4 => {
                fixture.styles[0].ratio = Some(random.pick(&[1.0, 2.0]));
                (styled, "raster pixel ratio")
            }
            5 => {
                fixture.styles[0].opacity = Some(random.pick(&[1.0, 0.5, 0.25]));
                fixture.styles[0].outline = Some((random.next() | 0xff00_0000, random.pick(&[0.0, 1.5])));
                fixture.styles[0].shadow = random
                    .pick(&[None, Some((0x8000_0000, 1.0, -2.0))]);
                (styled, "opacity and effects")
            }
            6 => {
                let position = random.below(fixture.text.len());
                let unit = random.pick(&fixture.alphabet);
                (
                    Change {
                        text: Some((position as u32, 1, vec![unit])),
                        ..Change::default()
                    },
                    "one-unit replacement",
                )
            }
            7 => {
                let position = random.below(fixture.text.len() + 1);
                let mut insert: Vec<u16> = (0..1 + random.below(3))
                    .map(|_| random.pick(&fixture.alphabet))
                    .collect();
                if random.below(3) == 0 {
                    insert.push(u16::from(b' '));
                }
                (
                    Change {
                        text: Some((position as u32, 0, insert)),
                        ..Change::default()
                    },
                    "insertion",
                )
            }
            8 => {
                let count = (1 + random.below(3)).min(fixture.text.len().saturating_sub(4));
                let position = random.below(fixture.text.len() - count + 1);
                (
                    Change {
                        text: Some((position as u32, count as u32, Vec::new())),
                        ..Change::default()
                    },
                    "deletion",
                )
            }
            9 => {
                fixture.width = random.pick(&[90.0, 140.0, 200.0, 260.0, 380.0]);
                fixture.geometry_revision += 1;
                (
                    Change {
                        geometry: true,
                        ..Change::default()
                    },
                    "width",
                )
            }
            10 if spans => {
                fixture.styles[1].foreground = Some(random.next() | 0xff00_0000);
                fixture.styles[1].opacity = Some(random.pick(&[1.0, 0.75]));
                (styled, "span colour")
            }
            11 if spans && !fixture.scenario.unit_boundaries => {
                fixture.styles[2].font_size = Some(random.pick(&[12.0, 18.0, 22.0, 30.0]));
                (styled, "span font size")
            }
            12 if spans => (styled, "span ranges"),
            _ => (Change::default(), "no change"),
        }
    }

    #[test]
    fn seeded_changes_keep_retained_fresh_and_row_projection_equal() {
        crate::engine::work_attribution::reset();
        for scenario in SCENARIOS {
            for seed in 1..=3_u32 {
                let mut fixture = Fixture::new(*scenario);
                let mut random = Random(seed.wrapping_mul(0x9e37_79b9));
                for _ in 0..28 {
                    let (change, label) = random_change(&mut fixture, &mut random);
                    fixture.publish(change, &alloc::format!("seed {seed}, {label}"));
                }
            }
        }
        // The comparison is only a proof of the paths the seeds reached. One paragraph per
        // root never splices an envelope between owners; the multi-owner tests cover that.
        let work = crate::engine::work_attribution::snapshot();
        assert!(work.prepare_retained_sparse_modes > 0, "retained column diff");
        assert!(work.prepare_retained_replacement_modes > 0, "count-changing replacement");
        assert!(work.prepare_fresh_modes > 0, "write-only gather");
        assert!(work.gather_projected_register_compares > 0, "lane compare");
        assert!(work.gather_identity_mismatches > 0, "identity replaced in place");
        assert!(work.fresh_recordless_rows > 0, "recordless source rows");
    }
}
