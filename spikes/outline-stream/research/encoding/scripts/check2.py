"""Correct implicit form of a quadratic Bezier, and its f32 behaviour at font-unit scale.

With a = P0 - 2P1 + P2 and b = 2(P1 - P0), a curve point is P0 + a t^2 + b t. For q = (x, y) - P0:
cross(a, q) = t cross(a, b) and cross(q, b) = t^2 cross(a, b), so
F(q) = cross(a, q)^2 - cross(a, b) cross(q, b) = 0 on the curve.
Expanded, F = (A x + B y + C)^2 - (D x + E y + G) with A = -a_y, B = a_x and D, E from cross(a,b) * b.
"""
import numpy as np
rng = np.random.default_rng(7)
cross = lambda u, v: u[0] * v[1] - u[1] * v[0]

def F_local(p0, p1, p2, x, y, dt):
    p0, p1, p2 = (np.asarray(p, dt) for p in (p0, p1, p2))
    a = p0 - 2 * p1 + p2; b = 2 * (p1 - p0); q = np.asarray([x, y], dt) - p0
    return cross(a, q) ** 2 - cross(a, b) * cross(q, b)

def F_absolute(p0, p1, p2, x, y, dt):
    """The same conic, with coefficients precomputed in absolute coordinates (what a stored-coefficient format would hold)."""
    p0, p1, p2 = (np.asarray(p, dt) for p in (p0, p1, p2))
    a = p0 - 2 * p1 + p2; b = 2 * (p1 - p0); k = cross(a, b)
    A, B = -a[1], a[0]; C = -(A * p0[0] + B * p0[1])           # cross(a, q) = A x + B y + C
    D, E = k * b[1], -k * b[0]; G = -(D * p0[0] + E * p0[1])  # k cross(q, b) = D x + E y + G
    x, y = dt(x), dt(y)
    return (A * x + B * y + C) ** 2 - (D * x + E * y + G)

t = np.linspace(0, 1, 101)
worst = 0.0
for _ in range(2000):
    p = rng.integers(-50, 50, (3, 2)).astype(float)
    a = p[0] - 2 * p[1] + p[2]; b = 2 * (p[1] - p[0]); s = max(1.0, abs(cross(a, b))) ** 2
    for tt in t:
        pt = p[0] + a * tt * tt + b * tt
        worst = max(worst, abs(F_local(*p, pt[0], pt[1], np.float64)) / s)
print(f"corrected form, float64, |F| on curve / cross(a,b)^2 worst = {worst:.1e}")

# Sign of F (inside/outside of the parabola) is what a renderer uses. Compare f32 against f64 near the curve.
for frame, fn in (("absolute coefficients", F_absolute), ("local frame (relative to P0)", F_local)):
    flips = 0; n = 0
    for _ in range(4000):
        base = rng.integers(0, 2048, 2).astype(float)
        p = base + rng.integers(-300, 300, (3, 2))
        a = p[0] - 2 * p[1] + p[2]; b = 2 * (p[1] - p[0])
        tt = rng.uniform(0, 1); pt = p[0] + a * tt * tt + b * tt
        nrm = np.array([-(2 * a[1] * tt + b[1]), 2 * a[0] * tt + b[0]]); nrm /= max(np.linalg.norm(nrm), 1e-9)
        for off in (0.01, 0.05, 0.25):  # sample points 1/100 to 1/4 font unit off the curve, both sides
            for side in (1, -1):
                x, y = pt + side * off * nrm
                f64 = F_local(*p, x, y, np.float64)
                f32 = float(fn(*p, x, y, np.float32))
                n += 1; flips += np.sign(f32) != np.sign(f64)
    print(f"f32 {frame}: wrong inside/outside sign within 0.01-0.25 font units of the curve: {flips / n:.2%}")
