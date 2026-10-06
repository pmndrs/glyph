//! Native driver for the variable-font band study.
//!
//!   bandcheck check <data.vfb> <out.json> [--stride-samples K] [--grid N] [--threads T] [--bytes <dir>]
//!       Every strategy at every location it applies to: structural checks on every glyph (missing references,
//!       sort inversions against the instanced maxima, stored-key violations, ink outside the partition, lists over
//!       the shader's 512 cap) and an emulated-shader sample test on every K-th glyph (N x N samples per glyph, both
//!       band axes, at 64 and 4096 pixels per em) comparing each traversal with the all-curves ground truth.
//!       With --bytes, also writes the band tables of every pre-baked strategy for size measurement.
//!   bandcheck time <data.vfb> <subset 0|1|254|255> <spec> <locA> <locB>
//!       Native medians of the same steps bench.mjs times in Wasm.
use bandlab::*;
use pmndrs_glyph_slug_core::Quadratic;
use std::collections::BTreeMap;
use std::io::Write;
use std::{env, fs, time::Instant};

#[derive(Clone, Default)]
struct M {
    evals: u64,
    bands: u64,
    refs: u64,
    maxref: u64,
    miss: u64,
    inv_pairs: u64,
    inv_bands: u64,
    keyviol: u64,
    outside: u64,
    over512: u64,
    bad_glyphs: u64,
    samples: u64,
    mis64: u64,
    mis4k: u64,
    iters64: u64,
    max_err: f64,
}
impl M {
    fn add(&mut self, o: &M) {
        self.evals += o.evals;
        self.bands += o.bands;
        self.refs += o.refs;
        self.maxref = self.maxref.max(o.maxref);
        self.miss += o.miss;
        self.inv_pairs += o.inv_pairs;
        self.inv_bands += o.inv_bands;
        self.keyviol += o.keyviol;
        self.outside += o.outside;
        self.over512 += o.over512;
        self.bad_glyphs += o.bad_glyphs;
        self.samples += o.samples;
        self.mis64 += o.mis64;
        self.mis4k += o.mis4k;
        self.iters64 += o.iters64;
        self.max_err = self.max_err.max(o.max_err);
    }
    fn json(&self) -> String {
        format!(
            "{{\"evals\":{},\"bands\":{},\"refs\":{},\"mean_refs\":{:.4},\"max_refs\":{},\"miss\":{},\"inv_pairs\":{},\"inv_bands\":{},\"keyviol\":{},\"outside\":{},\"over512\":{},\"bad_glyphs\":{},\"samples\":{},\"mis64\":{},\"mis4096\":{},\"iters_per_sample_band\":{:.4},\"max_cov_err\":{:.4}}}",
            self.evals,
            self.bands,
            self.refs,
            self.refs as f64 / self.bands.max(1) as f64,
            self.maxref,
            self.miss,
            self.inv_pairs,
            self.inv_bands,
            self.keyviol,
            self.outside,
            self.over512,
            self.bad_glyphs,
            self.samples,
            self.mis64,
            self.mis4k,
            self.iters64 as f64 / self.samples.max(1) as f64,
            self.max_err
        )
    }
}

struct Samples {
    pts: Vec<[f32; 2]>,
    /// [axis][ppem] per sample
    truth: Vec<[[f32; 2]; 2]>,
}
const PPEM: [f32; 2] = [64.0, 4096.0];

fn samples(q: &[Quadratic], n: usize) -> Samples {
    let b = exact_bounds(q);
    let mut pts = Vec::new();
    for i in 0..n {
        for j in 0..n {
            let fx = (i as f32 + 0.381_966) / n as f32;
            let fy = (j as f32 + 0.618_034) / n as f32;
            pts.push([b[0] + (b[2] - b[0]) * fx, b[1] + (b[3] - b[1]) * fy]);
        }
    }
    let truth = pts
        .iter()
        .map(|&s| {
            let mut t = [[0f32; 2]; 2];
            for (ai, ax) in [Ax::H, Ax::V].into_iter().enumerate() {
                for (pi, &p) in PPEM.iter().enumerate() {
                    t[ai][pi] = eval_all(q, s, ax, p);
                }
            }
            t
        })
        .collect();
    Samples { pts, truth }
}

/// Every check for one band set at one instance. `keys`: stored per-curve keys for Exit::Key.
fn evaluate(set: &Set, q: &[Quadratic], hull: &[[f32; 4]], exit: Exit, keys: Option<&[[f32; 4]]>, smp: Option<&Samples>) -> M {
    let mut m = M { evals: 1, ..M::default() };
    let n = q.len();
    let mut member = vec![0u32; n];
    for (ax, csr) in [(Ax::H, &set.h), (Ax::V, &set.v)] {
        member.iter_mut().for_each(|x| *x = 0);
        for b in 0..NB {
            let list = csr.band(b);
            m.bands += 1;
            m.refs += list.len() as u64;
            m.maxref = m.maxref.max(list.len() as u64);
            if list.len() > 512 {
                m.over512 += 1;
            }
            for &c in list {
                member[c as usize] |= 1 << b;
            }
            let mut inv = 0;
            for w in list.windows(2) {
                if ax.key(&hull[w[1] as usize]) > ax.key(&hull[w[0] as usize]) {
                    inv += 1;
                }
            }
            m.inv_pairs += inv;
            m.inv_bands += (inv > 0) as u64;
            if let Some(k) = keys {
                for &c in list {
                    if ax.key(&k[c as usize]) < ax.key(&hull[c as usize]) {
                        m.keyviol += 1;
                    }
                }
            }
        }
        let (bmin, bmax) = ax.range(&set.b);
        if bmax - bmin > 0.0 {
            let size = (bmax - bmin) / NB as f32;
            for (c, h) in hull.iter().enumerate() {
                let (lo, hi) = ax.lohi(h);
                if let Some((s, e)) = span(lo, hi, bmin, size) {
                    let want = ((1u64 << (e + 1)) - (1u64 << s)) as u32;
                    m.miss += u64::from((want & !member[c]).count_ones());
                }
            }
        }
    }
    let ib = exact_bounds(q);
    if ib[0] < set.b[0] - 1e-6 || ib[1] < set.b[1] - 1e-6 || ib[2] > set.b[2] + 1e-6 || ib[3] > set.b[3] + 1e-6 {
        m.outside += 1;
    }
    if let Some(sm) = smp {
        for (si, &s) in sm.pts.iter().enumerate() {
            for (ai, (ax, csr)) in [(Ax::H, &set.h), (Ax::V, &set.v)].into_iter().enumerate() {
                let list = csr.band(band_of(set, s, ax));
                m.samples += 1;
                for (pi, &p) in PPEM.iter().enumerate() {
                    let (cov, it) = eval_band(list, q, s, ax, p, exit, keys);
                    let err = (cov - sm.truth[si][ai][pi]).abs();
                    m.max_err = m.max_err.max(f64::from(err));
                    if err > 1e-4 {
                        if pi == 0 { m.mis64 += 1 } else { m.mis4k += 1 }
                    }
                    if pi == 0 {
                        m.iters64 += u64::from(it);
                    }
                }
            }
        }
    }
    let bad = m.miss + m.over512 + m.outside + m.mis64 + m.mis4k + if exit == Exit::Actual { m.inv_pairs } else { 0 } + m.keyviol;
    m.bad_glyphs = (bad > 0) as u64;
    m
}

fn spec_name(f: &Font, p: usize) -> String {
    let k = f.specs[p].kind;
    match k {
        0 => "all".into(),
        1 => "wght".into(),
        2 => "wght+wdth".into(),
        _ => format!("cell{p}"),
    }
}

fn nearest(f: &Font, from: &[usize], li: usize) -> usize {
    let n = &f.locs[li].norm;
    *from
        .iter()
        .min_by(|a, b| {
            let d = |k: usize| f.locs[k].norm.iter().zip(n).map(|(x, y)| (x - y) * (x - y)).sum::<f32>();
            d(**a).total_cmp(&d(**b))
        })
        .unwrap()
}

type Acc = BTreeMap<(String, usize), M>;

struct Extra {
    fast_vs_slug_mismatch: u64,
    hint_vs_slug_mismatch: u64,
    fixed_vs_5c_mismatch: u64,
    glyph_locs: u64,
}

fn write_table(out: &mut Vec<u8>, s: &Set) {
    let mut off = 0u32;
    for csr in [&s.h, &s.v] {
        for b in 0..NB {
            let n = csr.band(b).len() as u32;
            out.extend_from_slice(&((n << 16) | (off & 0xffff)).to_le_bytes());
            off += n;
        }
    }
    for csr in [&s.h, &s.v] {
        for &r in &csr.refs {
            out.extend_from_slice(&r.to_le_bytes());
        }
    }
}

fn run_glyphs(f: &Font, glyphs: &[usize], sample_stride: usize, grid: usize, bytes: bool) -> (Acc, Extra, BTreeMap<String, Vec<u8>>) {
    let mut acc: Acc = BTreeMap::new();
    let mut ex = Extra { fast_vs_slug_mismatch: 0, hint_vs_slug_mismatch: 0, fixed_vs_5c_mismatch: 0, glyph_locs: 0 };
    let mut tabs: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let named: Vec<usize> = (0..f.locs.len()).filter(|&i| f.locs[i].kind == 1).collect();
    let peaks: Vec<usize> = (0..f.locs.len()).filter(|&i| f.locs[i].kind == 2 || f.locs[i].kind == 0).collect();
    let base_specs: Vec<usize> = (0..f.specs.len()).filter(|&p| f.specs[p].kind <= 2).collect();
    let cells: Vec<usize> = (0..f.specs.len()).filter(|&p| f.specs[p].kind == 3).collect();
    let (mut pts, mut q, mut h, mut fs, mut tmp, mut lh) = (Vec::new(), Vec::new(), Vec::new(), Set::default(), Set::default(), Vec::new());
    for &g in glyphs {
        if f.glyphs[g].is_empty() {
            continue;
        }
        let t = topology(f, g);
        if t.curves.is_empty() {
            continue;
        }
        let at = |li: usize, pts: &mut Vec<[f32; 2]>, q: &mut Vec<Quadratic>, h: &mut Vec<[f32; 4]>| {
            instance(f, g, &f.locs[li].scalars, pts);
            curves(&t, pts, f.upm, q);
            hulls(q, h);
        };
        let cons: Vec<Cons> = (0..f.specs.len()).map(|p| conservative(f, g, &t, &f.specs[p])).collect();
        let mut exact_at = BTreeMap::new();
        for &li in named.iter().chain(&peaks) {
            at(li, &mut pts, &mut q, &mut h);
            exact_at.insert(li, exact_slug(&q));
        }
        let lin = lin_data(f, g, &t);
        at(0, &mut pts, &mut q, &mut h);
        let (oh, ov) = (order_hint(&h, Ax::H), order_hint(&h, Ax::V));
        if bytes {
            write_table(tabs.entry("static-default".into()).or_default(), &exact_at[&0]);
            for &p in base_specs.iter().chain(&cells) {
                write_table(tabs.entry(format!("cons-{}", spec_name(f, p))).or_default(), &cons[p].set);
            }
            for &li in &named {
                write_table(tabs.entry("named-all".into()).or_default(), &exact_at[&li]);
            }
            for &li in &peaks {
                write_table(tabs.entry("peaks-all".into()).or_default(), &exact_at[&li]);
            }
            let upm = f.upm;
            for &p in &base_specs {
                // 5(a): integer conservative boxes (font units, before the bow pad) + per-axis pre-sorted order
                let pre = presort(&cons[p]);
                let o = tabs.entry(format!("5a-{}", spec_name(f, p))).or_default();
                for bx in &pre.boxes {
                    for (k, v) in bx.iter().enumerate() {
                        let fu = if k % 2 == 0 { (v * upm).floor() } else { (v * upm).ceil() };
                        o.extend_from_slice(&(fu as i16).to_le_bytes());
                    }
                }
                for &c in pre.order_h.iter().chain(&pre.order_v) {
                    o.extend_from_slice(&c.to_le_bytes());
                }
                // stored keys a key-exit shader would read: conservative max x / max y per curve
                let o = tabs.entry(format!("keys-{}", spec_name(f, p))).or_default();
                for bx in &cons[p].boxes {
                    o.extend_from_slice(&((bx[1] * upm).ceil() as i16).to_le_bytes());
                    o.extend_from_slice(&((bx[3] * upm).ceil() as i16).to_le_bytes());
                }
            }
            let o = tabs.entry("5b-linear".into()).or_default();
            o.push(lin.regions.len() as u8);
            for r in &lin.regions {
                o.push(*r as u8);
            }
            for d in &lin.d {
                for v in d {
                    o.extend_from_slice(&(*v as i16).to_le_bytes());
                }
            }
        }
        let sampled = g % sample_stride == 0;
        for li in 0..f.locs.len() {
            at(li, &mut pts, &mut q, &mut h);
            ex.glyph_locs += 1;
            let smp = if sampled { Some(samples(&q, grid)) } else { None };
            let sm = smp.as_ref();
            let mut put = |name: String, m: M| acc.entry((name, li)).or_default().add(&m);
            // S1: exact rebuild, and the CSR builder against slug-core
            let slug = exact_slug(&q);
            exact_fast(&q, &h, &mut fs);
            if fs.h != slug.h || fs.v != slug.v || fs.b != slug.b {
                ex.fast_vs_slug_mismatch += 1;
            }
            exact_hint(&q, &h, &oh, &ov, &mut fs);
            if fs.h != slug.h || fs.v != slug.v || fs.b != slug.b {
                ex.hint_vs_slug_mismatch += 1;
            }
            put("S1 exact rebuild".into(), evaluate(&slug, &q, &h, Exit::Actual, None, sm));
            put("S0 default-instance bake".into(), evaluate(&exact_at[&0], &q, &h, Exit::Actual, None, sm));
            for &p in &base_specs {
                if !in_spec(&f.locs[li], &f.specs[p]) {
                    continue;
                }
                let sn = spec_name(f, p);
                let c = &cons[p];
                put(format!("S2/S3 cons[{sn}] today's shader"), evaluate(&c.set, &q, &h, Exit::Actual, None, sm));
                put(format!("S2/S3 cons[{sn}] key-exit shader"), evaluate(&c.set, &q, &h, Exit::Key, Some(&c.boxes), sm));
                put(format!("S2/S3 cons[{sn}] no early exit"), evaluate(&c.set, &q, &h, Exit::None, None, sm));
                tmp.clone_from(&c.set);
                resort(&mut tmp, &h);
                put(format!("S2/S3 cons[{sn}] + resort"), evaluate(&tmp, &q, &h, Exit::Actual, None, sm));
                filter(&c.set, &h, true, &mut tmp);
                put(format!("5c filter[{sn}] + sort"), evaluate(&tmp, &q, &h, Exit::Actual, None, sm));
                // d2: exact bin into the fixed partition must give the same lists (as sets) as 5c
                let mut fx = Set { b: c.set.b, ..Set::default() };
                bin_sort(&h, None, &c.set.b, Ax::H, true, &mut fx.h);
                bin_sort(&h, None, &c.set.b, Ax::V, true, &mut fx.v);
                for (a, b) in [(&fx.h, &tmp.h), (&fx.v, &tmp.v)] {
                    for k in 0..NB {
                        let (mut x, mut y) = (a.band(k).to_vec(), b.band(k).to_vec());
                        x.sort_unstable();
                        y.sort_unstable();
                        if x != y {
                            ex.fixed_vs_5c_mismatch += 1;
                        }
                    }
                }
                filter(&c.set, &h, false, &mut tmp);
                put(format!("5c filter[{sn}] keep bake order"), evaluate(&tmp, &q, &h, Exit::Actual, None, sm));
            }
            if !named.is_empty() {
                let k = nearest(f, &named, li);
                put("S4 nearest named instance".into(), evaluate(&exact_at[&k], &q, &h, Exit::Actual, None, sm));
            }
            let k = nearest(f, &peaks, li);
            put("S4 nearest region peak/default".into(), evaluate(&exact_at[&k], &q, &h, Exit::Actual, None, sm));
            if let Some(&p) = cells.iter().find(|&&p| in_spec(&f.locs[li], &f.specs[p])) {
                put("S4b enclosing wght cell, today's shader".into(), evaluate(&cons[p].set, &q, &h, Exit::Actual, None, sm));
                tmp.clone_from(&cons[p].set);
                resort(&mut tmp, &h);
                put("S4b enclosing wght cell + resort".into(), evaluate(&tmp, &q, &h, Exit::Actual, None, sm));
            }
            lin_hulls(&lin, &f.locs[li].scalars, f.upm, &mut lh);
            lin_build(&lh, &mut tmp);
            put("5b linear bounds, key-exit shader".into(), evaluate(&tmp, &q, &h, Exit::Key, Some(&lh), sm));
            put("5b linear bounds, today's shader".into(), evaluate(&tmp, &q, &h, Exit::Actual, None, sm));
        }
    }
    (acc, ex, tabs)
}

fn check(args: &[String]) {
    let path = &args[0];
    let out = &args[1];
    let mut stride = 1usize;
    let mut grid = 6usize;
    let mut threads = 4usize;
    let mut bytes: Option<String> = None;
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--stride-samples" => stride = args[i + 1].parse().unwrap(),
            "--grid" => grid = args[i + 1].parse().unwrap(),
            "--threads" => threads = args[i + 1].parse().unwrap(),
            "--bytes" => bytes = Some(args[i + 1].clone()),
            a => panic!("unknown {a}"),
        }
        i += 2;
    }
    let buf = fs::read(path).unwrap();
    let f = parse(&buf);
    let t0 = Instant::now();
    let all: Vec<usize> = (0..f.glyphs.len()).collect();
    let chunks: Vec<Vec<usize>> = (0..threads).map(|k| all.iter().copied().filter(|g| g % threads == k).collect()).collect();
    let res: Vec<(Acc, Extra, BTreeMap<String, Vec<u8>>)> = std::thread::scope(|s| {
        let hs: Vec<_> = chunks.iter().map(|c| s.spawn(|| run_glyphs(&f, c, stride, grid, bytes.is_some()))).collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let mut acc: Acc = BTreeMap::new();
    let mut tabs: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let (mut m1, mut m2, mut m3, mut gl) = (0, 0, 0, 0);
    for (a, e, t) in res {
        for (k, v) in a {
            acc.entry(k).or_default().add(&v);
        }
        m1 += e.fast_vs_slug_mismatch;
        m3 += e.hint_vs_slug_mismatch;
        m2 += e.fixed_vs_5c_mismatch;
        gl += e.glyph_locs;
        for (k, v) in t {
            tabs.entry(k).or_default().extend_from_slice(&v);
        }
    }
    // per strategy: totals over the locations it applies to, plus the worst location
    let mut per: BTreeMap<String, (M, usize, u64, usize)> = BTreeMap::new();
    for ((name, li), m) in &acc {
        let e = per.entry(name.clone()).or_insert((M::default(), 0, 0, 0));
        e.0.add(m);
        e.1 += 1;
        if m.bad_glyphs > e.2 {
            e.2 = m.bad_glyphs;
            e.3 = *li;
        }
    }
    let mut o = fs::File::create(out).unwrap();
    writeln!(o, "{{\"file\":\"{path}\",\"glyph_locations\":{gl},\"fast_vs_slug_mismatch\":{m1},\"hint_vs_slug_mismatch\":{m3},\"fixed_vs_5c_band_mismatch\":{m2},\"sample_stride\":{stride},\"grid\":{grid},\"seconds\":{:.1},\"strategies\":{{", t0.elapsed().as_secs_f64()).unwrap();
    let n = per.len();
    for (k, (name, (m, locs, worst, wl))) in per.iter().enumerate() {
        writeln!(o, "\"{name}\":{{\"locations\":{locs},\"worst_bad_glyphs\":{worst},\"worst_location\":{wl},\"total\":{}}}{}", m.json(), if k + 1 < n { "," } else { "" }).unwrap();
    }
    writeln!(o, "}},\"per_location\":[").unwrap();
    let n = acc.len();
    for (k, ((name, li), m)) in acc.iter().enumerate() {
        writeln!(o, "{{\"s\":\"{name}\",\"loc\":{li},\"m\":{}}}{}", m.json(), if k + 1 < n { "," } else { "" }).unwrap();
    }
    writeln!(o, "]}}").unwrap();
    if let Some(dir) = bytes {
        fs::create_dir_all(&dir).unwrap();
        for (k, v) in &tabs {
            fs::write(format!("{dir}/{k}.bin"), v).unwrap();
        }
    }
    println!("{path}: {gl} glyph-locations in {:.1} s; fast-vs-slug mismatches {m1}; hint-vs-slug {m3}; fixed-vs-5c band mismatches {m2}", t0.elapsed().as_secs_f64());
    for (name, (m, locs, worst, _)) in &per {
        println!(
            "{name:44} locs {locs:3} mean {:6.2} max {:4} miss {:7} inv {:8} keyv {:5} out {:4} bad-worst {:5} mis64 {:6} mis4k {:6} iters {:6.2}",
            m.refs as f64 / m.bands.max(1) as f64,
            m.maxref,
            m.miss,
            m.inv_pairs,
            m.keyviol,
            m.outside,
            worst,
            m.mis64,
            m.mis4k,
            m.iters64 as f64 / m.samples.max(1) as f64
        );
    }
}

fn median_us(mut f: impl FnMut() -> u64, glyphs: usize) -> f64 {
    let mut reps = 1;
    loop {
        let t = Instant::now();
        for _ in 0..reps {
            std::hint::black_box(f());
        }
        if t.elapsed().as_secs_f64() > 0.02 || reps > 1 << 20 {
            break;
        }
        reps *= 2;
    }
    let mut v: Vec<f64> = (0..9)
        .map(|_| {
            let t = Instant::now();
            for _ in 0..reps {
                std::hint::black_box(f());
            }
            t.elapsed().as_secs_f64() / reps as f64
        })
        .collect();
    v.sort_by(|a, b| a.total_cmp(b));
    v[4] * 1e6 / glyphs as f64
}

fn time(args: &[String]) {
    let buf = fs::read(&args[0]).unwrap();
    let f = parse(&buf);
    let subset: usize = args[1].parse().unwrap();
    let spec: usize = args[2].parse().unwrap();
    let la: usize = args[3].parse().unwrap();
    let lb: usize = args[4].parse().unwrap();
    let glyphs: Vec<usize> = match subset {
        255 => (0..f.glyphs.len()).collect(),
        254 => (0..f.glyphs.len()).step_by(f.glyphs.len().div_ceil(5000)).collect(),
        s => f.subsets[s].iter().map(|&g| g as usize).collect(),
    };
    let mut b = Bench::new(&f, glyphs, spec, [la, lb]);
    let n = b.glyphs.len();
    let mut slot = 0;
    let steps: [(&str, u32); 13] = [
        ("instance", 0),
        ("curves", 1),
        ("hulls", 2),
        ("s1_slug", 3),
        ("s1_fast", 4),
        ("s2_load", 5),
        ("5a_bin", 6),
        ("resort", 7),
        ("5c_filter_sort", 8),
        ("5c_filter_only", 9),
        ("fixed_exact", 10),
        ("5b_linear", 11),
        ("s1_hint", 12),
    ];
    print!("{{\"glyphs\":{n},\"curves\":{},\"us_per_glyph\":{{", b.curve_count());
    for (k, (name, id)) in steps.iter().enumerate() {
        let us = median_us(
            || {
                slot ^= 1;
                match id {
                    0 => b.t_instance(&f, slot),
                    1 => b.t_curves(&f, slot),
                    2 => b.t_hulls(slot),
                    3 => b.t_s1_slug(slot),
                    4 => b.t_s1_fast(slot),
                    5 => b.t_s2_load(&f),
                    6 => b.t_5a(),
                    7 => b.t_resort(slot),
                    8 => b.t_5c(slot, true),
                    9 => b.t_5c(slot, false),
                    10 => b.t_fixed_exact(slot),
                    11 => b.t_5b(&f, slot),
                    _ => b.t_s1_hint(slot),
                }
            },
            n,
        );
        print!("\"{name}\":{us:.4}{}", if k + 1 < steps.len() { "," } else { "" });
    }
    println!("}}}}");
}

fn main() {
    let a: Vec<String> = env::args().skip(1).collect();
    match a[0].as_str() {
        "check" => check(&a[1..]),
        "time" => time(&a[1..]),
        "dump" => {
            // dump <vfb> <scalars.f32> <out.bin>: decomposed instanced points (i16 x, y) of every glyph at each
            // scalar vector in the file (R f32 per location), for verify_instancer.py
            let buf = fs::read(&a[1]).unwrap();
            let f = parse(&buf);
            let raw = fs::read(&a[2]).unwrap();
            let sc: Vec<f32> = raw.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
            let mut o = Vec::new();
            let mut p = Vec::new();
            for loc in sc.chunks_exact(f.regions) {
                for g in 0..f.glyphs.len() {
                    instance(&f, g, loc, &mut p);
                    o.extend_from_slice(&(p.len() as u32).to_le_bytes());
                    for v in &p {
                        o.extend_from_slice(&(v[0] as i16).to_le_bytes());
                        o.extend_from_slice(&(v[1] as i16).to_le_bytes());
                    }
                }
            }
            fs::write(&a[3], o).unwrap();
        }
        x => panic!("unknown command {x}"),
    }
}
