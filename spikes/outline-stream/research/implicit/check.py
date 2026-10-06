import numpy as np
rng = np.random.default_rng(1)

def coeffs(p0, p1, p2, dt):
    (x0, y0), (x1, y1), (x2, y2) = [np.asarray(p, dt) for p in (p0, p1, p2)]
    d = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1)
    A = y0 - 2 * y1 + y2
    B = 2 * x1 - x0 - x2
    C = x0 * y2 - x2 * y0 + 2 * (x1 * y0 - x0 * y1)
    D = 4 * (y0 - y1) * d
    E = 4 * (x1 - x0) * d
    F = 4 * (x0 * y1 - y0 * x1) * d
    return A, B, C, D, E, F

def implicit(c, x, y):
    A, B, C, D, E, F = c
    return (A * x + B * y + C) ** 2 - (D * x + E * y + F)

def curve(p0, p1, p2, t):
    p0, p1, p2 = map(np.asarray, (p0, p1, p2))
    return ((1 - t) ** 2)[:, None] * p0 + (2 * (1 - t) * t)[:, None] * p1 + (t ** 2)[:, None] * p2

t = np.linspace(0, 1, 101)
# 1) Is F zero on the curve? (float64, small integer coordinates)
worst = 0
for _ in range(1000):
    p = rng.integers(-50, 50, (3, 2)).astype(float)
    pts = curve(*p, t)
    c = coeffs(*p, np.float64)
    scale = max(1.0, max(abs(v) for v in c))
    worst = max(worst, np.max(np.abs(implicit(c, pts[:, 0], pts[:, 1]))) / scale ** 2)
print(f"as posted, float64, |F on curve| / coeff^2 worst = {worst:.3e}")

# Reference implicitization: F = (A x + B y + C)^2 - k * (cross-product line), solved generally.
def reference(p0, p1, p2):
    # Fit the conic through exact symbolic form: resultant-based implicit of the quadratic Bezier.
    (x0, y0), (x1, y1), (x2, y2) = p0, p1, p2
    ax, ay = x0 - 2 * x1 + x2, y0 - 2 * y1 + y2      # t^2 coefficient
    bx, by = 2 * (x1 - x0), 2 * (y1 - y0)            # t coefficient
    # Point - P0 = a t^2 + b t.  Let u = cross(a, q), v = cross(b, q) with q = (x - x0, y - y0).
    # cross(a, q) = t * cross(a, b)  and cross(q, b) = t^2 * cross(a, b)  =>  (cross(q,a))^2 = cross(a,b) * cross(q,b)... check numerically.
    return ax, ay, bx, by

worst_ref = 0
for _ in range(1000):
    p = rng.integers(-50, 50, (3, 2)).astype(float)
    ax, ay, bx, by = reference(*p)
    pts = curve(*p, t)
    qx, qy = pts[:, 0] - p[0][0], pts[:, 1] - p[0][1]
    ab = ax * by - ay * bx
    lhs = (ax * qy - ay * qx) ** 2          # cross(a, q)^2 = (t * cross(a,b))^2 ... 
    rhs = ab * (qx * by - qy * bx)          # cross(q, b) = t^2 cross(a, b)
    s = max(1.0, abs(ab)) ** 2
    worst_ref = max(worst_ref, np.max(np.abs(lhs + rhs)) / s, 0)
print(f"local-frame reference (cross(a,q))^2 + cross(a,b)*cross(q,b) on curve, worst = {worst_ref:.3e}")

# 2) f32 precision at font-unit scale: coordinates up to 2048 (Inter upm), evaluated in absolute vs local frame.
rel_abs, rel_loc = [], []
for _ in range(2000):
    base = rng.integers(0, 2048, 2)
    p = (base + rng.integers(-200, 200, (3, 2))).astype(float)
    x = p[0][0] + rng.uniform(-50, 50); y = p[0][1] + rng.uniform(-50, 50)
    c64 = coeffs(*p, np.float64); f64 = implicit(c64, x, y)
    c32 = coeffs(*p, np.float32); f32 = implicit(c32, np.float32(x), np.float32(y))
    rel_abs.append(abs(float(f32) - f64) / max(abs(f64), 1e-9))
    q = p - p[0]
    c32l = coeffs(*q, np.float32); f32l = implicit(c32l, np.float32(x - p[0][0]), np.float32(y - p[0][1]))
    c64l = coeffs(*q, np.float64); f64l = implicit(c64l, x - p[0][0], y - p[0][1])
    rel_loc.append(abs(float(f32l) - f64l) / max(abs(f64l), 1e-9))
for name, r in (("absolute font units", rel_abs), ("relative to P0", rel_loc)):
    r = np.array(r)
    print(f"f32 {name}: median rel err {np.median(r):.2e}, p99 {np.percentile(r, 99):.2e}, sign flips {np.mean(r > 1):.2%}")
