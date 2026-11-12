"""从记录编辑页设计稿切图。用法: python3 tools/extract_edit_assets.py design/record-edit.png"""
import sys
from PIL import Image
import numpy as np

src = Image.open(sys.argv[1]).convert('RGB')
OUT = 'src/static/img/'

def photo_without_badge(name, box, badge_center, r=29):
    """切出照片，并用左侧相邻的天空把右上角的删除按钮盖掉（按钮由页面重新绘制）"""
    a = np.array(src).astype(float)
    cx, cy = badge_center
    yy, xx = np.mgrid[cy - r:cy + r + 1, cx - r:cx + r + 1]
    mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    shift = 2 * r + 6
    patch = a[cy - r:cy + r + 1, cx - r - shift:cx + r + 1 - shift]
    region = a[cy - r:cy + r + 1, cx - r:cx + r + 1]
    region[mask] = patch[mask]
    Image.fromarray(a.astype('uint8')).crop(box).save(OUT + name, quality=92)

photo_without_badge('draft-1.jpg', (62, 794, 282, 1000), (262, 814))
photo_without_badge('draft-2.jpg', (301, 794, 520, 1000), (500, 814))

# 主题卡片上方的橙色小装饰：一半压在米色底、一半压在浅橙卡片上，按“橙色程度”抠图
x0, y0, x1, y1 = 556, 186, 610, 240
a = np.array(src.crop((x0, y0, x1, y1))).astype(float)
alpha = np.clip((a[..., 0] - a[..., 2] - 55) / 70, 0, 1)
rgba = np.dstack([np.full(alpha.shape, 251), np.full(alpha.shape, 136), np.full(alpha.shape, 84), alpha * 255])
Image.fromarray(rgba.astype('uint8')).save(OUT + 'edit-spark.png')
