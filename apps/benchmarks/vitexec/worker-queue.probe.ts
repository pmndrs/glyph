const evidencePath = '/src/benchmark/worker-queue-evidence.ts';
const { measureWorkerQueue } = await import(/* @vite-ignore */ evidencePath);

console.log('worker-queue-ready', JSON.stringify(await measureWorkerQueue()));

export {};
