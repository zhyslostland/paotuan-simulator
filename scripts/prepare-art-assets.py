#!/usr/bin/env python3
"""把 `generated-images/` 里**需要成画**的生图产物**处理（去底 / 裁切 / 缩放 / 压 WebP）**，输出到 `public/art/`。

## 这个脚本现在的职责（2026-10-04 起）

🔴 界面上那批**装饰与线稿已全部改为手写 SVG**（`src/ui/ornaments.tsx`）——
主人原话：「**目前的美术我没看到需要调用生图额度的质量**」
（`docs/报告/方案-美术资产路数重定.md`）。

于是生图**只剩下一个用途**：**"要一张画"的位置** —— 要有构图、有画风、地位重要。
目前这样的位置**只有一处：整页背景图**。

所以下面那份清单现在很短，而且**以后也只该有"画"**。
装饰 / 图标 / 材质 / 线条，一律去 `ornaments.tsx` 手写，别加到这里来。

## 口径（同以前）

- **只缩不放**：界面用多大就存多大，绝不放大（放大只会变糊、还变胖）；
- **WebP**；**该裁的裁**（靠留白构图的不裁，那圈空白本来就是设计的一部分）；
- 尺寸按**运行需要**定 —— 主人 2026-10-02：「美术资产只要考虑项目运行，不需要考虑协作方代码包大小，
  到时候代码包不发图就是了」（`pack-for-review.py` 与 `audit-pack.py` 已排除 `public/art/`）。

## 去底（`PAPER_KEYED`）—— 背景图专用的一步

🔴 生图**给不出真正的透明底**（模型会自己填一层米色纸），而背景图**必须两套主题共用**：
羊皮纸上铺得好看，午夜主题上也得成立。所以按**亮度做软映射**把纸底抠掉：
**亮 → 透明，暗（线）→ 保留**，抗锯齿的柔边靠线性过渡保住。

抠完之后它才真的"两套都成立"：同一条**暗金线**，铺在米底上是羊皮纸，
铺在深底上就是午夜 —— 暗金本来就是午夜主题的强调色（`--c-accent #c9a44c`）。

## 用法

    python scripts/prepare-art-assets.py

源图按**文件名前缀**匹配（生图产物名里带时间戳），同名多张时取**最新**的一张。
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    print('需要 Pillow：pip install pillow', file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'generated-images'
OUT = ROOT / 'public' / 'art'

# 输出名, 源文件名前缀, 目标宽(px), 是否裁掉透明边, 用途说明
#   ⚠️ 只放"要一张画"的。
ART = [
    (
        'bg-atlas',
        '极简的单色线描图案',
        1600,
        False,
        '整页背景图（古航海图 + 星图线描；**两套主题共用**，靠去底 + 各自的 opacity/filter 成立）',
    ),
]

# 额外裁切（左, 上, 右, 下 —— **比例**）。
# 背景图右下角压着平台水印；它必须是铺满的图（不能靠透明底避开水印）→ 裁掉底部一条。
# 它是均匀的星图，裁掉 10% 完全不影响观感（而且铺的时候本来就 cover 裁切）。
EXTRA_CROP = {
    'bg-atlas': (0.0, 0.0, 0.0, 0.10),
}

# 需要**抠底**的（把浅色纸底变透明，只留线条）。见 docstring「去底」那一节。
PAPER_KEYED = {'bg-atlas'}

# 背景图是**整页铺底**、且不透明度很低（10% 上下），人眼不会去抠它的细节 ——
# 所以压得比一般资产狠一档。再低（<70）线描边缘会出块状伪影，能看出来。
QUALITY = 78
# 单张的"运行"预算。背景图是**唯一**的大件，单独给它一档
# （界面装饰都在 `ornaments.tsx` 里，是几十字节级的矢量，不占这个预算）。
SINGLE_BUDGET_KB = 600


def newest(prefix: str) -> Path:
    """按前缀找源图，多张时取最新（生图产物名带时间戳）。"""
    hits = [p for p in SRC.glob('*.png') if p.name.startswith(prefix)]
    if not hits:
        raise FileNotFoundError(f'找不到源图：{prefix}*')
    return max(hits, key=lambda p: p.stat().st_mtime)


def key_out_paper(im: Image.Image) -> Image.Image:
    """把浅色纸底抠成透明，只留暗色线条（软阈值，保住抗锯齿的柔边）。

    亮度 ≥ `PAPER_HI` → 全透；≤ `PAPER_LO` → 全留；中间线性过渡。
    这组值是照生图实际给的数取的：纸底亮度约 232–242，线条约 140–190。
    """
    PAPER_HI, PAPER_LO = 236, 150
    rgb = im.convert('RGB')
    alpha = rgb.convert('L').point(
        lambda v: 0 if v >= PAPER_HI else (255 if v <= PAPER_LO else round((PAPER_HI - v) * 255 / (PAPER_HI - PAPER_LO)))
    )
    out = rgb.convert('RGBA')
    out.putalpha(alpha)
    return out


def main() -> int:
    if not SRC.is_dir():
        print(f'源目录不存在：{SRC}', file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)

    total = 0
    print(f'{"输出":<16}{"尺寸":<14}{"体积":>10}  来源')
    print('-' * 72)
    for name, prefix, target_w, do_trim, _use in ART:
        src = newest(prefix)
        im = Image.open(src).convert('RGBA')

        if do_trim:
            box = im.getbbox()
            if box:
                im = im.crop(box)

        crop = EXTRA_CROP.get(name)
        if crop:
            cl, ct, cr, cb = crop
            w, h = im.size
            im = im.crop(
                (
                    round(w * cl),
                    round(h * ct),
                    round(w * (1 - cr)),
                    round(h * (1 - cb)),
                )
            )

        if name in PAPER_KEYED:
            im = key_out_paper(im)

        if im.width > target_w:
            h = round(im.height * target_w / im.width)
            im = im.resize((target_w, h), Image.LANCZOS)

        dst = OUT / f'{name}.webp'
        im.save(dst, 'WEBP', quality=QUALITY, method=6)
        kb = dst.stat().st_size / 1024
        total += kb
        print(f'{name + ".webp":<16}{f"{im.width}x{im.height}":<14}{f"{kb:7.1f} KB":>10}  {src.name[:30]}')

    print('-' * 72)
    print(f'共 {len(ART)} 张，合计 {total:.1f} KB（单张预算 {SINGLE_BUDGET_KB} KB）')
    over = [n for (n, _p, _w, _t, _u) in ART
            if (OUT / f'{n}.webp').stat().st_size > SINGLE_BUDGET_KB * 1024]
    if over:
        print(f'⚠️ 超过预算的：{", ".join(over)} —— 要么调小目标宽，要么调低 quality')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
