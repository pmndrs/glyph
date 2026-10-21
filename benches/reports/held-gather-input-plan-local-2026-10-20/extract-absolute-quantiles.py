#!/usr/bin/env python3
"""Reproduce pooled nearest-rank quantiles from one stored Labs comparison."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EVIDENCE = Path(__file__).resolve().parent
MAIN_RAW = EVIDENCE / "matrix-main-data"
MAIN_QUANTILES = EVIDENCE / "main-absolute-quantiles.json"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def identity(file: str, group: str, run: dict[str, Any]) -> tuple[str, str, str, str]:
    return (file, group, str(run["name"]), json.dumps(run.get("args", {}), sort_keys=True, separators=(",", ":")))


def collect(path: Path) -> tuple[dict[tuple[str, str, str, str], dict[str, Any]], list[tuple[str, str, str, str]]]:
    data = json.loads(path.read_text())
    values: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    order: list[tuple[str, str, str, str]] = []
    for file_data in data["files"]:
        file_name = file_data["file"]
        for benchmark in file_data["benchmarks"]:
            group = benchmark.get("groupName") or ""
            for run in benchmark["runs"]:
                key = identity(file_name, group, run)
                if key in values:
                    raise ValueError(f"duplicate workload identity: {key}")
                stats = run["stats"]
                samples = stats.get("samples")
                if not isinstance(samples, list) or not samples:
                    raise ValueError(f"missing stored samples for {key}")
                ordered = sorted(samples)
                def nr(q: float) -> float:
                    return ordered[math.ceil(q * len(ordered)) - 1] / 1_000_000
                block_medians = stats.get("blocks", {}).get("medians", [])
                if not block_medians:
                    raise ValueError(f"missing block medians for {key}")
                values[key] = {
                    "file": file_name,
                    "group": group,
                    "name": run["name"],
                    "args": run.get("args", {}),
                    "samples": len(samples),
                    "sampleNearestRankP50Ms": nr(0.50),
                    "sampleNearestRankP95Ms": nr(0.95),
                    "medianBlockMedianMs": statistics.median(block_medians) / 1_000_000,
                    "blockCount": len(block_medians),
                    "plan": stats.get("plan", {}),
                    "kind": stats.get("kind"),
                }
                order.append(key)
    return values, order


def missing_rows(keys: set[tuple[str, str, str, str]], other: dict[tuple[str, str, str, str], dict[str, Any]]) -> list[list[str]]:
    return [[k[0], k[1], k[2], k[3]] for k in sorted(keys - other.keys())]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--arm-dir", type=Path, required=True, help="existing matrix-*-data directory")
    parser.add_argument("--output", type=Path, required=True, help="new output JSON path; existing files are never overwritten")
    parser.add_argument("--expected-baseline-sha256", required=True)
    args = parser.parse_args()
    arm = args.arm_dir.resolve()
    output = args.output.resolve()
    if output.exists():
        raise FileExistsError(output)
    baseline_path, candidate_path = arm / "baseline.json", arm / "candidate.json"
    manifest_path, summary_path, comparison_path = arm / "manifest.json", arm / "summary.md", arm / "comparison.txt"
    saved_manifest_path = arm / "saved-candidate-manifest.json"
    main_candidate_path = MAIN_RAW / "candidate.json"
    main_quantile_data = json.loads(MAIN_QUANTILES.read_text())
    baseline_raw, baseline_order = collect(baseline_path)
    candidate_raw, candidate_order = collect(candidate_path)
    main_candidate_raw, main_candidate_order = collect(main_candidate_path)
    baseline_keys, candidate_keys = set(baseline_raw), set(candidate_raw)
    if len(baseline_keys) != 145 or len(candidate_keys) != 145:
        raise ValueError(f"expected 145 workload identities per arm, got baseline={len(baseline_keys)} candidate={len(candidate_keys)}")
    if candidate_order != main_candidate_order:
        raise ValueError("candidate workload identity/order differs from frozen main candidate raw JSON")
    if sha(candidate_path) != sha(main_candidate_path):
        raise ValueError("candidate raw JSON is not byte-identical to main saved candidate")
    if set(main_candidate_raw) != candidate_keys:
        raise ValueError("candidate identity set differs from main saved candidate")
    manifest = json.loads(manifest_path.read_text())
    if manifest["baseline"]["sha256"] != args.expected_baseline_sha256:
        raise ValueError("baseline archive digest in manifest does not match expected prior-E2 digest")
    if manifest["candidate"]["sha256"] != json.loads((MAIN_RAW / "manifest.json").read_text())["candidate"]["sha256"]:
        raise ValueError("manifest candidate digest differs from main saved candidate")
    saved_manifest_exact = saved_manifest_path.is_file() and sha(saved_manifest_path) == sha(MAIN_RAW / "manifest.json")
    if not saved_manifest_exact:
        raise ValueError("saved-candidate manifest is not byte-identical to main manifest")
    for key in candidate_keys:
        if candidate_raw[key] != main_candidate_raw[key]:
            raise ValueError(f"candidate quantile input differs from main saved candidate for {key}")

    keys = list(candidate_order) + [key for key in baseline_order if key not in candidate_keys]
    rows = []
    for key in keys:
        b, c = baseline_raw.get(key), candidate_raw.get(key)
        p50_delta = ((c["sampleNearestRankP50Ms"] / b["sampleNearestRankP50Ms"] - 1) * 100) if b and c else None
        p95_delta = ((c["sampleNearestRankP95Ms"] / b["sampleNearestRankP95Ms"] - 1) * 100) if b and c else None
        exemplar = c or b
        rows.append({"file": exemplar["file"], "group": exemplar["group"], "name": exemplar["name"], "args": exemplar["args"], "baseline": b, "candidate": c, "sampleP50DeltaPercent": p50_delta, "sampleP95DeltaPercent": p95_delta})

    summary_lines = summary_path.read_text().splitlines()
    report_exclusions = [line for line in summary_lines if line.startswith("| skipped:")]
    warning_lines = [line for line in summary_lines if "⚠" in line or "clock drift" in line.lower()]
    baseline_data, candidate_data = json.loads(baseline_path.read_text()), json.loads(candidate_path.read_text())
    main_quantiles_by_id = {(r["file"], r["group"], r["name"], json.dumps(r["args"], sort_keys=True, separators=(",", ":"))): r["candidate"] for r in main_quantile_data["rows"]}
    for row in rows:
        if row["candidate"] is None:
            continue
        row_key = (row["file"], row["group"], row["name"], json.dumps(row["args"], sort_keys=True, separators=(",", ":")))
        if row["candidate"] != main_quantiles_by_id.get(row_key):
            raise ValueError(f"derived candidate quantiles differ from main saved candidate for {row_key}")
    focus = []
    ansi = re.compile(r"\x1b\[[0-9;]*m")
    report_lines = [ansi.sub("", line) for line in comparison_path.read_text().splitlines()]
    for needle in ("rewrite 512 labels in one group", "publish 1024 retained Text instances"):
        row = next(r for r in rows if needle in r["name"])
        report_line = next((line.strip() for line in report_lines if needle in line), None)
        focus.append({"file": row["file"], "group": row["group"], "name": row["name"], "args": row["args"], "pooledStoredSamples": {"baseline": {"p50Ms": row["baseline"]["sampleNearestRankP50Ms"], "p95Ms": row["baseline"]["sampleNearestRankP95Ms"]}, "candidate": {"p50Ms": row["candidate"]["sampleNearestRankP50Ms"], "p95Ms": row["candidate"]["sampleNearestRankP95Ms"]}}, "medianOfBlockMediansMs": {"baseline": row["baseline"]["medianBlockMedianMs"], "candidate": row["candidate"]["medianBlockMedianMs"]}, "labsBlockStatisticsReportLine": report_line})

    baseline_calibration = baseline_data.get("environment", {}).get("freqs", [])
    main_calibration = main_quantile_data.get("calibration", {}).get("candidate", {}).get("perFileSoftwareEstimates", [])
    data = {
        "schema": "held-input-plan-prior-e2-absolute-quantiles-v1",
        "recordedUtc": datetime.now(timezone.utc).isoformat(),
        "inputs": {name: sha(arm / name) for name in ["manifest.json", "candidate.json", "baseline.json", "summary.md", "comparison.txt", "saved-candidate-manifest.json"]},
        "manifest": manifest,
        "savedCandidateBytesExactMain": sha(candidate_path) == sha(main_candidate_path),
        "savedCandidateManifestBytesExactMain": saved_manifest_exact,
        "identityPairing": {"baselineIdentityCount": len(baseline_keys), "candidateIdentityCount": len(candidate_keys), "matchedIdentityCount": len(baseline_keys & candidate_keys), "baselineOnly": missing_rows(baseline_keys, candidate_raw), "candidateOnly": missing_rows(candidate_keys, baseline_raw)},
        "method": main_quantile_data["method"],
        "baselineMissingRows": missing_rows(candidate_keys, baseline_raw),
        "candidateMissingRows": missing_rows(baseline_keys, candidate_raw),
        "reportExclusions": report_exclusions,
        "warningLines": warning_lines,
        "baselineCalibration": baseline_calibration,
        "candidateCalibrationFromMainSavedArm": main_calibration,
        "scope": "Prior-E2 arm only. Same frozen candidate timing rows reused byte-identically from the main arm; baseline is a separate sequential run, so machine variability remains. Software frequency estimates are calibration metadata, not hardware clock measurements. Labs block-statistic deltas/CI remain those in the stored comparison report; pooled sample quantiles are descriptive and distinct.",
        "rows": rows,
        "requestedDense512And1024Rows": focus,
        "candidateQuantileMatchToMain": {"matchedIdentityCount": len(candidate_keys), "allCandidateRowQuantilesAndMetadataExact": True},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(json.dumps({"output": str(output), "rowCount": len(rows), "identityPairing": data["identityPairing"], "candidateMatch": data["candidateQuantileMatchToMain"], "sha256": sha(output), "dense512and1024": focus}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
