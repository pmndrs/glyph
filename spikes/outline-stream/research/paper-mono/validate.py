# /// script
# requires-python = ">=3.12"
# dependencies = ["fonttools==4.59.2"]
# ///
"""Correctness probe for Paper Mono in the proposed dynamic outline stream.

The font is encoded once as TrueType-model base points plus sparse gvar tuples. Every location is then decoded from
that same representation. HarfBuzz-subset and fontTools instances are oracle outputs only; they are never serialized
back into the candidate stream.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import struct
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import fontTools
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import (
    ROUND_XY_TO_GRID,
    SCALED_COMPONENT_OFFSET,
    UNSCALED_COMPONENT_OFFSET,
    USE_MY_METRICS,
)
from fontTools.varLib.instancer import instantiateVariableFont


SOURCE_COMMIT = "e6eaeceaef02e77e3db997711e07a16378de2bd7"
SOURCE_SHA256 = "43369c40e211aab9dda29464b0d715c9f20d90118626a56659607108c9c03dfe"
SOURCE_URL = (
    "https://github.com/paper-design/paper-mono/blob/"
    f"{SOURCE_COMMIT}/fonts/variable/PaperMono%5Bwght%5D.ttf"
)
SS02_BASE = ["AE", "M", "OE", "W", "Wacute", "Wcircumflex", "Wdieresis", "Wgrave",
             "ae", "m", "oe", "w", "wacute", "wcircumflex", "wdieresis", "wgrave"]
SS02_TEXT = "ÆMŒWẂŴẄẀæmœwẃŵẅẁ"
BAND_COUNT = 16
BAND_EPSILON = 1.0 / 1024.0
AXIS_EPSILON = 1.0e-10
LINE_EPSILON_FONT_UNITS = 0.125


def ot_round(value: float) -> int:
    return math.floor(value + 0.5)


def f32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


def f2dot14(value: float) -> int:
    return max(-32768, min(32767, ot_round(value * 16384.0)))


def fixed16(value: float) -> int:
    return ot_round(value * 65536.0)


def encode_varint(value: int) -> bytes:
    if value < 0:
        raise ValueError("varint input must be nonnegative")
    output = bytearray()
    while value >= 0x80:
        output.append((value & 0x7F) | 0x80)
        value >>= 7
    output.append(value)
    return bytes(output)


def decode_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, offset
        shift += 7


def zigzag(value: int) -> int:
    return (value << 1) ^ (value >> 31)


def unzigzag(value: int) -> int:
    return (value >> 1) ^ -(value & 1)


def encode_triplet(x: int, y: int, zero_flag: bool = False) -> tuple[int, bytes]:
    ax, ay = abs(x), abs(y)
    sx, sy = int(x < 0), int(y < 0)
    if zero_flag and x == 0 and y == 0:
        return 0x80, b""
    if x == 0 and ay < 1280:
        return ((ay >> 8) << 1) | sy, bytes([ay & 0xFF])
    if y == 0 and ax < 1280:
        return 10 + ((ax >> 8) << 1 | sx), bytes([ax & 0xFF])
    if 1 <= ax <= 64 and 1 <= ay <= 64:
        a, b = ax - 1, ay - 1
        flag = 20 + (a >> 4 << 4) + (b >> 4 << 2) + (sx << 1 | sy)
        return flag, bytes([(a & 15) << 4 | (b & 15)])
    if 1 <= ax <= 768 and 1 <= ay <= 768:
        a, b = ax - 1, ay - 1
        flag = 84 + 12 * (a >> 8) + (b >> 8 << 2) + (sx << 1 | sy)
        return flag, bytes([a & 0xFF, b & 0xFF])
    if ax < 4096 and ay < 4096:
        return 120 + (sx << 1 | sy), bytes([ax >> 4, (ax & 15) << 4 | ay >> 8, ay & 0xFF])
    if ax >= 65536 or ay >= 65536:
        raise ValueError(f"triplet magnitude exceeds 16 bits: {(x, y)}")
    return 124 + (sx << 1 | sy), struct.pack(">HH", ax, ay)


def decode_triplet(flag: int, data: bytes, offset: int, zero_flag: bool = False) -> tuple[int, int, int]:
    if zero_flag and flag == 0x80:
        return 0, 0, offset
    cls = flag & 0x7F
    if cls < 10:
        dy = (cls >> 1) << 8 | data[offset]
        return 0, -dy if cls & 1 else dy, offset + 1
    if cls < 20:
        code = cls - 10
        dx = (code >> 1) << 8 | data[offset]
        return -dx if code & 1 else dx, 0, offset + 1
    if cls < 84:
        code = cls - 20
        byte = data[offset]
        dx = 1 + (code & 0x30) + (byte >> 4)
        dy = 1 + ((code & 0x0C) << 2) + (byte & 15)
        return (-dx if code & 2 else dx), (-dy if code & 1 else dy), offset + 1
    if cls < 120:
        code = cls - 84
        dx = 1 + (code // 12 << 8) + data[offset]
        dy = 1 + (code % 12 >> 2 << 8) + data[offset + 1]
        return (-dx if code & 2 else dx), (-dy if code & 1 else dy), offset + 2
    if cls < 124:
        b0, b1, b2 = data[offset : offset + 3]
        dx = b0 << 4 | b1 >> 4
        dy = (b1 & 15) << 8 | b2
        return (-dx if cls & 2 else dx), (-dy if cls & 1 else dy), offset + 3
    dx, dy = struct.unpack_from(">HH", data, offset)
    return (-dx if cls & 2 else dx), (-dy if cls & 1 else dy), offset + 4


@dataclass(frozen=True)
class Component:
    glyph_id: int
    x: int
    y: int
    transform: tuple[float, float, float, float]


@dataclass
class GlyphModel:
    kind: str
    points: list[tuple[int, int]]
    tags: list[int]
    ends: list[int]
    components: list[Component]


@dataclass(frozen=True)
class Axis:
    tag: str
    minimum: float
    default: float
    maximum: float
    avar: tuple[tuple[int, int], ...]


@dataclass
class Candidate:
    names: list[str]
    models: list[GlyphModel]
    axes: list[Axis]
    regions: list[tuple[tuple[int, int, int], ...]]
    tuples: list[list[tuple[int, list[tuple[int, int] | None]]]]
    units_per_em: int
    source_component_flags: list[list[int]]
    point_matched_components: int
    phantom_nonzero_tuples: int


def source_candidate(font: TTFont) -> Candidate:
    names = font.getGlyphOrder()
    name_to_gid = {name: glyph_id for glyph_id, name in enumerate(names)}
    glyf = font["glyf"]
    models: list[GlyphModel] = []
    component_flags: list[list[int]] = []
    point_matched_components = 0
    for name in names:
        glyph = glyf[name]
        if glyph.numberOfContours == 0:
            models.append(GlyphModel("empty", [], [], [], []))
            component_flags.append([])
        elif glyph.isComposite():
            components = []
            flags = []
            for component in glyph.components:
                if not hasattr(component, "x") or not hasattr(component, "y"):
                    point_matched_components += 1
                    raise ValueError(f"point-matched component is outside this Paper probe: {name}")
                transform = tuple(float(value) for value in getattr(component, "transform", (1, 0, 0, 1)))
                components.append(Component(name_to_gid[component.glyphName], int(component.x), int(component.y), transform))
                flags.append(int(component.flags))
            models.append(GlyphModel("composite", [], [], [], components))
            component_flags.append(flags)
        else:
            models.append(
                GlyphModel(
                    "simple",
                    [(int(x), int(y)) for x, y in glyph.coordinates],
                    [0 if flag & 1 else 1 for flag in glyph.flags],
                    [int(end) for end in glyph.endPtsOfContours],
                    [],
                )
            )
            component_flags.append([])

    fvar_axes = font["fvar"].axes
    avar_segments = font["avar"].segments if "avar" in font else {}
    axes = []
    for axis in fvar_axes:
        segment = avar_segments.get(axis.axisTag, {-1.0: -1.0, 0.0: 0.0, 1.0: 1.0})
        axes.append(
            Axis(
                axis.axisTag,
                float(axis.minValue),
                float(axis.defaultValue),
                float(axis.maxValue),
                tuple((f2dot14(before), f2dot14(after)) for before, after in sorted(segment.items())),
            )
        )

    regions: list[tuple[tuple[int, int, int], ...]] = []
    region_ids: dict[tuple[tuple[int, int, int], ...], int] = {}
    tuples: list[list[tuple[int, list[tuple[int, int] | None]]]] = []
    phantom_nonzero = 0
    hmetrics = font["hmtx"].metrics
    for glyph_id, name in enumerate(names):
        model = models[glyph_id]
        varpoint_count = len(model.points) if model.kind == "simple" else len(model.components)
        glyph_tuples = []
        seen_regions = set()
        for variation in font["gvar"].variations.get(name, []):
            region = tuple(
                tuple(f2dot14(value) for value in variation.axes.get(axis.tag, (0.0, 0.0, 0.0)))
                for axis in axes
            )
            region_id = region_ids.get(region)
            if region_id is None:
                region_id = len(regions)
                region_ids[region] = region_id
                regions.append(region)
            if region_id in seen_regions:
                raise ValueError(f"glyph {name} has multiple tuples for one region")
            seen_regions.add(region_id)
            coordinates = list(variation.coordinates)
            if len(coordinates) != varpoint_count + 4:
                # Ask glyf for phantom points only to diagnose a malformed assumption.
                actual, _ = glyf._getCoordinatesAndControls(name, hmetrics, None)
                raise ValueError((name, len(coordinates), varpoint_count + 4, len(actual)))
            sparse = [None if value is None else (int(value[0]), int(value[1])) for value in coordinates[:varpoint_count]]
            phantom_nonzero += int(any(value not in (None, (0, 0)) for value in coordinates[varpoint_count:]))
            glyph_tuples.append((region_id, sparse))
        tuples.append(glyph_tuples)
    return Candidate(
        names,
        models,
        axes,
        regions,
        tuples,
        int(font["head"].unitsPerEm),
        component_flags,
        point_matched_components,
        phantom_nonzero,
    )


def encode_base(candidate: Candidate) -> dict[str, bytes]:
    header = bytearray()
    contours = bytearray()
    components = bytearray()
    flags = bytearray()
    data = bytearray()
    for model in candidate.models:
        if model.kind == "empty":
            header += encode_varint(0)
        elif model.kind == "composite":
            header += encode_varint(2 * len(model.components) + 1)
            for component in model.components:
                components += encode_varint(component.glyph_id)
                components += encode_varint(zigzag(component.x))
                components += encode_varint(zigzag(component.y))
                if component.transform == (1.0, 0.0, 0.0, 1.0):
                    components.append(0)
                else:
                    components.append(1)
                    components += struct.pack("<4h", *(f2dot14(value) for value in component.transform))
        else:
            header += encode_varint(2 * len(model.ends))
            start = 0
            for end in model.ends:
                contours += encode_varint(end - start + 1)
                start = end + 1
            previous = (0, 0)
            for (x, y), tag in zip(model.points, model.tags):
                flag, encoded = encode_triplet(x - previous[0], y - previous[1])
                flags.append(flag | tag << 7)
                data += encoded
                previous = (x, y)
    return {"hdr": bytes(header), "cn": bytes(contours), "comp": bytes(components), "flags": bytes(flags), "data": bytes(data)}


def decode_base(planes: dict[str, bytes], glyph_count: int) -> list[GlyphModel]:
    header_offset = contour_offset = component_offset = flag_offset = data_offset = 0
    output = []
    for _ in range(glyph_count):
        header, header_offset = decode_varint(planes["hdr"], header_offset)
        if header == 0:
            output.append(GlyphModel("empty", [], [], [], []))
            continue
        if header & 1:
            components = []
            for _ in range(header >> 1):
                glyph_id, component_offset = decode_varint(planes["comp"], component_offset)
                x, component_offset = decode_varint(planes["comp"], component_offset)
                y, component_offset = decode_varint(planes["comp"], component_offset)
                transform_code = planes["comp"][component_offset]
                component_offset += 1
                if transform_code == 0:
                    transform = (1.0, 0.0, 0.0, 1.0)
                elif transform_code == 1:
                    values = struct.unpack_from("<4h", planes["comp"], component_offset)
                    component_offset += 8
                    transform = tuple(value / 16384.0 for value in values)
                else:
                    raise ValueError(f"unknown component transform {transform_code}")
                components.append(Component(glyph_id, unzigzag(x), unzigzag(y), transform))
            output.append(GlyphModel("composite", [], [], [], components))
            continue
        contour_count = header >> 1
        sizes = []
        for _ in range(contour_count):
            size, contour_offset = decode_varint(planes["cn"], contour_offset)
            sizes.append(size)
        points = []
        tags = []
        previous = (0, 0)
        for _ in range(sum(sizes)):
            flag = planes["flags"][flag_offset]
            flag_offset += 1
            dx, dy, data_offset = decode_triplet(flag, planes["data"], data_offset)
            previous = (previous[0] + dx, previous[1] + dy)
            points.append(previous)
            tags.append(flag >> 7)
        total = 0
        ends = []
        for size in sizes:
            total += size
            ends.append(total - 1)
        output.append(GlyphModel("simple", points, tags, ends, []))
    consumed = {
        "hdr": header_offset,
        "cn": contour_offset,
        "comp": component_offset,
        "flags": flag_offset,
        "data": data_offset,
    }
    if any(consumed[name] != len(value) for name, value in planes.items()):
        raise ValueError(f"base decoder did not consume every plane: {consumed}")
    return output


def encode_axis_table(axes: list[Axis]) -> bytes:
    output = bytearray(encode_varint(len(axes)))
    for axis in axes:
        output += axis.tag.encode("ascii")
        output += struct.pack("<3i", fixed16(axis.minimum), fixed16(axis.default), fixed16(axis.maximum))
    for axis in axes:
        output += encode_varint(len(axis.avar))
        for before, after in axis.avar:
            output += struct.pack("<hh", before, after)
    return bytes(output)


def decode_axis_table(data: bytes) -> list[Axis]:
    count, offset = decode_varint(data, 0)
    values = []
    for _ in range(count):
        tag = data[offset : offset + 4].decode("ascii")
        minimum, default, maximum = struct.unpack_from("<3i", data, offset + 4)
        offset += 16
        values.append([tag, minimum / 65536.0, default / 65536.0, maximum / 65536.0])
    output = []
    for tag, minimum, default, maximum in values:
        length, offset = decode_varint(data, offset)
        avar = []
        for _ in range(length):
            avar.append(struct.unpack_from("<hh", data, offset))
            offset += 4
        output.append(Axis(tag, minimum, default, maximum, tuple(avar)))
    if offset != len(data):
        raise ValueError("axis decoder left trailing bytes")
    return output


def encode_region_table(regions: list[tuple[tuple[int, int, int], ...]]) -> bytes:
    output = bytearray(encode_varint(len(regions)))
    for region in regions:
        mask = sum(1 << axis for axis, (_, peak, _) in enumerate(region) if peak)
        intermediate = any(low != min(peak, 0) or high != max(peak, 0) for low, peak, high in region if peak)
        output += encode_varint(mask)
        output.append(int(intermediate))
        for low, peak, high in region:
            if not peak:
                continue
            output += struct.pack("<h", peak)
            if intermediate:
                output += struct.pack("<hh", low, high)
    return bytes(output)


def decode_region_table(data: bytes, axis_count: int) -> list[tuple[tuple[int, int, int], ...]]:
    count, offset = decode_varint(data, 0)
    output = []
    for _ in range(count):
        mask, offset = decode_varint(data, offset)
        intermediate = bool(data[offset])
        offset += 1
        region = []
        for axis in range(axis_count):
            if not mask & 1 << axis:
                region.append((0, 0, 0))
                continue
            peak = struct.unpack_from("<h", data, offset)[0]
            offset += 2
            if intermediate:
                low, high = struct.unpack_from("<hh", data, offset)
                offset += 4
            else:
                low, high = min(peak, 0), max(peak, 0)
            region.append((low, peak, high))
        output.append(tuple(region))
    if offset != len(data):
        raise ValueError("region decoder left trailing bytes")
    return output


def encode_point_set(sparse: list[tuple[int, int] | None]) -> bytes:
    indices = [index for index, value in enumerate(sparse) if value is not None]
    if len(indices) == len(sparse):
        return encode_varint(0)
    output = bytearray(encode_varint(len(indices)))
    previous = -1
    for index in indices:
        output += encode_varint(index - previous - 1)
        previous = index
    return bytes(output)


def decode_point_set(data: bytes, offset: int, point_count: int) -> tuple[list[int], int]:
    count, offset = decode_varint(data, offset)
    if count == 0:
        return list(range(point_count)), offset
    indices = []
    previous = -1
    for _ in range(count):
        gap, offset = decode_varint(data, offset)
        previous += gap + 1
        if previous >= point_count:
            raise ValueError("sparse point index exceeds glyph point count")
        indices.append(previous)
    return indices, offset


def encode_deltas(candidate: Candidate) -> dict[str, bytes]:
    glyph_count = len(candidate.models)
    bitmap_bytes = (glyph_count + 7) // 8
    presence = bytearray()
    point_sets = bytearray()
    flags = bytearray()
    data = bytearray()
    for region_id in range(len(candidate.regions)):
        bitmap = bytearray(bitmap_bytes)
        ordered = []
        for glyph_id, tuples in enumerate(candidate.tuples):
            matches = [sparse for candidate_region, sparse in tuples if candidate_region == region_id]
            if len(matches) > 1:
                raise ValueError("region-major presence cannot encode duplicate glyph-region tuples")
            if matches:
                bitmap[glyph_id // 8] |= 1 << (glyph_id & 7)
                ordered.append(matches[0])
        presence += bitmap
        for sparse in ordered:
            point_sets += encode_point_set(sparse)
            values = [value for value in sparse if value is not None]
            previous = (0, 0)
            for index, value in enumerate(values):
                predicted = value if index == 0 else (value[0] - previous[0], value[1] - previous[1])
                flag, encoded = encode_triplet(*predicted, zero_flag=True)
                flags.append(flag)
                data += encoded
                previous = value
    return {"presence": bytes(presence), "points": bytes(point_sets), "dflags": bytes(flags), "ddata": bytes(data)}


def decode_deltas(
    planes: dict[str, bytes], models: list[GlyphModel], region_count: int
) -> list[list[tuple[int, list[tuple[int, int] | None]]]]:
    glyph_count = len(models)
    bitmap_bytes = (glyph_count + 7) // 8
    output: list[list[tuple[int, list[tuple[int, int] | None]]]] = [[] for _ in models]
    point_offset = flag_offset = data_offset = 0
    for region_id in range(region_count):
        bitmap = planes["presence"][region_id * bitmap_bytes : (region_id + 1) * bitmap_bytes]
        for glyph_id, model in enumerate(models):
            if not bitmap[glyph_id // 8] & 1 << (glyph_id & 7):
                continue
            point_count = len(model.points) if model.kind == "simple" else len(model.components)
            indices, point_offset = decode_point_set(planes["points"], point_offset, point_count)
            sparse: list[tuple[int, int] | None] = [None] * point_count
            previous = (0, 0)
            for index_number, point_index in enumerate(indices):
                flag = planes["dflags"][flag_offset]
                flag_offset += 1
                dx, dy, data_offset = decode_triplet(flag, planes["ddata"], data_offset, zero_flag=True)
                value = (dx, dy) if index_number == 0 else (previous[0] + dx, previous[1] + dy)
                sparse[point_index] = value
                previous = value
            output[glyph_id].append((region_id, sparse))
    consumed = {"points": point_offset, "dflags": flag_offset, "ddata": data_offset}
    if len(planes["presence"]) != bitmap_bytes * region_count or any(
        consumed[name] != len(planes[name]) for name in consumed
    ):
        raise ValueError(f"delta decoder did not consume every plane: {consumed}")
    return output


def framed_digest(planes: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for name, data in planes.items():
        digest.update(name.encode("ascii") + b"\0" + struct.pack("<I", len(data)) + data)
    return digest.hexdigest()


def normalize(axis: Axis, user_value: float) -> tuple[float, float, int]:
    user_value = max(axis.minimum, min(axis.maximum, user_value))
    if user_value < axis.default:
        raw = -(axis.default - user_value) / (axis.default - axis.minimum)
    elif user_value > axis.default:
        raw = (user_value - axis.default) / (axis.maximum - axis.default)
    else:
        raw = 0.0
    mapping = axis.avar
    mapped = raw
    for (from_a, to_a), (from_b, to_b) in zip(mapping, mapping[1:]):
        a, b = from_a / 16384.0, from_b / 16384.0
        if a <= raw <= b:
            proportion = 0.0 if a == b else (raw - a) / (b - a)
            mapped = to_a / 16384.0 + proportion * ((to_b - to_a) / 16384.0)
            break
    normalized = f2dot14(mapped)
    return raw, normalized / 16384.0, normalized


def region_scalar(region: tuple[tuple[int, int, int], ...], normalized: list[int]) -> float:
    scalar = 1.0
    for (low_bits, peak_bits, high_bits), value_bits in zip(region, normalized):
        if peak_bits == 0:
            continue
        low, peak, high = low_bits / 16384.0, peak_bits / 16384.0, high_bits / 16384.0
        value = value_bits / 16384.0
        if low > peak or peak > high or low < 0 < high:
            continue
        if value == peak:
            continue
        if value <= low or value >= high:
            return 0.0
        scalar *= (value - low) / (peak - low) if value < peak else (high - value) / (high - peak)
    return scalar


def infer_axis(target: float, before_coord: float, before_delta: float, after_coord: float, after_delta: float) -> float:
    if before_coord == after_coord:
        return before_delta if before_delta == after_delta else 0.0
    if target <= min(before_coord, after_coord):
        return before_delta if before_coord < after_coord else after_delta
    if target >= max(before_coord, after_coord):
        return before_delta if before_coord > after_coord else after_delta
    proportion = (target - before_coord) / (after_coord - before_coord)
    return before_delta + proportion * (after_delta - before_delta)


def iup_contour(
    points: list[tuple[int, int]], sparse: list[tuple[int, int] | None]
) -> list[tuple[float, float]]:
    touched = [index for index, value in enumerate(sparse) if value is not None]
    if not touched:
        return [(0.0, 0.0)] * len(points)
    if len(touched) == 1:
        value = sparse[touched[0]]
        assert value is not None
        return [(float(value[0]), float(value[1]))] * len(points)
    output: list[tuple[float, float] | None] = [None] * len(points)
    for index in touched:
        value = sparse[index]
        assert value is not None
        output[index] = (float(value[0]), float(value[1]))
    for before, after in zip(touched, touched[1:] + touched[:1]):
        before_delta = sparse[before]
        after_delta = sparse[after]
        assert before_delta is not None and after_delta is not None
        index = (before + 1) % len(points)
        while index != after:
            output[index] = (
                infer_axis(points[index][0], points[before][0], before_delta[0], points[after][0], after_delta[0]),
                infer_axis(points[index][1], points[before][1], before_delta[1], points[after][1], after_delta[1]),
            )
            index = (index + 1) % len(points)
    return [value for value in output if value is not None]


def dense_tuple(model: GlyphModel, sparse: list[tuple[int, int] | None]) -> list[tuple[float, float]]:
    if model.kind == "composite":
        return [(0.0, 0.0) if value is None else (float(value[0]), float(value[1])) for value in sparse]
    output = []
    start = 0
    for end in model.ends:
        output += iup_contour(model.points[start : end + 1], sparse[start : end + 1])
        start = end + 1
    return output


def instance_own(
    models: list[GlyphModel],
    tuples: list[list[tuple[int, list[tuple[int, int] | None]]]],
    regions: list[tuple[tuple[int, int, int], ...]],
    normalized: list[int],
    precision: str,
) -> list[list[tuple[int, int]]]:
    scalars = [region_scalar(region, normalized) for region in regions]
    output = []
    for model, glyph_tuples in zip(models, tuples):
        base = model.points if model.kind == "simple" else [(component.x, component.y) for component in model.components]
        dense = [(scalars[region_id], dense_tuple(model, sparse)) for region_id, sparse in glyph_tuples]
        glyph = []
        for point_index, point in enumerate(base):
            coordinates = []
            for axis in range(2):
                if precision == "f32":
                    value = f32(0.0)
                    for scalar, deltas in dense:
                        value = f32(value + f32(f32(scalar) * f32(deltas[point_index][axis])))
                    coordinates.append(ot_round(f32(f32(point[axis]) + value)))
                else:
                    value = sum(scalar * deltas[point_index][axis] for scalar, deltas in dense)
                    coordinates.append(ot_round(point[axis] + value))
            glyph.append((coordinates[0], coordinates[1]))
        output.append(glyph)
    return output


def expand_glyphs(models: list[GlyphModel], own: list[list[tuple[int, int]]]):
    cache: dict[int, tuple[list[tuple[int, int]], list[int], list[int]]] = {}

    def expand(glyph_id: int, stack: tuple[int, ...] = ()):
        if glyph_id in cache:
            return cache[glyph_id]
        if glyph_id in stack:
            raise ValueError("cyclic composite")
        model = models[glyph_id]
        if model.kind == "empty":
            result = ([], [], [])
        elif model.kind == "simple":
            result = (own[glyph_id], model.tags, model.ends)
        else:
            points: list[tuple[int, int]] = []
            tags: list[int] = []
            ends: list[int] = []
            for component_index, component in enumerate(model.components):
                child_points, child_tags, child_ends = expand(component.glyph_id, stack + (glyph_id,))
                xx, xy, yx, yy = component.transform
                offset_x, offset_y = own[glyph_id][component_index]
                for x, y in child_points:
                    transformed_x = ot_round(xx * x + yx * y)
                    transformed_y = ot_round(xy * x + yy * y)
                    points.append((transformed_x + offset_x, transformed_y + offset_y))
                tags += child_tags
                base = len(points) - len(child_points)
                ends += [base + end for end in child_ends]
            result = (points, tags, ends)
        cache[glyph_id] = result
        return result

    return [expand(glyph_id) for glyph_id in range(len(models))]


def glyph_bounds(points: list[tuple[int, int]]) -> tuple[int, int, int, int] | None:
    if not points:
        return None
    return min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points), max(y for _, y in points)


def oracle(font: TTFont):
    glyf = font["glyf"]
    names = font.getGlyphOrder()
    glyph_set = font.getGlyphSet()
    own = []
    decomposed = []
    topology = []
    ink_bounds = []
    for name in names:
        glyph = glyf[name]
        if glyph.numberOfContours == 0:
            own.append([])
            decomposed.append([])
            topology.append(([], []))
        elif glyph.isComposite():
            own.append([(int(component.x), int(component.y)) for component in glyph.components])
            coordinates, ends, flags = glyph.getCoordinates(glyf)
            decomposed.append([(ot_round(x), ot_round(y)) for x, y in coordinates])
            topology.append(([0 if flag & 1 else 1 for flag in flags], [int(end) for end in ends]))
        else:
            own.append([(int(x), int(y)) for x, y in glyph.coordinates])
            decomposed.append([(int(x), int(y)) for x, y in glyph.coordinates])
            topology.append(([0 if flag & 1 else 1 for flag in glyph.flags], [int(end) for end in glyph.endPtsOfContours]))
        pen = BoundsPen(glyph_set)
        glyph_set[name].draw(pen)
        ink_bounds.append(pen.bounds)
    return {
        "names": names,
        "own": own,
        "decomposed": decomposed,
        "topology": topology,
        "bounds": [glyph_bounds(points) for points in decomposed],
        "inkBounds": ink_bounds,
        "metrics": {name: tuple(map(int, font["hmtx"][name])) for name in names},
    }


def harfbuzz_instance(font_path: Path, subset: Path, scratch: Path, location_index: int, weight: float):
    output = scratch / f"hb-instance-{location_index}.ttf"
    subprocess.run(
        [
            str(subset),
            str(font_path),
            f"--variations=wght={weight:g}",
            "--keep-everything",
            "--retain-gids",
            f"--output-file={output}",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    return oracle(TTFont(output))


def fonttools_instance(font_path: Path, weight: float):
    instance = instantiateVariableFont(TTFont(font_path), {"wght": weight}, inplace=False, optimize=False)
    data = io.BytesIO()
    instance.save(data)
    data.seek(0)
    return oracle(TTFont(data))


def mismatch(left: Iterable[tuple[int, int]], right: Iterable[tuple[int, int]]) -> tuple[int, int]:
    count = maximum = 0
    for a, b in zip(left, right, strict=True):
        for x, y in zip(a, b, strict=True):
            delta = abs(x - y)
            count += int(delta != 0)
            maximum = max(maximum, delta)
    return count, maximum


def compare_instances(candidate_points, expanded, reference):
    own_count = own_max = decomposed_count = decomposed_max = 0
    topology_mismatches = bounds_mismatches = ink_bounds_mismatches = 0
    ink_bounds_maximum_error = 0.0
    for glyph_id, (candidate_own, candidate_expanded) in enumerate(zip(candidate_points, expanded)):
        count, maximum = mismatch(candidate_own, reference["own"][glyph_id])
        own_count += count
        own_max = max(own_max, maximum)
        points, tags, ends = candidate_expanded
        count, maximum = mismatch(points, reference["decomposed"][glyph_id])
        decomposed_count += count
        decomposed_max = max(decomposed_max, maximum)
        topology_mismatches += int((tags, ends) != reference["topology"][glyph_id])
        bounds_mismatches += int(glyph_bounds(points) != reference["bounds"][glyph_id])
        candidate_ink_bounds = curve_bounds(outline_curves(points, tags, ends, perturb_lines=False))
        reference_ink_bounds = reference["inkBounds"][glyph_id]
        if candidate_ink_bounds is None or reference_ink_bounds is None:
            ink_bounds_mismatches += int(candidate_ink_bounds != reference_ink_bounds)
        else:
            error = max(abs(left - right) for left, right in zip(candidate_ink_bounds, reference_ink_bounds, strict=True))
            ink_bounds_mismatches += int(error > 1.0e-9)
            ink_bounds_maximum_error = max(ink_bounds_maximum_error, error)
    return {
        "ownCoordinateMismatches": own_count,
        "ownMaximumError": own_max,
        "decomposedCoordinateMismatches": decomposed_count,
        "decomposedMaximumError": decomposed_max,
        "topologyMismatchedGlyphs": topology_mismatches,
        "controlBoundsMismatchedGlyphs": bounds_mismatches,
        "inkBoundsMismatchedGlyphs": ink_bounds_mismatches,
        "inkBoundsMaximumError": ink_bounds_maximum_error,
    }


def add_comparison(total: dict[str, int], result: dict[str, int]):
    for key, value in result.items():
        if key.endswith("MaximumError"):
            total[key] = max(total.get(key, 0), value)
        else:
            total[key] = total.get(key, 0) + value


def gpu_slots(points: list[tuple[int, int]], tags: list[int], ends: list[int]):
    slots = []
    start = 0
    for end in ends:
        contour_points = points[start : end + 1]
        contour_tags = tags[start : end + 1]
        first_on = next((index for index, tag in enumerate(contour_tags) if tag == 0), None)
        if first_on is None:
            a, b = contour_points[-1], contour_points[0]
            rotated_points = [((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)] + contour_points
            rotated_tags = [0] + contour_tags
        else:
            rotated_points = contour_points[first_on:] + contour_points[:first_on]
            rotated_tags = contour_tags[first_on:] + contour_tags[:first_on]
        slots += list(zip(rotated_points + rotated_points[:1], rotated_tags + rotated_tags[:1]))
        start = end + 1
    return slots


def validate_gpu_slots(expanded, reference):
    mismatches = range_failures = slot_count = 0
    minimum_x = minimum_y = 2**31 - 1
    maximum_x = maximum_y = -(2**31)
    for glyph_id, (points, tags, ends) in enumerate(expanded):
        expected_points = reference["decomposed"][glyph_id]
        expected_tags, expected_ends = reference["topology"][glyph_id]
        candidate_slots = gpu_slots(points, tags, ends)
        expected_slots = gpu_slots(expected_points, expected_tags, expected_ends)
        slot_count += len(candidate_slots)
        mismatches += sum(a != b for a, b in zip(candidate_slots, expected_slots, strict=True))
        for (x, y), tag in candidate_slots:
            if not float(x).is_integer() or not float(y).is_integer():
                range_failures += 1
                continue
            x, y = int(x), int(y)
            minimum_x, minimum_y = min(minimum_x, x), min(minimum_y, y)
            maximum_x, maximum_y = max(maximum_x, x), max(maximum_y, y)
            if not -16384 <= x <= 16383 or not -32768 <= y <= 32767:
                range_failures += 1
                continue
            packed = ((x << 1) & 0xFFFF) | tag
            signed = packed if packed < 0x8000 else packed - 0x10000
            if (signed >> 1, packed & 1) != (x, tag):
                range_failures += 1
    return mismatches, range_failures, slot_count, [minimum_x, minimum_y, maximum_x, maximum_y]


def midpoint(a, b):
    return ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)


def line_curve(start, end):
    middle = midpoint(start, end)
    dx, dy = end[0] - start[0], end[1] - start[1]
    if abs(dx) < 1.0e-6 or abs(dy) < 1.0e-6:
        return start, middle, end
    inverse_length = LINE_EPSILON_FONT_UNITS / math.sqrt(dx * dx + dy * dy)
    return start, (middle[0] - dy * inverse_length, middle[1] + dx * inverse_length), end


def outline_curves(points, tags, ends, *, perturb_lines=True):
    curves = []
    start = 0
    for end in ends:
        contour = points[start : end + 1]
        contour_tags = tags[start : end + 1]
        length = len(contour)
        for index, (point, tag) in enumerate(zip(contour, contour_tags)):
            following = contour[(index + 1) % length]
            following_tag = contour_tags[(index + 1) % length]
            if tag == 1:
                preceding = contour[(index - 1) % length]
                preceding_tag = contour_tags[(index - 1) % length]
                p0 = preceding if preceding_tag == 0 else midpoint(preceding, point)
                p2 = following if following_tag == 0 else midpoint(point, following)
                curves.append((p0, point, p2))
            elif following_tag == 0:
                curves.append(line_curve(point, following) if perturb_lines else (point, midpoint(point, following), following))
        start = end + 1
    return curves


def quadratic_axis_bounds(values):
    minimum = min(values[0], values[2])
    maximum = max(values[0], values[2])
    denominator = values[0] - 2.0 * values[1] + values[2]
    if denominator != 0.0:
        t = (values[0] - values[1]) / denominator
        if 0.0 < t < 1.0:
            value = (1.0 - t) ** 2 * values[0] + 2.0 * (1.0 - t) * t * values[1] + t * t * values[2]
            minimum, maximum = min(minimum, value), max(maximum, value)
    return minimum, maximum


def curve_bounds(curves):
    if not curves:
        return None
    x = [quadratic_axis_bounds([point[0] for point in curve]) for curve in curves]
    y = [quadratic_axis_bounds([point[1] for point in curve]) for curve in curves]
    return min(a for a, _ in x), min(a for a, _ in y), max(b for _, b in x), max(b for _, b in y)


def band_lists(curves, bounds=None):
    bounds = curve_bounds(curves) if bounds is None else bounds
    if bounds is None:
        return bounds, [[[] for _ in range(BAND_COUNT)] for _ in range(2)]
    output = []
    for axis in range(2):
        partition_axis = 1 if axis == 0 else 0
        sort_axis = 0 if axis == 0 else 1
        band_min, band_max = bounds[partition_axis], bounds[partition_axis + 2]
        bands = [[] for _ in range(BAND_COUNT)]
        if band_max > band_min:
            size = (band_max - band_min) / BAND_COUNT
            for curve_index, curve in enumerate(curves):
                values = [point[partition_axis] for point in curve]
                curve_min, curve_max = min(values), max(values)
                if curve_max - curve_min < AXIS_EPSILON:
                    continue
                first = max(0, min(BAND_COUNT - 1, math.floor((curve_min - band_min - BAND_EPSILON) / size)))
                last = max(0, min(BAND_COUNT - 1, math.floor((curve_max - band_min + BAND_EPSILON) / size)))
                for band in range(first, last + 1):
                    bands[band].append(curve_index)
            for band in bands:
                band.sort(key=lambda index: max(point[sort_axis] for point in curves[index]), reverse=True)
        output.append(bands)
    return bounds, output


def validate_bands(curves, bounds, bands):
    missing = inversions = lists = references = 0
    maximum_references = 0
    if bounds is None:
        return missing, inversions, BAND_COUNT * 2, references, maximum_references
    for axis in range(2):
        partition_axis = 1 if axis == 0 else 0
        sort_axis = 0 if axis == 0 else 1
        band_min, band_max = bounds[partition_axis], bounds[partition_axis + 2]
        size = (band_max - band_min) / BAND_COUNT if band_max > band_min else 0.0
        for band_index, band in enumerate(bands[axis]):
            lists += 1
            references += len(band)
            maximum_references = max(maximum_references, len(band))
            keys = [max(point[sort_axis] for point in curves[index]) for index in band]
            inversions += sum(left < right for left, right in zip(keys, keys[1:]))
            if size == 0.0:
                continue
            low = band_min + band_index * size
            high = low + size
            expected = set()
            for curve_index, curve in enumerate(curves):
                values = [point[partition_axis] for point in curve]
                if max(values) - min(values) < AXIS_EPSILON:
                    continue
                if max(values) + BAND_EPSILON >= low and min(values) - BAND_EPSILON <= high:
                    expected.add(curve_index)
            missing += len(expected - set(band))
    return missing, inversions, lists, references, maximum_references


def shape(hb_shape: Path, font_path: Path, weight: float, enabled: bool):
    command = [
        str(hb_shape),
        str(font_path),
        SS02_TEXT,
        f"--variations=wght={weight:g}",
        f"--features=ss02={int(enabled)},kern=0",
        "--output-format=json",
    ]
    return json.loads(subprocess.check_output(command, text=True))


def locations():
    primary = [(100.0, "minimum"), (400.0, "default"), (650.0, "off-named"), (800.0, "maximum")]
    boundaries = []
    for value in (200.0, 300.0, 500.0, 600.0, 700.0):
        boundaries += [(value - 0.01, "avar-boundary-below"), (value, "avar-boundary"), (value + 0.01, "avar-boundary-above")]
    return primary + boundaries


def main():
    font_path, hb_subset, hb_shape, scratch, output = map(Path, sys.argv[1:6])
    if hashlib.sha256(font_path.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError("Paper Mono source hash mismatch")
    source = TTFont(font_path)
    candidate = source_candidate(source)
    if len(candidate.axes) != 1 or candidate.axes[0].tag != "wght":
        raise ValueError("Paper Mono fixture no longer has the expected single wght axis")

    base_planes = encode_base(candidate)
    decoded_models = decode_base(base_planes, len(candidate.models))
    axis_bytes = encode_axis_table(candidate.axes)
    decoded_axes = decode_axis_table(axis_bytes)
    region_bytes = encode_region_table(candidate.regions)
    decoded_regions = decode_region_table(region_bytes, len(decoded_axes))
    delta_planes = encode_deltas(candidate)
    decoded_tuples = decode_deltas(delta_planes, decoded_models, len(decoded_regions))
    base_mismatches = sum(a != b for a, b in zip(candidate.models, decoded_models))
    delta_mismatches = sum(a != b for a, b in zip(candidate.tuples, decoded_tuples))
    if base_mismatches or delta_mismatches or candidate.axes != decoded_axes or candidate.regions != decoded_regions:
        raise ValueError("candidate stream round trip changed its source model")

    kind_counts = {kind: sum(model.kind == kind for model in decoded_models) for kind in ("empty", "simple", "composite")}
    component_count = sum(len(model.components) for model in decoded_models)
    transformed = sum(component.transform != (1.0, 0.0, 0.0, 1.0) for model in decoded_models for component in model.components)
    nested = sum(decoded_models[component.glyph_id].kind == "composite" for model in decoded_models for component in model.components)
    source_flags = [flag for flags in candidate.source_component_flags for flag in flags]
    point_matched = candidate.point_matched_components
    round_xy = sum(bool(flag & ROUND_XY_TO_GRID) for flag in source_flags)
    use_my_metrics = sum(bool(flag & USE_MY_METRICS) for flag in source_flags)
    scaled_offsets = sum(bool(flag & SCALED_COMPONENT_OFFSET) for flag in source_flags)
    unscaled_offsets = sum(bool(flag & UNSCALED_COMPONENT_OFFSET) for flag in source_flags)

    explicit_midpoints = 0
    first_off_curve = 0
    all_off_curve = 0
    contour_count = 0
    for model in decoded_models:
        if model.kind != "simple":
            continue
        start = 0
        for end in model.ends:
            indices = list(range(start, end + 1))
            contour_count += 1
            first_off_curve += int(model.tags[start] == 1)
            all_off_curve += int(all(model.tags[index] == 1 for index in indices))
            for position, index in enumerate(indices):
                before, after = indices[position - 1], indices[(position + 1) % len(indices)]
                if model.tags[index] == 0 and model.tags[before] == model.tags[after] == 1:
                    x, y = model.points[index]
                    a, b = model.points[before], model.points[after]
                    explicit_midpoints += int(2 * x == a[0] + b[0] and 2 * y == a[1] + b[1])
            start = end + 1

    exact_total: dict[str, int] = {}
    f32_total: dict[str, int] = {}
    fonttools_total: dict[str, int] = {}
    normalized_locations = []
    metric_mismatches = 0
    metric_values = 0
    metric_maximum_error = 0
    metric_disagreements_by_location = []
    advances_changed_max = 0
    side_bearings_changed_max = 0
    shaping_checks = shaping_mismatches = substitutions = 0
    off_advances = set()
    on_advances = set()
    gpu_slot_mismatches = gpu_range_failures = gpu_slots_total = 0
    gpu_range = [2**31 - 1, 2**31 - 1, -(2**31), -(2**31)]
    band_missing = band_inversions = band_lists_checked = band_references = 0
    band_max_references = 0
    default_reuse_missing = default_reuse_inversions = 0
    default_metrics = source["hmtx"].metrics

    _, _, default_normalized = normalize(decoded_axes[0], 400.0)
    default_own = instance_own(decoded_models, decoded_tuples, decoded_regions, [default_normalized], "f64")
    default_expanded = expand_glyphs(decoded_models, default_own)
    default_bands = []
    for points, tags, ends in default_expanded:
        curves = outline_curves(points, tags, ends)
        default_bands.append((curves, *band_lists(curves)))

    ss02_names = [name + ".ss02" for name in SS02_BASE]
    ss02_ids = [candidate.names.index(name) for name in ss02_names]
    ss02_nonempty = sum(decoded_models[glyph_id].kind != "empty" for glyph_id in ss02_ids)

    for location_index, (weight, label) in enumerate(locations()):
        raw, mapped, normalized = normalize(decoded_axes[0], weight)
        normalized_locations.append(
            {
                "wght": weight,
                "kind": label,
                "defaultNormalized": round(raw, 9),
                "avarNormalized": round(mapped, 9),
                "f2Dot14": normalized,
            }
        )
        hb = harfbuzz_instance(font_path, hb_subset, scratch, location_index, weight)
        ft = fonttools_instance(font_path, weight)
        if hb["names"] != candidate.names or ft["names"] != candidate.names:
            raise ValueError("oracle changed glyph order")

        exact_own = instance_own(decoded_models, decoded_tuples, decoded_regions, [normalized], "f64")
        exact_expanded = expand_glyphs(decoded_models, exact_own)
        approximate_own = instance_own(decoded_models, decoded_tuples, decoded_regions, [normalized], "f32")
        approximate_expanded = expand_glyphs(decoded_models, approximate_own)
        add_comparison(exact_total, compare_instances(exact_own, exact_expanded, hb))
        add_comparison(f32_total, compare_instances(approximate_own, approximate_expanded, hb))
        add_comparison(fonttools_total, compare_instances(ft["own"], [
            (ft["decomposed"][glyph_id], *ft["topology"][glyph_id]) for glyph_id in range(len(candidate.names))
        ], hb))

        location_metric_mismatches = 0
        location_metric_maximum_error = 0
        for name in candidate.names:
            for left, right in zip(hb["metrics"][name], ft["metrics"][name], strict=True):
                difference = abs(left - right)
                metric_values += 1
                metric_mismatches += int(difference != 0)
                location_metric_mismatches += int(difference != 0)
                metric_maximum_error = max(metric_maximum_error, difference)
                location_metric_maximum_error = max(location_metric_maximum_error, difference)
        if location_metric_mismatches:
            metric_disagreements_by_location.append(
                {
                    "wght": weight,
                    "kind": label,
                    "values": location_metric_mismatches,
                    "maximumError": location_metric_maximum_error,
                }
            )
        advances_changed_max = max(
            advances_changed_max,
            sum(hb["metrics"][name][0] != default_metrics[name][0] for name in candidate.names),
        )
        side_bearings_changed_max = max(
            side_bearings_changed_max,
            sum(hb["metrics"][name][1] != default_metrics[name][1] for name in candidate.names),
        )

        slot_mismatches, range_failures, slot_count, instance_range = validate_gpu_slots(exact_expanded, hb)
        gpu_slot_mismatches += slot_mismatches
        gpu_range_failures += range_failures
        gpu_slots_total += slot_count
        gpu_range = [
            min(gpu_range[0], instance_range[0]),
            min(gpu_range[1], instance_range[1]),
            max(gpu_range[2], instance_range[2]),
            max(gpu_range[3], instance_range[3]),
        ]

        for glyph_id, (points, tags, ends) in enumerate(exact_expanded):
            curves = outline_curves(points, tags, ends)
            bounds, bands = band_lists(curves)
            missing, inversions, lists, references, maximum = validate_bands(curves, bounds, bands)
            band_missing += missing
            band_inversions += inversions
            band_lists_checked += lists
            band_references += references
            band_max_references = max(band_max_references, maximum)
            if weight != 400.0:
                _, default_bounds, reused = default_bands[glyph_id]
                missing, inversions, _, _, _ = validate_bands(curves, default_bounds, reused)
                default_reuse_missing += missing
                default_reuse_inversions += inversions

        for enabled in (False, True):
            shaped = shape(hb_shape, font_path, weight, enabled)
            expected_names = ss02_names if enabled else SS02_BASE
            shaping_mismatches += int(len(shaped) != len(expected_names))
            for record, expected_name in zip(shaped, expected_names):
                shaping_checks += 1
                shaping_mismatches += int(record["g"] != expected_name)
                glyph_name = record["g"]
                shaping_mismatches += int(record["ax"] != hb["metrics"][glyph_name][0])
                shaping_mismatches += int(candidate.names.index(glyph_name) >= len(decoded_models))
                (on_advances if enabled else off_advances).add(int(record["ax"]))
            if enabled:
                substitutions += sum(record["g"] != base for record, base in zip(shaped, SS02_BASE))

    tuple_count = sum(len(tuples) for tuples in decoded_tuples)
    tuple_slots = sum(len(sparse) for tuples in decoded_tuples for _, sparse in tuples)
    explicit_deltas = sum(value is not None for tuples in decoded_tuples for _, sparse in tuples for value in sparse)
    nonzero_glyphs = sum(
        any(value not in (None, (0, 0)) for _, sparse in tuples for value in sparse) for tuples in decoded_tuples
    )
    composite_nonzero_glyphs = sum(
        model.kind == "composite" and any(value not in (None, (0, 0)) for _, sparse in tuples for value in sparse)
        for model, tuples in zip(decoded_models, decoded_tuples)
    )
    maximum_delta_predictor = 0
    for tuples in decoded_tuples:
        for _, sparse in tuples:
            values = [value for value in sparse if value is not None]
            previous = (0, 0)
            for index, value in enumerate(values):
                predicted = value if index == 0 else (value[0] - previous[0], value[1] - previous[1])
                maximum_delta_predictor = max(maximum_delta_predictor, abs(predicted[0]), abs(predicted[1]))
                previous = value

    result = {
        "schemaVersion": 2,
        "sources": {
            "paperMonoCommit": SOURCE_COMMIT,
            "paperMonoUrl": SOURCE_URL,
            "paperMonoSha256": SOURCE_SHA256,
            "fontTools": fontTools.__version__,
            "harfBuzz": subprocess.check_output([str(hb_shape), "--version"], text=True).splitlines()[0],
        },
        "font": {
            "glyphs": len(candidate.names),
            "unitsPerEm": candidate.units_per_em,
            "tables": sorted(tag for tag in source.keys() if tag != "GlyphOrder"),
            "kinds": kind_counts,
            "simplePoints": sum(len(model.points) for model in decoded_models),
            "simpleContours": contour_count,
            "components": component_count,
            "transformedComponents": transformed,
            "nestedComponents": nested,
            "pointMatchedComponents": point_matched,
            "roundXyToGridComponents": round_xy,
            "useMyMetricsComponents": use_my_metrics,
            "scaledOffsetComponents": scaled_offsets,
            "unscaledOffsetComponents": unscaled_offsets,
            "firstOffCurveContours": first_off_curve,
            "allOffCurveContours": all_off_curve,
            "explicitMidpointPointsPreserved": explicit_midpoints,
        },
        "baseStream": {
            "sha256": framed_digest(base_planes),
            "planeBytes": {name: len(data) for name, data in base_planes.items()},
            "totalBytes": sum(map(len, base_planes.values())),
            "roundTripMismatchedGlyphs": base_mismatches,
        },
        "variationStream": {
            "axisTableBytes": len(axis_bytes),
            "regionTableBytes": len(region_bytes),
            "deltaPlaneBytes": {name: len(data) for name, data in delta_planes.items()},
            "deltaTotalBytes": sum(map(len, delta_planes.values())),
            "sha256": framed_digest({"axes": axis_bytes, "regions": region_bytes, **delta_planes}),
            "axes": [
                {
                    "tag": axis.tag,
                    "minimum": axis.minimum,
                    "default": axis.default,
                    "maximum": axis.maximum,
                    "avar": [[before, after] for before, after in axis.avar],
                }
                for axis in decoded_axes
            ],
            "regions": len(decoded_regions),
            "tuples": tuple_count,
            "tuplePointSlots": tuple_slots,
            "explicitDeltas": explicit_deltas,
            "untouchedDeltas": tuple_slots - explicit_deltas,
            "glyphsWithNonzeroDeltas": nonzero_glyphs,
            "compositeGlyphsWithNonzeroDeltas": composite_nonzero_glyphs,
            "phantomTuplesWithNonzeroDeltas": candidate.phantom_nonzero_tuples,
            "maximumPredictedDeltaMagnitude": maximum_delta_predictor,
            "roundTripMismatchedGlyphs": delta_mismatches,
        },
        "instances": {
            "locations": normalized_locations,
            "locationCount": len(normalized_locations),
            "dynamicStreamReused": True,
            "exactVsHarfBuzz": exact_total,
            "f32VsHarfBuzz": f32_total,
            "fontToolsVsHarfBuzz": fonttools_total,
            "hvarOracleComparison": {
                "valuesCompared": metric_values,
                "disagreements": metric_mismatches,
                "maximumError": metric_maximum_error,
                "disagreementsByLocation": metric_disagreements_by_location,
            },
            "maximumGlyphsWithChangedAdvance": advances_changed_max,
            "maximumGlyphsWithChangedSideBearing": side_bearings_changed_max,
            "gpuSlotsCompared": gpu_slots_total,
            "gpuSlotMismatches": gpu_slot_mismatches,
            "gpuTagOrI16RangeFailures": gpu_range_failures,
            "gpuCoordinateRange": gpu_range,
        },
        "ss02": {
            "alternatesExpected": len(ss02_names),
            "alternatesPresentInStream": ss02_nonempty,
            "shapedGlyphsChecked": shaping_checks,
            "shapingOrAdvanceMismatches": shaping_mismatches,
            "substitutionsObserved": substitutions,
            "disabledAdvances": sorted(off_advances),
            "enabledAdvances": sorted(on_advances),
        },
        "slugBands": {
            "proof": "CPU structural proof against the current instanced-maximum early-exit ordering; no GPU call",
            "bandCountPerAxis": BAND_COUNT,
            "rebuiltListsChecked": band_lists_checked,
            "rebuiltReferences": band_references,
            "rebuiltMissingReferences": band_missing,
            "rebuiltAdjacentOrderInversions": band_inversions,
            "maximumReferencesPerBand": band_max_references,
            "defaultListsReusedAtOtherInstancesMissingReferences": default_reuse_missing,
            "defaultListsReusedAtOtherInstancesOrderInversions": default_reuse_inversions,
        },
        "limits": {
            "gpuExecuted": False,
            "paperExercisesCff2": False,
            "paperExercisesVarc": False,
            "paperExercisesTransformedComponents": bool(transformed),
            "paperExercisesNestedComponents": bool(nested),
            "paperExercisesPointMatchedComponents": bool(point_matched),
            "componentRoundFlagStoredByCurrentProposal": False,
        },
    }
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(
        json.dumps(
            {
                "locations": result["instances"]["locationCount"],
                "exactOutlineMismatches": exact_total["decomposedCoordinateMismatches"],
                "f32OutlineMismatches": f32_total["decomposedCoordinateMismatches"],
                "hvarOracleDisagreements": metric_mismatches,
                "ss02Mismatches": shaping_mismatches,
                "bandMissing": band_missing,
                "bandInversions": band_inversions,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
