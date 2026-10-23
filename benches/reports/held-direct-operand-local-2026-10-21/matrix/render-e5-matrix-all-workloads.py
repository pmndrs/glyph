#!/usr/bin/env python3
"""Render a factual all-candidate-workloads comparison from the merged E5 quantiles."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Any


ARMS = ("main", "published", "prior-e2")
ARM_LABELS = {"main": "main", "published": "published", "prior-e2": "prior E2"}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def key(row: dict[str, Any]) -> tuple[str, str, str, str]:
    return (row["file"], row["group"], row["name"], json.dumps(row["args"], sort_keys=True, separators=(",", ":")))


def fmt(value: Any) -> str:
    if value is None:
        return "N/A"
    return f"{value:.6f}"


def md(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("|", "&#124;")


def sample_pair(value: dict[str, Any] | None) -> tuple[Any, Any]:
    if value is None:
        return None, None
    return value["pooledStoredSampleNearestRankP50Ms"], value["pooledStoredSampleNearestRankP95Ms"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence-root", type=Path, required=True)
    ap.add_argument("--quantiles", type=Path, required=True)
    ap.add_argument("--markdown", type=Path, required=True)
    ap.add_argument("--csv", type=Path, required=True)
    a = ap.parse_args()
    root, qpath, mdpath, csvpath = a.evidence_root.resolve(), a.quantiles.resolve(), a.markdown.resolve(), a.csv.resolve()
    if mdpath.exists() or csvpath.exists():
        raise FileExistsError("refusing to overwrite an existing rendered report")
    data = json.loads(qpath.read_text())
    arms = data["arms"]
    indexed: dict[str, dict[tuple[str, str, str, str], dict[str, Any]]] = {}
    excluded: dict[str, set[tuple[str, str, str, str]]] = {}
    for arm in ARMS:
        x = arms[arm]
        indexed[arm] = {key(row): row for row in x["rows"]}
        if len(indexed[arm]) != len(x["rows"]):
            raise ValueError(f"duplicate identity in {arm}")
        names = [line.split("|")[2].strip() for line in x["reportExclusions"]]
        excluded[arm] = set()
        for name in names:
            matches = [k for k in indexed[arm] if k[2] == name]
            if len(matches) != 1:
                raise ValueError(f"exclusion name {name!r} maps to {len(matches)} identities in {arm}")
            excluded[arm].add(matches[0])

    candidate_keys = set(indexed["main"])
    if len(candidate_keys) != 145:
        raise ValueError(f"expected 145 candidate workload identities, found {len(candidate_keys)}")
    if not (set(indexed["main"]) == set(indexed["published"]) == set(indexed["prior-e2"])):
        raise ValueError("quantile output rows are not the same candidate identity set in all arms")
    for k in candidate_keys:
        candidate_rows = [indexed[arm][k]["candidate"] for arm in ARMS]
        if any(row != candidate_rows[0] for row in candidate_rows[1:]):
            raise ValueError(f"candidate measurements differ across arms for {k}")

    headers = [
        "file", "group", "name", "args_json",
        "main_baseline_p50_ms", "main_baseline_p95_ms",
        "published_baseline_p50_ms", "published_baseline_p95_ms",
        "prior_e2_baseline_p50_ms", "prior_e2_baseline_p95_ms",
        "current_candidate_p50_ms", "current_candidate_p95_ms",
        "main_timing_mode_excluded", "published_timing_mode_excluded", "prior_e2_timing_mode_excluded",
        "published_baseline_missing",
    ]
    rows: list[dict[str, Any]] = []
    for k in sorted(candidate_keys):
        r_main, r_pub, r_e2 = (indexed[arm][k] for arm in ARMS)
        b_main, b_pub, b_e2 = (r["baseline"] for r in (r_main, r_pub, r_e2))
        c = r_main["candidate"]
        row = {
            "file": k[0], "group": k[1], "name": k[2], "args_json": json.dumps(json.loads(k[3]), sort_keys=True, separators=(",", ":")),
            "main_baseline_p50_ms": sample_pair(b_main)[0], "main_baseline_p95_ms": sample_pair(b_main)[1],
            "published_baseline_p50_ms": sample_pair(b_pub)[0], "published_baseline_p95_ms": sample_pair(b_pub)[1],
            "prior_e2_baseline_p50_ms": sample_pair(b_e2)[0], "prior_e2_baseline_p95_ms": sample_pair(b_e2)[1],
            "current_candidate_p50_ms": c["pooledStoredSampleNearestRankP50Ms"], "current_candidate_p95_ms": c["pooledStoredSampleNearestRankP95Ms"],
            "main_timing_mode_excluded": k in excluded["main"], "published_timing_mode_excluded": k in excluded["published"], "prior_e2_timing_mode_excluded": k in excluded["prior-e2"],
            "published_baseline_missing": b_pub is None,
        }
        rows.append(row)

    with csvpath.open("x", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)

    lines = [
        "# E5 full-matrix absolute workload quantiles",
        "",
        "This table lists all 145 identities in the single reused current candidate. Each baseline column is the raw stored-sample nearest-rank p50/p95 from that arm; `current candidate` appears once because its timing JSON was reused byte-for-byte in all three comparisons. No cross-arm candidate average is computed.",
        "",
        "The quantile method sorts each workload's stored per-call nanosecond samples, selects index `ceil(q*n)-1`, then divides by 1,000,000 for milliseconds. The Labs median-of-block-medians and report statistics are separate. These absolute quantiles are descriptive and do not replace the original Labs block statistics, confidence intervals, p-values, exclusions, or software calibration warnings.",
        "",
        "`N/A` marks an absent baseline identity. `mode excluded` flags reproduce each arm's original timing-mode exclusions; a row can still have raw samples while its comparison is excluded. No arbitrary admission threshold is applied.",
        "",
        "| File | Group | Workload | Args (JSON) | Main baseline p50 / p95 ms | Published baseline p50 / p95 ms | Prior E2 baseline p50 / p95 ms | Current candidate p50 / p95 ms | Main mode excluded | Published mode excluded | E2 mode excluded | Published baseline missing |",
        "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | :---: | :---: | :---: | :---: |",
    ]
    for row in rows:
        def pair(p50: Any, p95: Any) -> str:
            return f"{fmt(p50)} / {fmt(p95)}"
        lines.append("| " + " | ".join([
            md(row["file"]), md(row["group"]), md(row["name"]), f"`{md(row['args_json'])}`",
            pair(row["main_baseline_p50_ms"], row["main_baseline_p95_ms"]), pair(row["published_baseline_p50_ms"], row["published_baseline_p95_ms"]), pair(row["prior_e2_baseline_p50_ms"], row["prior_e2_baseline_p95_ms"]), pair(row["current_candidate_p50_ms"], row["current_candidate_p95_ms"]),
            str(row["main_timing_mode_excluded"]).lower(), str(row["published_timing_mode_excluded"]).lower(), str(row["prior_e2_timing_mode_excluded"]).lower(), str(row["published_baseline_missing"]).lower(),
        ]) + " |")

    lines += ["", "## Preserved source reports", "", "The linked comparison reports remain the authority for the Labs median-of-block-medians, p-values, confidence intervals, and exact skipped rows. Their bytes are unchanged.", ""]
    for arm in ARMS:
        label = ARM_LABELS[arm]
        base = root / f"matrix-{arm}-data"
        for name in ("comparison.txt", "summary.md"):
            path = base / name
            lines.append(f"- {label} `{name}`: [{path}]({path}) — SHA-256 `{sha(path)}`")
    lines += [
        "",
        f"Quantile input JSON SHA-256: `{sha(qpath)}`. Candidate raw JSON SHA-256, reused exactly across arms: `{data['candidateRawJsonSha256']}`.",
        "",
        f"CSV export: [{csvpath}]({csvpath}) — 145 rows.",
        "",
    ]
    with mdpath.open("x") as f:
        f.write("\n".join(lines))
    print(json.dumps({"markdown": str(mdpath), "markdownSha256": sha(mdpath), "csv": str(csvpath), "csvSha256": sha(csvpath), "rows": len(rows), "candidateIdentities": len(candidate_keys), "modeExclusions": {arm: len(excluded[arm]) for arm in ARMS}, "publishedBaselineMissing": sum(r["published_baseline_missing"] for r in rows)}, indent=2))


if __name__ == "__main__":
    main()
