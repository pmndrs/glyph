#!/usr/bin/env python3
"""Descriptive nearest-rank quantiles from the three frozen E5 Labs arms."""
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


BASELINES = {
    "main": "bbb3375c08fb3db8186ec10e4b766b7170632f7601eb1ec0e90be0197f22eb20",
    "published": "6e2bf7bdef50ec528a4e4799b8f067e81335388265fbb4950cbbcf08f840581b",
    "prior-e2": "28fd04139e792aa37fd963bf6100c091a4acdbd24417e2435f1a71d898ab37bb",
}
CANDIDATE = "83949860ae65b99fe6d7471b9782398234852668b54412870fafa81878c366a3"


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

                medians = stats.get("blocks", {}).get("medians", [])
                if not medians:
                    raise ValueError(f"missing block medians for {key}")
                values[key] = {
                    "file": file_name,
                    "group": group,
                    "name": run["name"],
                    "args": run.get("args", {}),
                    "storedSampleCount": len(samples),
                    "pooledStoredSampleNearestRankP50Ms": nr(0.50),
                    "pooledStoredSampleNearestRankP95Ms": nr(0.95),
                    "medianOfBlockMediansMs": statistics.median(medians) / 1_000_000,
                    "blockCount": len(medians),
                    "plan": stats.get("plan", {}),
                    "kind": stats.get("kind"),
                }
                order.append(key)
    return values, order


def serial_keys(keys: set[tuple[str, str, str, str]]) -> list[list[str]]:
    return [list(k) for k in sorted(keys)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence-root", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    root, output = args.evidence_root.resolve(), args.output.resolve()
    if output.exists():
        raise FileExistsError(output)
    arms: dict[str, Any] = {}
    main_candidate: dict[tuple[str, str, str, str], dict[str, Any]] | None = None
    main_candidate_hash: str | None = None
    main_candidate_manifest: bytes | None = None
    for arm in ("main", "published", "prior-e2"):
        directory = root / f"matrix-{arm}-data"
        paths = {name: directory / name for name in ("manifest.json", "baseline.json", "candidate.json", "summary.md", "comparison.txt")}
        if any(not p.is_file() for p in paths.values()):
            raise FileNotFoundError(f"missing required raw input in {directory}")
        manifest = json.loads(paths["manifest.json"].read_text())
        if manifest["suite"] != "full" or manifest["blocks"] != 8:
            raise ValueError(f"unexpected suite/blocks in {arm}: {manifest['suite']}/{manifest['blocks']}")
        if manifest["baseline"]["sha256"] != BASELINES[arm] or manifest["candidate"]["sha256"] != CANDIDATE:
            raise ValueError(f"archive identity mismatch in {arm}")
        baseline, baseline_order = collect(paths["baseline.json"])
        candidate, candidate_order = collect(paths["candidate.json"])
        if arm == "main":
            main_candidate, main_candidate_hash = candidate, sha(paths["candidate.json"])
            main_candidate_manifest = paths["manifest.json"].read_bytes()
        else:
            if sha(paths["candidate.json"]) != main_candidate_hash:
                raise ValueError(f"{arm} candidate raw JSON differs from the main saved candidate")
            if candidate_order != list(main_candidate):
                raise ValueError(f"{arm} candidate identity/order differs from main")
            for key, row in candidate.items():
                if row != main_candidate[key]:
                    raise ValueError(f"{arm} candidate derived quantile differs for {key}")
            saved_manifest = directory / "saved-candidate-manifest.json"
            if saved_manifest.is_file() and saved_manifest.read_bytes() != main_candidate_manifest:
                raise ValueError(f"{arm} saved candidate manifest differs from main")

        bkeys, ckeys = set(baseline), set(candidate)
        keys = list(candidate_order) + [k for k in baseline_order if k not in ckeys]
        rows = []
        for key in keys:
            b, c = baseline.get(key), candidate.get(key)
            exemplar = c or b
            p50 = ((c["pooledStoredSampleNearestRankP50Ms"] / b["pooledStoredSampleNearestRankP50Ms"] - 1) * 100) if b and c else None
            p95 = ((c["pooledStoredSampleNearestRankP95Ms"] / b["pooledStoredSampleNearestRankP95Ms"] - 1) * 100) if b and c else None
            rows.append({"file": exemplar["file"], "group": exemplar["group"], "name": exemplar["name"], "args": exemplar["args"], "baseline": b, "candidate": c, "sampleP50DeltaPercent": p50, "sampleP95DeltaPercent": p95})

        summary_text = paths["summary.md"].read_text()
        comparison_text = paths["comparison.txt"].read_text()
        report_lines = [re.sub(r"\x1b\[[0-9;]*m", "", line) for line in comparison_text.splitlines()]
        needles = ("rewrite 512 labels in one group", "publish 1024 retained Text instances")
        focus = []
        for needle in needles:
            row = next((r for r in rows if needle in r["name"]), None)
            focus.append({"needle": needle, "matched": row is not None, "row": row, "labsReportLine": next((line.strip() for line in report_lines if needle in line), None)})
        baseline_raw, candidate_raw = json.loads(paths["baseline.json"].read_text()), json.loads(paths["candidate.json"].read_text())
        input_hashes = {name: sha(path) for name, path in paths.items()}
        for optional in ("saved-candidate-manifest.json",):
            p = directory / optional
            if p.is_file():
                input_hashes[optional] = sha(p)
        arms[arm] = {
            "manifest": manifest,
            "inputs": input_hashes,
            "baselineIdentityCount": len(bkeys),
            "candidateIdentityCount": len(ckeys),
            "matchedIdentityCount": len(bkeys & ckeys),
            "baselineOnlyIdentities": serial_keys(bkeys - ckeys),
            "candidateOnlyIdentities": serial_keys(ckeys - bkeys),
            "reportExclusions": [line for line in summary_text.splitlines() if line.startswith("| skipped:")],
            "warningLines": [line for line in summary_text.splitlines() if "⚠" in line or "clock drift" in line.lower()],
            "baselineEnvironment": baseline_raw.get("environment", {}),
            "candidateEnvironment": candidate_raw.get("environment", {}),
            "rows": rows,
            "denseWorkloads": focus,
        }

    data = {
        "schema": "e5-three-arm-descriptive-absolute-quantiles-v1",
        "recordedUtc": datetime.now(timezone.utc).isoformat(),
        "method": {
            "source": "stored Labs stats.samples per-call nanoseconds and stats.blocks.medians",
            "sampleQuantiles": "sort stored per-call samples; nearest rank index ceil(q*n)-1; divide nanoseconds by 1,000,000 for milliseconds",
            "blockSummary": "median of stored block medians, separate from pooled-sample quantiles and original Labs comparison statistics",
            "correction": "none; no clock correction, bootstrap, synthetic confidence interval, retiming, or 5% acceptance threshold",
        },
        "candidateRawJsonSha256": main_candidate_hash,
        "candidateRawJsonIdenticalAcrossArms": True,
        "scope": "Descriptive only. Each baseline ran sequentially; candidate timing rows were reused byte-identically from main. Preserve each arm's actual workload identities, timing-mode exclusions, software calibration and warnings. These figures do not determine acceptance.",
        "arms": arms,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(json.dumps({"output": str(output), "sha256": sha(output), "candidateRawJsonSha256": main_candidate_hash, "arms": {name: {"baselineIdentityCount": val["baselineIdentityCount"], "candidateIdentityCount": val["candidateIdentityCount"], "matchedIdentityCount": val["matchedIdentityCount"], "baselineOnly": len(val["baselineOnlyIdentities"]), "candidateOnly": len(val["candidateOnlyIdentities"]), "exclusionCount": len(val["reportExclusions"]), "warningCount": len(val["warningLines"])} for name, val in arms.items()}}, indent=2))


if __name__ == "__main__":
    main()
