"""Font-unit error of Slug's em-normalized binary16 coordinates vs exact integer font units.
Usage: f16_error.py <font> <mode>   (prints max/mean abs error and share of points not exact)"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, model as M, enc as E
from fontTools.ttLib import TTFont
path, mode = sys.argv[1], sys.argv[2]
upm = TTFont(path)['head'].unitsPerEm
names, models, _ = M.load(path, None, mode)
f = E.Flat(models)
v = np.concatenate([f.x, f.y]).astype(np.float64)
back = (v / upm).astype(np.float16).astype(np.float64) * upm
err = np.abs(back - v)
print(f'{os.path.basename(path)} upm={upm} coords={len(v)} max_err={err.max():.3f} units mean={err.mean():.4f} inexact={np.mean(err>0)*100:.1f}% range=[{v.min():.0f},{v.max():.0f}]  err>=0.5u: {np.mean(err>=0.5)*100:.2f}%')
