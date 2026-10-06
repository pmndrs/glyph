"""The posted coefficients with only A and B negated: does F vanish on the curve?"""
import numpy as np
rng = np.random.default_rng(3); t = np.linspace(0, 1, 101); worst = 0.0
for _ in range(2000):
    (x0, y0), (x1, y1), (x2, y2) = rng.integers(-50, 50, (3, 2)).astype(float)
    d = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1)
    A = -(y0 - 2 * y1 + y2); B = -(2 * x1 - x0 - x2)          # posted A, B negated
    C = x0 * y2 - x2 * y0 + 2 * (x1 * y0 - x0 * y1)           # as posted
    D = 4 * (y0 - y1) * d; E = 4 * (x1 - x0) * d; F = 4 * (x0 * y1 - y0 * x1) * d  # as posted
    x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t ** 2 * x2
    y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t ** 2 * y2
    worst = max(worst, np.max(np.abs((A * x + B * y + C) ** 2 - (D * x + E * y + F))) / max(1.0, d * d))
print(f"posted with A, B negated: worst |F| on curve / delta^2 = {worst:.1e}")
