"""从设计稿中切出图片素材。用法: python3 tools/extract_assets.py 设计稿.png"""
import sys
from PIL import Image, ImageFilter
import numpy as np

src = Image.open(sys.argv[1]).convert('RGB')
OUT = 'src/static/img/'
BG = np.array([251, 248, 243])

def photo(name, box):
    src.crop(box).save(OUT + name, quality=92)

def keyed(name, box, lo=10, hi=70):
    """把接近页面底色的像素变透明，保留前景"""
    a = np.array(src.crop(box)).astype(float)
    d = np.abs(a - BG).max(axis=2)
    alpha = np.clip((d - lo) / (hi - lo), 0, 1)
    # 反预乘，去掉边缘的底色
    fg = np.where(alpha[..., None] > 0.02, (a - BG * (1 - alpha[..., None])) / np.maximum(alpha[..., None], 0.02), a)
    rgba = np.dstack([np.clip(fg, 0, 255), alpha * 255]).astype('uint8')
    Image.fromarray(rgba).save(OUT + name)

# 主题封面（卡片内上圆角由 CSS 裁切，这里向内收 1px 避开抗锯齿边）
photo('theme-1.jpg', (42, 676, 415, 868))
photo('theme-2.jpg', (443, 676, 817, 868))
photo('theme-3.jpg', (42, 1013, 415, 1205))
photo('theme-4.jpg', (443, 1013, 817, 1205))
photo('record-1.jpg', (55, 1435, 321, 1657))
photo('statusbar.png', (0, 0, 852, 84))

keyed('logo.png', (40, 84, 252, 178))
keyed('brush.png', (40, 338, 410, 364), lo=2, hi=11)

# 横幅：整条切下，抹掉文字和加号按钮，由页面重新绘制
x0, y0, x1, y1 = 28, 346, 824, 560
b = np.array(src.crop((x0, y0, x1, y1))).astype(float)
def wipe(bx0, by0, bx1, by1):
    for y in range(by0 - y0, by1 - y0):
        l, r = b[y, bx0 - x0 - 3:bx0 - x0].mean(0), b[y, bx1 - x0:bx1 - x0 + 3].mean(0)
        t = np.linspace(0, 1, bx1 - bx0)[:, None]
        b[y, bx0 - x0:bx1 - x0] = l * (1 - t) + r * t
wipe(60, 425, 445, 530)
# 横幅上沿以外、左侧区域（副标题笔刷所在）还原为底色
b[:392 - y0, :600 - x0] = BG
img = Image.fromarray(b.astype('uint8'))
img.save(OUT + 'banner.jpg', quality=93)
