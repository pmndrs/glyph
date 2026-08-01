import { parentPort, workerData } from 'node:worker_threads';

if (parentPort === null) throw new TypeError('Node Web Worker bootstrap requires a parent port');
if (typeof workerData?.workerUrl !== 'string') throw new TypeError('Node Web Worker bootstrap requires a worker URL');

const listeners = [];
const pending = [];
parentPort.on('message', (data) => {
  if (listeners.length === 0) pending.push(data);
  else dispatch(data);
});

globalThis.addEventListener = (type, listener) => {
  if (type !== 'message' || typeof listener !== 'function') return;
  listeners.push(listener);
  for (const data of pending.splice(0)) dispatch(data);
};
globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);

await import(workerData.workerUrl);

function dispatch(data) {
  for (const listener of listeners) listener({ data });
}
