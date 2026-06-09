# -*- coding: utf-8 -*-
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1080, 1760
BG = (14, 14, 18)
CARD = (26, 26, 32)
ORANGE = (239, 122, 44)
ORANGE2 = (255, 158, 82)
WHITE = (240, 240, 244)
GREY = (150, 156, 166)
GREY2 = (110, 114, 124)
BLUE = (110, 180, 230)
PURPLE = (170, 150, 220)
GREEN = (120, 200, 140)
TEAL = (110, 210, 200)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# 顶部渐变
for y in range(420):
    t = y / 420
    c = (int(20 + 18 * (1 - t)), int(18 + 10 * (1 - t)), int(26 + 18 * (1 - t)))
    d.line([(0, y), (W, y)], fill=c)


def font(sz, bold=False):
    paths = (["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf"] if bold
             else ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc"])
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def ctext(x, y, s, f, fill, anchor="mm"):
    d.text((x, y), s, font=f, fill=fill, anchor=anchor)

# ── 顶部 App 图标（橙色圆角 + 迷你计算器）──
ix, iy, isz = 70, 70, 116
d.rounded_rectangle([ix, iy, ix + isz, iy + isz], radius=30, fill=ORANGE)
d.rounded_rectangle([ix + 22, iy + 20, ix + isz - 22, iy + 46], radius=8, fill=(50, 55, 64))
for r in range(2):
    for c in range(3):
        cx = ix + 30 + c * 26
        cy = iy + 62 + r * 24
        d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=WHITE)

# 标题
ctext(210, 108, "隐藏阅读器", font(72, True), WHITE, "lm")
ctext(212, 168, "Hidden Reader · 伪装计算器 · Zepp OS", font(30), GREY, "lm")

# 标语条
d.rounded_rectangle([70, 232, W - 70, 300], radius=20, fill=(40, 30, 22))
ctext(W // 2, 266, "表面是计算器，密码 123456 按 =  进入隐藏书架", font(33, True), ORANGE2, "mm")


# ── 两个手表样机 ──
def watch(cx, cy, R, draw_fn):
    d.ellipse([cx - R - 10, cy - R - 10, cx + R + 10, cy + R + 10], fill=(70, 72, 78))  # 表圈
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(8, 8, 11))                         # 表盘
    draw_fn(cx, cy, R)


def calc_face(cx, cy, R):
    ctext(cx + R - 40, cy - R + 36, "0", font(34, True), WHITE, "rm")
    cols = [(38, 38, 46)] * 5
    grid = [
        [("×", BLUE), ("7", None), ("8", None), ("9", None), ("+", BLUE)],
        [("÷", BLUE), ("4", None), ("5", None), ("6", None), ("−", BLUE)],
        [("±", BLUE), ("1", None), ("2", None), ("3", None), ("=", ORANGE)],
        [("C", (90, 50, 50)), ("0", None), (".", None), None, None],
    ]
    bw = 34
    gx = cx - (5 * bw + 4 * 6) // 2
    gy = cy - 30
    fb = font(20, True)
    for r, row in enumerate(grid):
        for c, cell in enumerate(row):
            if not cell:
                continue
            lbl, col = cell
            x = gx + c * (bw + 6)
            y = gy + r * (bw + 6)
            color = col if col else (38, 38, 46)
            d.rounded_rectangle([x, y, x + bw, y + bw], radius=9, fill=color)
            ctext(x + bw // 2, y + bw // 2, lbl, fb, WHITE)
    # 页点
    for i in range(3):
        col = ORANGE if i == 0 else (70, 70, 80)
        ww = 16 if i == 0 else 8
        d.rounded_rectangle([cx - 20 + i * 18, cy + R - 40, cx - 20 + i * 18 + ww, cy + R - 32], radius=4, fill=col)


def read_face(cx, cy, R):
    ctext(cx, cy - R + 34, "14:30   37%   85%", font(20), GREY, "mm")
    fb = font(23)
    lines = ["即使被雨淋湿，也没有", "掩盖住她的光芒，反而", "连雨都成为衬托她美丽", "脸庞的小道具。那大概", "就是所谓的娇艳欲滴", "吧。一对水灵灵的眼睛"]
    ty = cy - R + 70
    for i, ln in enumerate(lines):
        ctext(cx, ty + i * 32, ln, fb, (228, 228, 230), "mm")
    # 底部进度
    d.rounded_rectangle([cx - 70, cy + R - 44, cx + 70, cy + R - 40], radius=2, fill=(42, 42, 42))
    d.rounded_rectangle([cx - 70, cy + R - 44, cx - 20, cy + R - 40], radius=2, fill=ORANGE)
    ctext(cx, cy + R - 64, "128 / ~2400", font(18), GREY2, "mm")


wy = 470
watch(290, wy, 175, calc_face)
watch(790, wy, 175, read_face)
ctext(290, wy + 210, "伪装·科学计算器（3 页）", font(26, True), GREY, "mm")
ctext(790, wy + 210, "隐藏·小说阅读器", font(26, True), GREY, "mm")


# ── 功能卡片 ──
def card(x, y, w, h, title, tcolor, items):
    d.rounded_rectangle([x, y, x + w, y + h], radius=22, fill=CARD)
    # 小色块图标代替 emoji
    d.rounded_rectangle([x + 26, y + 22, x + 26 + 26, y + 22 + 26], radius=8, fill=tcolor)
    ctext(x + 68, y + 36, title, font(34, True), tcolor, "lm")
    fb = font(27)
    for i, it in enumerate(items):
        iy = y + 86 + i * 46
        d.ellipse([x + 30, iy - 5, x + 40, iy + 5], fill=tcolor)
        d.text((x + 56, iy), it, font=fb, fill=(206, 208, 214), anchor="lm")


cy0 = 930
cw = (W - 70 * 2 - 30) // 2
card(70, cy0, cw, 300, "计算器", (110, 210, 200),
     ["三页：基础 / 函数 / 三角", "单位换算 · 历史记录", "滑动切页 · 表冠移动光标", "按键按下高亮反馈"])
card(70 + cw + 30, cy0, cw, 300, "阅读器", BLUE,
     ["无缝滚动 + 整页翻", "配色主题 · 自动翻页", "书签 · 书内搜索 · 跳页", "时间/电量/阅读计时"])
card(70, cy0 + 330, cw, 270, "书架", PURPLE,
     ["封面网格 · 最近置顶", "表上改密码 · 删除/隐藏", "在线传书 + 进度浮层", "关于页"])
card(70 + cw + 30, cy0 + 330, cw, 270, "优化省电", GREEN,
     ["大书秒开不卡", "控件池 · 省电策略", "熄屏不退出小说", "多机型自适应"])

# ── 底部：支持机型 ──
fy = cy0 + 640
d.rounded_rectangle([70, fy, W - 70, fy + 90], radius=20, fill=(22, 26, 32))
ctext(W // 2, fy + 32, "适配机型（圆屏）", font(26, True), GREY, "mm")
ctext(W // 2, fy + 64, "Balance · T-Rex 3 · Cheetah Pro · GTR 4 · Active 2", font(27, True), WHITE, "mm")

ctext(W // 2, H - 30, "v2.0.0   ·   请勿沉迷小说阅读喵", font(24), GREY2, "mm")

img.save("D:/calc-reader/poster.png")
print("saved poster.png", img.size)
