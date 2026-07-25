import type { BenchmarkScenario } from "./contracts";

function deterministicValidation(hashes: readonly string[]): string {
  if (hashes.length === 0) throw new Error("Scenario produced no measurements");
  const unique = new Set(hashes);
  if (unique.size !== 1) throw new Error("Output hash changed between samples");
  return `${hashes.length}/${hashes.length} deterministic outputs`;
}

export const scenarios: readonly BenchmarkScenario[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Runner lifecycle, validation, and environment readiness.",
    requiredCapabilities: new Set(["deterministic"]),
    validate: (values) => deterministicValidation(values.map((value) => value.hash)),
  },
  {
    id: "cold-load-payload",
    label: "Cold load + payload",
    description: "Wasm startup, source-to-GLB bake time, output bytes, and determinism.",
    requiredCapabilities: new Set(["font-bytes", "wasm"]),
    validate: (values) => deterministicValidation(values.map((value) => value.hash)),
  },
  {
    id: "worker-fallback",
    label: "Worker fallback",
    description: "Missing baked probe, module-Worker bake, validation, and registration.",
    requiredCapabilities: new Set(["loader", "font-bytes", "wasm"]),
    validate: (values) => deterministicValidation(values.map((value) => value.hash)),
  },
];

export const plannedScenarios = [
  "Screen-space ladder",
  "Off-axis / 3D",
  "Dynamic layout",
  "Paragraph stress",
  "Glyph coverage",
] as const;

export function scenarioById(id: string): BenchmarkScenario {
  return scenarios.find((scenario) => scenario.id === id) ?? scenarios[0]!;
}
