// Counts calls into the text-shaper Wasm module and optionally caps its linear memory.
//
// Import this module before `glyph.init()`. The wrapper stays installed for the life of the
// process so an engine that re-instantiates its module keeps being counted.

const PREFIX = 'pmndrs_glyph_';
/** Exports that move no engine state: arena lookups and allocation. */
const BOOKKEEPING = /alloc|request_ptr|capacity|_ptr$|_len$|_count$|abi_version/;
/** One-time registration and arena growth, which a budget of steady operations leaves out. */
const SETUP = /register_|create_root|reserve_|shaper_initialize/;

const calls = new Map();
const lastArguments = new Map();
let failNext;
let instances = 0;
let memory;

const instantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async (source, imports) => {
  const result = await instantiate(source, imports);
  const instance = result instanceof WebAssembly.Instance ? result : result.instance;
  if (!(`${PREFIX}shaper_abi_version` in instance.exports)) return result;
  instances += 1;
  memory = instance.exports.memory;
  const exports = {};
  for (const [name, value] of Object.entries(instance.exports)) {
    if (typeof value !== 'function') {
      exports[name] = value;
      continue;
    }
    const short = name.replace(PREFIX, '');
    exports[name] = (...args) => {
      calls.set(short, (calls.get(short) ?? 0) + 1);
      lastArguments.set(short, args);
      if (failNext !== undefined && failNext.test(short)) {
        failNext = undefined;
        throw new WebAssembly.RuntimeError('unreachable');
      }
      return value(...args);
    };
  }
  return result instanceof WebAssembly.Instance ? { exports } : { module: result.module, instance: { exports } };
};

/** A snapshot to pass to `crossingsSince`. */
export function crossingSnapshot() {
  return new Map(calls);
}

/** Engine crossings since `snapshot`, by short export name, without arena bookkeeping or one-time setup. */
export function crossingsSince(snapshot, { setup = false } = {}) {
  const difference = {};
  for (const [name, count] of calls) {
    const delta = count - (snapshot.get(name) ?? 0);
    if (delta !== 0 && !BOOKKEEPING.test(name) && (setup || !SETUP.test(name))) difference[name] = delta;
  }
  return difference;
}

/** Runs `operation` and returns the engine crossings it made. */
export function crossingsOf(operation) {
  const snapshot = crossingSnapshot();
  operation();
  return crossingsSince(snapshot);
}

/** The arguments of the most recent call to one export, by short name. */
export function lastCallArguments(name) {
  return lastArguments.get(name);
}

/** Makes the next call to an export matching `pattern` trap as a panic in shipped Wasm does. */
export function trapNextCall(pattern) {
  failNext = pattern;
}

/** How many shaper modules have been instantiated in this process. */
export function shaperInstanceCount() {
  return instances;
}

/** Linear-memory pages of the most recently instantiated shaper. */
export function shaperMemoryPages() {
  return memory.buffer.byteLength / 65_536;
}

/** Rewrites a Wasm module's memory section so its linear memory cannot grow past `maxPages`. */
export function capWasmMemory(bytes, maxPages) {
  let offset = 8;
  const leb = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[offset++];
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return result >>> 0;
  };
  const encode = (value) => {
    const out = [];
    do {
      let byte = value & 0x7f;
      value >>>= 7;
      if (value) byte |= 0x80;
      out.push(byte);
    } while (value);
    return out;
  };
  while (offset < bytes.length) {
    const sectionStart = offset;
    const id = bytes[offset++];
    const size = leb();
    const body = offset;
    const end = body + size;
    if (id === 5) {
      offset = body;
      leb();
      leb();
      const minimum = leb();
      const content = [1, 1, ...encode(minimum), ...encode(maxPages)];
      return Buffer.concat([
        bytes.subarray(0, sectionStart),
        Buffer.from([5, ...encode(content.length), ...content]),
        bytes.subarray(end),
      ]);
    }
    offset = end;
  }
  throw new Error('Wasm module has no memory section');
}
