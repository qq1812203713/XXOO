"""从主题详情设计稿切图。用法: python3 tools/extract_theme_assets.py design/theme-detail.png"""
import sys
from PIL import Image
import numpy as np

src = Image.open(sys.argv[1]).convert('RGB')
OUT = 'src/static/img/'
BG = np.array([252, 248, 244])

def photo(name, box):
    src.crop(box).save(OUT + name, quality=92)

def keyed(name, box, lo=10, hi=70):
    a = np.array(src.crop(box)).astype(float)
    d = np.abs(a - BG).max(axis=2)
    alpha = np.clip((d - lo) / (hi - lo), 0, 1)
    fg = np.where(alpha[..., None] > 0.02, (a - BG * (1 - alpha[..., None])) / np.maximum(alpha[..., None], 0.02), a)
    Image.fromarray(np.dstack([np.clip(fg, 0, 255), alpha * 255]).astype('uint8')).save(OUT + name)

photo('cover-1.jpg', (32, 176, 820, 422))
photo('record-1-wide.jpg', (274, 995, 804, 1148))
photo('record-2.jpg', (274, 1376, 804, 1480))
keyed('title-brush.png', (30, 516, 394, 538), lo=3, hi=14)
keyed('title-spark.png', (760, 446, 818, 504), lo=8, hi=50)
