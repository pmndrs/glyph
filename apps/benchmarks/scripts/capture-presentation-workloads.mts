process.env.PRESENTATION_BACKEND = 'webgpu';
process.env.PRESENTATION_TECHNIQUE = 'mtsdf';
process.env.PRESENTATION_SCREENSHOT_DIR ??= './.cache/presentation-screenshots';

await import('./run-presentation-workload-probe.mts');
