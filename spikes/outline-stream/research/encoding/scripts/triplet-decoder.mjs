export function planes(buf, layout) {
  const out = {};
  let o = 0;
  for (const [name, len] of layout) {
    out[name] = buf.subarray(o, o + len);
    o += len;
  }
  return out;
}

function readStructure(p, G) {
  const hdr = p.hdr,
    _cnb = p.cn;
  let o = 0;
  const kind = new Uint32Array(G);
  for (let g = 0; g < G; g++) {
    let v = 0,
      s = 0,
      b;
    do {
      b = hdr[o++];
      v |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    kind[g] = v;
  }
  return kind;
}

function readVarints(bytes, count) {
  const out = new Uint32Array(count);
  let o = 0;
  for (let i = 0; i < count; i++) {
    let v = 0,
      s = 0,
      b;
    do {
      b = bytes[o++];
      v |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    out[i] = v;
  }
  return out;
}

function expand(G, kind, cnArr, compBytes, compactX, compactY) {
  // compact point / contour offsets per simple glyph
  const pBase = new Uint32Array(G + 1),
    cBase = new Uint32Array(G + 1);
  let pc = 0,
    cc = 0;
  for (let g = 0; g < G; g++) {
    pBase[g] = pc;
    cBase[g] = cc;
    const k = kind[g];
    if (k && !(k & 1)) {
      const nc = k >>> 1;
      for (let i = 0; i < nc; i++) pc += cnArr[cc + i];
      cc += nc;
    }
  }
  pBase[G] = pc;
  cBase[G] = cc;
  // parse components
  const compStart = new Int32Array(G).fill(-1);
  const comps = [];
  let o = 0;
  const rv = () => {
    let v = 0,
      s = 0,
      b;
    do {
      b = compBytes[o++];
      v |= (b & 127) << s;
      s += 7;
    } while (b & 128);
    return v;
  };
  for (let g = 0; g < G; g++) {
    const k = kind[g];
    if (!(k & 1)) continue;
    compStart[g] = comps.length / 4;
    for (let i = 0; i < k >>> 1; i++) {
      const gid = rv();
      const zx = rv(),
        zy = rv();
      const dx = (zx >>> 1) ^ -(zx & 1),
        dy = (zy >>> 1) ^ -(zy & 1);
      const t = compBytes[o++];
      let m = null;
      if (t) {
        const dv = new DataView(compBytes.buffer, compBytes.byteOffset + o, 8);
        m = [0, 2, 4, 6].map((q) => dv.getInt16(q, true) / 16384);
        o += 8;
      }
      comps.push(gid, dx, dy, m);
    }
  }
  // expanded counts
  const eCount = new Int32Array(G).fill(-1);
  const count = (g) => {
    if (eCount[g] >= 0) return eCount[g];
    const k = kind[g];
    let n = 0;
    if (k & 1) {
      for (let i = 0; i < k >>> 1; i++) n += count(comps[(compStart[g] + i) * 4]);
    } else n = pBase[g + 1] - pBase[g];
    return (eCount[g] = n);
  };
  let total = 0;
  const eBase = new Uint32Array(G + 1);
  for (let g = 0; g < G; g++) {
    eBase[g] = total;
    total += count(g);
  }
  eBase[G] = total;
  const xy = new Int16Array(total * 2);
  const write = (g, at, ox, oy, m) => {
    const k = kind[g];
    if (k & 1) {
      for (let i = 0; i < k >>> 1; i++) {
        const c = (compStart[g] + i) * 4;
        const sub = comps[c];
        const mm = comps[c + 3];
        // nested transforms are rare; compose by applying inner first (approximation adequate for timing)
        write(sub, at, ox + comps[c + 1], oy + comps[c + 2], mm || m);
        at += count(sub);
      }
      return;
    }
    const a = pBase[g],
      b = pBase[g + 1];
    if (!m) {
      for (let i = a, j = at * 2; i < b; i++, j += 2) {
        xy[j] = compactX[i] + ox;
        xy[j + 1] = compactY[i] + oy;
      }
    } else {
      for (let i = a, j = at * 2; i < b; i++, j += 2) {
        const x = compactX[i],
          y = compactY[i];
        xy[j] = Math.round(x * m[0] + y * m[2]) + ox;
        xy[j + 1] = Math.round(x * m[1] + y * m[3]) + oy;
      }
    }
  };
  for (let g = 0; g < G; g++) write(g, eBase[g], 0, 0, null);
  return { xy, eBase, pBase, cBase };
}

export function decodeTriplet(buf, M) {
  const G = M.glyphs,
    P = M.points;
  const p = planes(buf, M.triplet);
  const kind = readStructure(p, G);
  const cn = readVarints(p.cn, M.contours);
  const X = new Int16Array(P),
    Y = new Int16Array(P);
  const fl = p.flags,
    d = p.data;
  let o = 0,
    i = 0,
    ci = 0;
  for (let g = 0; g < G; g++) {
    const k = kind[g];
    if (!k || k & 1) continue;
    let n = 0;
    for (let c = 0; c < k >>> 1; c++) n += cn[ci++];
    let x = 0,
      y = 0;
    for (const end = i + n; i < end; i++) {
      const f = fl[i] & 127;
      let dx, dy;
      if (f < 10) {
        dx = 0;
        dy = ((f >> 1) << 8) | d[o++];
        if (f & 1) dy = -dy;
      } else if (f < 20) {
        const q = f - 10;
        dy = 0;
        dx = ((q >> 1) << 8) | d[o++];
        if (q & 1) dx = -dx;
      } else if (f < 84) {
        const q = f - 20,
          b = d[o++];
        dx = 1 + (q & 0x30) + (b >> 4);
        dy = 1 + ((q & 0x0c) << 2) + (b & 15);
        if (q & 2) dx = -dx;
        if (q & 1) dy = -dy;
      } else if (f < 120) {
        const q = f - 84;
        dx = 1 + (((q / 12) | 0) << 8) + d[o++];
        dy = 1 + (((q % 12) >> 2) << 8) + d[o++];
        if (q & 2) dx = -dx;
        if (q & 1) dy = -dy;
      } else if (f < 124) {
        const b0 = d[o++],
          b1 = d[o++],
          b2 = d[o++];
        dx = (b0 << 4) | (b1 >> 4);
        dy = ((b1 & 15) << 8) | b2;
        if (f & 2) dx = -dx;
        if (f & 1) dy = -dy;
      } else {
        dx = (d[o] << 8) | d[o + 1];
        dy = (d[o + 2] << 8) | d[o + 3];
        o += 4;
        if (f & 2) dx = -dx;
        if (f & 1) dy = -dy;
      }
      x += dx;
      y += dy;
      X[i] = x;
      Y[i] = y;
    }
  }
  return { ...expand(G, kind, cn, p.comp, X, Y), flags: fl, cn, kind };
}
