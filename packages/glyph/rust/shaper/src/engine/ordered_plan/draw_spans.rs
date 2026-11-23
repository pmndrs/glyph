//! Draw spans: reducing batch blocks into draw calls, reusing the previous plan's spans where clean.

use super::*;

impl OrderedPlanCompiler {
    pub(super) fn compile_draw_spans(
        &mut self,
        context: PrepareContext<'_>,
        reuse_clean_spans: bool,
    ) -> Result<(), OrderedPlanError> {
        let independent = context.input.order_independent;
        let changed_intervals = context.changed_intervals.unwrap_or(&[]);
        let reuse_blocks = independent && reuse_clean_spans;
        // A changed row dirties the sole old span, leaving no old primitive to reuse.
        let reuse_clean_spans = reuse_clean_spans
            && (!independent || changed_intervals.is_empty() || self.live_primitives.len() > 1);
        if reuse_blocks {
            self.sort_dirty_draw_keys(changed_intervals)?;
        }
        let mut walk = DrawSpanWalk::new(
            DrawSpanTables {
                glyphs: context.input.glyphs,
                changed_intervals,
                pending_batches: &self.pending_batches,
                pending_instances: &self.pending_instances,
                live_primitives: &self.live_primitives,
                dirty_keys: &self.sort_pairs,
                blocks: &self.blocks,
                input_batches: &self.input_batches,
                input_slots: &self.input_slots,
            },
            independent,
            reuse_clean_spans,
            reuse_blocks,
        );
        while let Some(start) = walk.next_span_start()? {
            let first = context.input.glyphs[start.first_input];
            let program = context
                .codec
                .program(
                    context.capability_set,
                    first.technique,
                    first.program_variant,
                )
                .ok_or(OrderedPlanError::ProgramMissing)?;
            let head = walk.head(start, first, program.draw_key_mask);
            walk.align_reuse_cursors(&head);
            let span = match walk.reusable_old_span(&head) {
                Some((old, end)) => {
                    walk.reuse_old_span(&head, old, end, &mut self.pending_blocks)?
                }
                None => walk.reduce_new_span(&head, &mut self.pending_blocks)?,
            };
            let resource_start = if program.primitive_kind == PRIMITIVE_DECORATION {
                0
            } else {
                self.resources
                    .iter()
                    .position(|resource| {
                        resource.id == first.resource_id
                            && resource.generation == first.resource_generation
                    })
                    .ok_or(OrderedPlanError::InvalidResource)?
            };
            push_glyph_draw(
                &mut self.primitives,
                &mut self.draws,
                GlyphDraw {
                    glyph: first,
                    primitive_kind: program.primitive_kind,
                    record_count: span.count,
                    buffer_id: head.batch.buffer_ids[0],
                    record_index: head.first_slot,
                    logical_order: head.first_input,
                    semantic_id: span.semantic_id,
                    inline_start: span.inline_start,
                    block_start: span.block_start,
                    inline_extent: span.inline_extent,
                    block_extent: span.block_extent,
                    material_id: if head.split_material {
                        first.material_id
                    } else {
                        0
                    },
                    transform_id: if head.split_transform {
                        first.transform_id
                    } else {
                        0
                    },
                    buffer_start: head.batch.state.buffer_start,
                    buffer_count: u32::from(head.batch.state.buffer_count),
                    resource_start,
                    program_id: head.batch.state.key.program_id,
                },
            )?;
            walk.finish_span(span.end);
        }
        if independent {
            self.sort_pairs.clear();
            reserve(&mut self.sort_pairs, self.draws.len())?;
            for (index, draw) in self.draws.iter().enumerate() {
                self.sort_pairs
                    .push((independent_draw_sort_key(draw), index as u32));
            }
            sort::sort_pairs(&mut self.sort_pairs);
            sort::apply_pair_order(&mut self.draws, &mut self.sort_pairs);
        }
        Ok(())
    }

    /// Sorts the physical `(batch, slot)` keys of every changed input so the
    /// physical draw walk can test a span or block for dirt with one cursor.
    pub(super) fn sort_dirty_draw_keys(
        &mut self,
        changed_intervals: &[Range<usize>],
    ) -> Result<(), OrderedPlanError> {
        let dirty_count = changed_intervals
            .iter()
            .try_fold(0_usize, |total, interval| {
                total.checked_add(interval.end - interval.start)
            })
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        self.sort_pairs.clear();
        reserve(&mut self.sort_pairs, dirty_count)?;
        for interval in changed_intervals {
            for input_index in interval.clone() {
                let batch = self.input_batches[input_index];
                self.sort_pairs
                    .push((sort::pack2(batch, self.input_slots[input_index]), 0));
            }
        }
        sort::sort_pairs(&mut self.sort_pairs);
        Ok(())
    }
}

/// The compiler tables a draw-span walk reads while it emits draws.
#[derive(Clone, Copy)]
pub(super) struct DrawSpanTables<'a> {
    pub(super) glyphs: &'a [OrderedGlyph],
    pub(super) changed_intervals: &'a [Range<usize>],
    pub(super) pending_batches: &'a [PendingBatch],
    pub(super) pending_instances: &'a RetainedRope<InstanceState>,
    pub(super) live_primitives: &'a [PrimitiveRecord],
    /// Sorted physical keys of changed inputs, when blocks are reused.
    pub(super) dirty_keys: &'a [(u64, u32)],
    pub(super) blocks: &'a [DrawBlock],
    pub(super) input_batches: &'a [u32],
    pub(super) input_slots: &'a [u32],
}
impl DrawSpanTables<'_> {
    /// Whether logical row `next` joins the draw that starts at `head`.
    pub(super) fn same_draw_span(&self, head: &DrawSpanHead, next: usize) -> bool {
        draw_span_compatible(
            head.first,
            self.glyphs[next],
            self.input_batches[next] as usize == head.batch_index,
            self.input_slots[next] == head.first_slot + (next - head.first_input) as u32,
            head.split_material,
            head.split_transform,
        )
    }
}

/// Where the next draw starts: its first input, its batch, and its first slot.
/// `start` is the physical slot (order-independent) or logical index.
#[derive(Clone, Copy)]
pub(super) struct DrawSpanStart {
    pub(super) first_input: usize,
    pub(super) batch_index: usize,
    pub(super) batch_key: u32,
    pub(super) first_slot: u32,
    pub(super) start: usize,
}

/// One draw's fixed facts while its extent is decided.
#[derive(Clone, Copy)]
pub(super) struct DrawSpanHead {
    pub(super) first_input: usize,
    pub(super) batch_index: usize,
    pub(super) batch_key: u32,
    pub(super) first_slot: u32,
    pub(super) start: usize,
    pub(super) batch: PendingBatch,
    pub(super) first: OrderedGlyph,
    /// One past the last slot or index this draw may reach.
    pub(super) limit: usize,
    pub(super) split_material: bool,
    pub(super) split_transform: bool,
}

/// The extent and bounds of one emitted draw.
pub(super) struct DrawSpanExtent {
    pub(super) end: usize,
    pub(super) count: u16,
    pub(super) semantic_id: u32,
    pub(super) inline_start: f32,
    pub(super) block_start: f32,
    pub(super) inline_extent: f32,
    pub(super) block_extent: f32,
}

/// Walks glyphs in draw order (physical slots when order-independent, logical
/// inputs otherwise), with monotone cursors into the old primitives, dirty
/// keys and cached blocks it may reuse.
pub(super) struct DrawSpanWalk<'a> {
    pub(super) tables: DrawSpanTables<'a>,
    pub(super) independent: bool,
    pub(super) reuse_clean_spans: bool,
    pub(super) reuse_blocks: bool,
    pub(super) logical_index: usize,
    pub(super) physical_batch: usize,
    pub(super) physical_slot: usize,
    pub(super) physical_cursor: Option<RopeCursor<'a, InstanceState>>,
    pub(super) old_index: usize,
    pub(super) old_physical_batch: Option<usize>,
    pub(super) dirty_index: usize,
    pub(super) block_index: usize,
}

/// Folds `next` into the running summary of a draw.
pub(super) fn fold_draw_summary(summary: &mut Option<DrawSpanSummary>, next: DrawSpanSummary) {
    if let Some(total) = summary {
        total.combine(next);
    } else {
        *summary = Some(next);
    }
}

/// Adds one glyph to the running summary of a draw.
pub(super) fn push_draw_summary(summary: &mut Option<DrawSpanSummary>, glyph: OrderedGlyph) {
    if let Some(total) = summary {
        total.push(glyph);
    } else {
        *summary = Some(DrawSpanSummary::new(glyph));
    }
}
impl<'a> DrawSpanWalk<'a> {
    pub(super) fn new(
        tables: DrawSpanTables<'a>,
        independent: bool,
        reuse_clean_spans: bool,
        reuse_blocks: bool,
    ) -> Self {
        Self {
            tables,
            independent,
            reuse_clean_spans,
            reuse_blocks,
            logical_index: 0,
            physical_batch: 0,
            physical_slot: 0,
            physical_cursor: None,
            old_index: 0,
            old_physical_batch: None,
            dirty_index: 0,
            block_index: 0,
        }
    }

    pub(super) fn next_span_start(&mut self) -> Result<Option<DrawSpanStart>, OrderedPlanError> {
        let next = if self.independent {
            self.next_physical_start()?
        } else {
            self.next_logical_start()
        };
        let Some((first_input, batch_index, first_slot, start)) = next else {
            return Ok(None);
        };
        let batch_key =
            u32::try_from(batch_index).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        Ok(Some(DrawSpanStart {
            first_input,
            batch_index,
            batch_key,
            first_slot,
            start,
        }))
    }

    /// The next occupied physical slot, opening a cursor at each new batch.
    pub(super) fn next_physical_start(
        &mut self,
    ) -> Result<Option<(usize, usize, u32, usize)>, OrderedPlanError> {
        let batches = self.tables.pending_batches;
        while let Some(batch) = batches.get(self.physical_batch) {
            if self.physical_slot < batch.state.instance_count as usize {
                break;
            }
            self.physical_batch += 1;
            self.physical_slot = 0;
            self.physical_cursor = None;
        }
        let Some(batch) = batches.get(self.physical_batch) else {
            return Ok(None);
        };
        if self.physical_cursor.is_none() {
            self.physical_cursor = Some(
                self.tables
                    .pending_instances
                    .cursor_from(batch.state.instance_start as usize)
                    .ok_or(OrderedPlanError::InvalidIdentity)?,
            );
        }
        let input_index = self.peek_physical_input()?;
        let first_slot =
            u32::try_from(self.physical_slot).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        Ok(Some((
            input_index,
            self.physical_batch,
            first_slot,
            self.physical_slot,
        )))
    }

    /// The next logical input that was assigned a batch.
    pub(super) fn next_logical_start(&mut self) -> Option<(usize, usize, u32, usize)> {
        let batches = self.tables.input_batches;
        let count = self.tables.glyphs.len();
        while self.logical_index < count && batches[self.logical_index] == NONE {
            self.logical_index += 1;
        }
        let index = self.logical_index;
        (index != count).then(|| {
            (
                index,
                batches[index] as usize,
                self.tables.input_slots[index],
                index,
            )
        })
    }

    pub(super) fn peek_physical_input(&mut self) -> Result<usize, OrderedPlanError> {
        self.physical_cursor
            .as_mut()
            .and_then(|cursor| cursor.peek_record())
            .map(|instance| instance.input_index as usize)
            .ok_or(OrderedPlanError::InvalidIdentity)
    }

    pub(super) fn advance_physical(&mut self, count: usize) -> Result<(), OrderedPlanError> {
        self.physical_cursor
            .as_mut()
            .and_then(|cursor| cursor.advance(count))
            .ok_or(OrderedPlanError::InvalidIdentity)
    }

    pub(super) fn head(
        &self,
        start: DrawSpanStart,
        first: OrderedGlyph,
        draw_key_mask: u32,
    ) -> DrawSpanHead {
        let batch = self.tables.pending_batches[start.batch_index];
        DrawSpanHead {
            first_input: start.first_input,
            batch_index: start.batch_index,
            batch_key: start.batch_key,
            first_slot: start.first_slot,
            start: start.start,
            batch,
            first,
            limit: if self.independent {
                batch.state.instance_count as usize
            } else {
                self.tables.glyphs.len()
            },
            split_material: draw_key_mask & BATCH_MATERIAL != 0,
            split_transform: draw_key_mask & BATCH_TRANSFORM != 0,
        }
    }

    pub(super) fn finish_span(&mut self, end: usize) {
        if self.independent {
            self.physical_slot = end;
        } else {
            self.logical_index = end;
        }
    }

    /// Moves the old-primitive, dirty and block cursors up to this draw's first row.
    pub(super) fn align_reuse_cursors(&mut self, head: &DrawSpanHead) {
        if self.reuse_clean_spans {
            if self.independent {
                self.align_physical_reuse(head);
            } else {
                self.align_logical_reuse(head);
            }
        }
        if self.reuse_blocks {
            self.skip_blocks_before(head.batch_key, head.first_slot);
        }
    }

    pub(super) fn align_physical_reuse(&mut self, head: &DrawSpanHead) {
        if self.old_physical_batch != Some(head.batch_index) {
            if let Some(previous_batch) = self.old_physical_batch {
                let previous_buffer = self.tables.pending_batches[previous_batch].buffer_ids[0];
                self.skip_old_while(|old| old.buffer_id == previous_buffer);
            }
            self.old_physical_batch = Some(head.batch_index);
        }
        let buffer = head.batch.buffer_ids[0];
        let first_slot = head.first_slot;
        self.skip_old_while(|old| old.buffer_id == buffer && old.record_index < first_slot);
        self.skip_dirty_keys_before(sort::pack2(head.batch_key, head.first_slot));
    }

    pub(super) fn align_logical_reuse(&mut self, head: &DrawSpanHead) {
        let first_input = head.first_input;
        self.skip_old_while(|old| (old.logical_order as usize) < first_input);
        while self
            .tables
            .changed_intervals
            .get(self.dirty_index)
            .is_some_and(|interval| interval.end <= first_input)
        {
            self.dirty_index += 1;
        }
    }

    pub(super) fn skip_old_while(&mut self, skip: impl Fn(&PrimitiveRecord) -> bool) {
        while self
            .tables
            .live_primitives
            .get(self.old_index)
            .is_some_and(&skip)
        {
            self.old_index += 1;
        }
    }

    pub(super) fn skip_dirty_keys_before(&mut self, key: u64) {
        while self
            .tables
            .dirty_keys
            .get(self.dirty_index)
            .is_some_and(|pair| pair.0 < key)
        {
            self.dirty_index += 1;
        }
    }

    pub(super) fn skip_blocks_before(&mut self, batch: u32, slot: u32) {
        while self
            .tables
            .blocks
            .get(self.block_index)
            .is_some_and(|block| (block.batch, block.slot) < (batch, slot))
        {
            self.block_index += 1;
        }
    }

    /// The old primitive at this draw's first row and its end, when it is still
    /// one clean draw that ends exactly where a new walk would split.
    pub(super) fn reusable_old_span(
        &mut self,
        head: &DrawSpanHead,
    ) -> Option<(&'a PrimitiveRecord, usize)> {
        if !self.reuse_clean_spans {
            return None;
        }
        let old = self.tables.live_primitives.get(self.old_index)?;
        let count = usize::from(old.record_count);
        let end = head.start.checked_add(count)?;
        if count == 0
            || end > head.limit
            || old.record_index != head.first_slot
            || old.buffer_id != head.batch.buffer_ids[0]
            || old.logical_order as usize != head.first_input
        {
            return None;
        }
        if !self.rows_clean_until(head, end)? {
            return None;
        }
        let split_at_end = end == head.limit
            || count == usize::from(u16::MAX)
            || !self.draw_continues_past(head, count, end)?;
        split_at_end.then_some((old, end))
    }

    pub(super) fn rows_clean_until(&self, head: &DrawSpanHead, end: usize) -> Option<bool> {
        Some(if self.independent {
            let end_key = sort::pack2(head.batch_key, u32::try_from(end).ok()?);
            self.tables
                .dirty_keys
                .get(self.dirty_index)
                .is_none_or(|pair| pair.0 >= end_key)
        } else {
            self.tables
                .changed_intervals
                .get(self.dirty_index)
                .is_none_or(|interval| interval.start >= end)
        })
    }

    /// Whether the row after the first `count` rows (at `end`) would join this draw.
    pub(super) fn draw_continues_past(
        &mut self,
        head: &DrawSpanHead,
        count: usize,
        end: usize,
    ) -> Option<bool> {
        if !self.independent {
            return Some(self.tables.same_draw_span(head, end));
        }
        let next = self
            .physical_cursor
            .as_mut()
            .and_then(|cursor| cursor.peek(count + 1))
            .and_then(|range| range.last())?;
        let next_glyph = self.tables.glyphs[next.input_index as usize];
        Some(draw_fields_compatible(
            head.first,
            next_glyph,
            head.split_material,
            head.split_transform,
        ))
    }

    pub(super) fn reuse_old_span(
        &mut self,
        head: &DrawSpanHead,
        old: &PrimitiveRecord,
        end: usize,
        pending_blocks: &mut Vec<DrawBlock>,
    ) -> Result<DrawSpanExtent, OrderedPlanError> {
        if self.independent && self.reuse_blocks {
            while let Some(block) = self.tables.blocks.get(self.block_index).copied() {
                if block.batch != head.batch_key || block.slot as usize + DRAW_BLOCK_SLOTS > end {
                    break;
                }
                reserve(pending_blocks, 1)?;
                pending_blocks.push(block);
                self.block_index += 1;
            }
        }
        if self.independent {
            self.advance_physical(usize::from(old.record_count))?;
        }
        Ok(DrawSpanExtent {
            end,
            count: old.record_count,
            semantic_id: old.semantic_id,
            inline_start: old.inline_start,
            block_start: old.block_start,
            inline_extent: old.inline_extent,
            block_extent: old.block_extent,
        })
    }

    pub(super) fn row_joins_draw(
        &self,
        head: &DrawSpanHead,
        next: OrderedGlyph,
        end: usize,
    ) -> bool {
        if self.independent {
            draw_fields_compatible(head.first, next, head.split_material, head.split_transform)
        } else {
            self.tables.same_draw_span(head, end)
        }
    }

    /// Extends a new draw row by row, folding clean cached blocks whole and
    /// caching every aligned block it reduces.
    pub(super) fn reduce_new_span(
        &mut self,
        head: &DrawSpanHead,
        pending_blocks: &mut Vec<DrawBlock>,
    ) -> Result<DrawSpanExtent, OrderedPlanError> {
        let start = head.start;
        let mut summary: Option<DrawSpanSummary> = None;
        let mut building: Option<(u32, DrawSpanSummary)> = None;
        let mut end = start;
        while end < head.limit && end - start < usize::from(u16::MAX) {
            let next_input = if self.independent {
                self.peek_physical_input()?
            } else {
                end
            };
            let next = self.tables.glyphs[next_input];
            if end != start && !self.row_joins_draw(head, next, end) {
                break;
            }

            // Only a whole aligned physical block inside this draw can be represented.
            let full_block_fits = self.independent
                && building.is_none()
                && end.is_multiple_of(DRAW_BLOCK_SLOTS)
                && end.checked_add(DRAW_BLOCK_SLOTS).is_some_and(|next_end| {
                    next_end <= head.limit && next_end - start <= usize::from(u16::MAX)
                });
            if full_block_fits
                && self.reuse_blocks
                && let Some(block) = self.clean_cached_block(head, end)?
            {
                fold_draw_summary(&mut summary, block.summary);
                reserve(pending_blocks, 1)?;
                pending_blocks.push(block);
                self.advance_physical(DRAW_BLOCK_SLOTS)?;
                end += DRAW_BLOCK_SLOTS;
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.draw_folded_blocks += 1;
                });
                continue;
            }

            if full_block_fits {
                building = Some((
                    u32::try_from(end).map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
                    DrawSpanSummary::new(next),
                ));
            } else if let Some((_, block_summary)) = &mut building {
                block_summary.push(next);
            } else {
                push_draw_summary(&mut summary, next);
            }
            if self.independent {
                self.physical_cursor
                    .as_mut()
                    .and_then(|cursor| cursor.next_record())
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
            }
            end += 1;
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.draw_reduced_glyphs += 1;
            });
            if let Some((block_slot, block_summary)) = building
                && end - block_slot as usize == DRAW_BLOCK_SLOTS
            {
                fold_draw_summary(&mut summary, block_summary);
                reserve(pending_blocks, 1)?;
                pending_blocks.push(DrawBlock {
                    batch: head.batch_key,
                    slot: block_slot,
                    summary: block_summary,
                });
                building = None;
            }
        }
        if let Some((_, partial)) = building {
            fold_draw_summary(&mut summary, partial);
        }
        let mut summary = summary.ok_or(OrderedPlanError::InvalidIdentity)?;
        if self.independent && summary.needs_sequential_replay() {
            summary = self.replay_summary(head, end, summary)?;
        }
        let count = u16::try_from(end - start).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        let (inline_start, block_start, inline_extent, block_extent) = summary.bounds()?;
        Ok(DrawSpanExtent {
            end,
            count,
            semantic_id: summary.semantic_id,
            inline_start,
            block_start,
            inline_extent,
            block_extent,
        })
    }

    /// The cached block at physical slot `end`, when no changed input falls inside it.
    /// The old table is read only under exact retained topology and scope, and the
    /// current first row already passed compatibility, so a clean block keeps its
    /// cached first key.
    pub(super) fn clean_cached_block(
        &mut self,
        head: &DrawSpanHead,
        end: usize,
    ) -> Result<Option<DrawBlock>, OrderedPlanError> {
        let block_slot = u32::try_from(end).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        let block_end = sort::pack2(head.batch_key, block_slot + DRAW_BLOCK_SLOTS as u32);
        self.skip_dirty_keys_before(sort::pack2(head.batch_key, block_slot));
        self.skip_blocks_before(head.batch_key, block_slot);
        let clean = self
            .tables
            .dirty_keys
            .get(self.dirty_index)
            .is_none_or(|pair| pair.0 >= block_end);
        Ok(self
            .tables
            .blocks
            .get(self.block_index)
            .copied()
            .filter(|block| clean && (block.batch, block.slot) == (head.batch_key, block_slot)))
    }

    /// Re-reduces `start..end` one glyph at a time, preserving the old reduction
    /// order and error behavior for adverse floats.
    pub(super) fn replay_summary(
        &self,
        head: &DrawSpanHead,
        end: usize,
        folded: DrawSpanSummary,
    ) -> Result<DrawSpanSummary, OrderedPlanError> {
        let mut replay_cursor = self
            .tables
            .pending_instances
            .cursor_from(head.batch.state.instance_start as usize + head.start)
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        let mut summary = None;
        for _ in head.start..end {
            let input_index = replay_cursor
                .next_record()
                .map(|instance| instance.input_index as usize)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            push_draw_summary(&mut summary, self.tables.glyphs[input_index]);
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.draw_reduced_glyphs += 1;
            });
        }
        Ok(summary.unwrap_or(folded))
    }
}
