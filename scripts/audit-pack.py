# -*- coding: utf-8 -*-
"""审计协作方代码包：**不多、不少、不泄**。

用法（打完包之后跑）：
    python scripts/audit-pack.py

判据（三条全绿才算过）：
  ① 对账 —— 包内条目 == git 跟踪文件（减去禁入项）。**漏 0 / 多 0**
  ② 禁入项 —— 构建产物 / 本机环境文件一个都不许在包里
  ③ 关键文件 + 内容抽检 —— 协作方要看的文档真的在里面，且是新版

为什么要有它（2026-09-19 主人要求「代码包里要包含所有必须的文件，不要漏也不要多」）：
  · 「漏」的实例：审核包写在桌面、没提交进仓库 → `git ls-files` 里没有 → **根本没进包**，
    而主人**只发代码包**给协作方 → 协作方永远看不到。
  · 「多」的实例：脚本曾手工塞 `.wbapp_*.genie`（部署平台元数据，**含本机 localDir**）。
"""
import io
import os
import re
import glob
import zipfile
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESK = os.path.join(os.path.expanduser('~'), 'Desktop')

# 仓库根的构建产物：它们由构建生成，不进版本管理，也**不进包**
BANNED_EXACT = {
    'index.html', 'version.json', 'sw.js', 'sw-v2.js',
    'manifest.webmanifest', 'icon.svg', 'entry-redirect.js',
}
# 🔴 大体积资产同样不进包：
#    `generated-images/` 是画风比对用的平台生图（带水印，不可作正式资产）；
#    `public/art/` 是**游戏内置美术（预制资产）** —— 主人 2026-10-02 定：**代码包不发图**。
#    与 `scripts/pack-for-review.py` 的 BANNED_PREFIX **必须一致**，否则这里会报「漏」。
BANNED_PREFIX = ('assets/', 'dist/', 'node_modules/', '.git/', '.workbuddy/',
                 'generated-images/', 'public/art/')

# 协作方要用的关键文件（少一个就是"漏"）
MUST_HAVE = [
    # ⚠️ 这三份 2026-09 起住在 `docs/` 下（写在根路径是历史遗留 → 每次都是假红）
    'README.md', 'docs/协作/协作方接手.md', 'docs/archive/优化审核包.md', '项目台账.md', '协作清单.md',
    'docs/archive/优化计划.md', '规则包指南.md', 'docs/archive/跑团模拟器开发蓝图.md', '进度报告.html',
    'index.dev.html', 'package.json', 'package-lock.json', 'tsconfig.json',
    'vite.config.ts', '.gitignore',
    'scripts/use-dev-entry.mjs', 'scripts/publish-root.mjs', 'scripts/check-dist.mjs',
    'scripts/memory-lint.mjs', 'scripts/pack-for-review.py', 'scripts/audit-pack.py',
    'public/entry-redirect.js', 'public/icon.svg',
    'docs/README.md', 'docs/文档地图.md', 'docs/协作/台账-版本史.md', 'docs/协作/协作存档-2026-09.md',
    'docs/报告/分次执行报告-战斗修复.md',
]
# ⚠️ 2026-09-28 文档整理：`docs/` 分了 协作/ 报告/ archive/ 三个子目录。
# 判定按**文件名**比对（见下面 miss2），以后文件再挪位置也不会假红 —— 路径会漂，名字才是锚。


def find_pack():
    packs = sorted(glob.glob(os.path.join(DESK, '跑团模拟器-代码包-*.zip')))
    # 只认标准命名（带后缀的是主人有意保留的，不作为"当前包"）
    std = [p for p in packs if re.fullmatch(r'跑团模拟器-代码包-\d{4}-\d{2}-\d{2}\.zip',
                                            os.path.basename(p))]
    if not std:
        print('!! 桌面没找到标准命名的代码包'); sys.exit(1)
    return std[-1]


def main():
    pack = find_pack()
    z = zipfile.ZipFile(pack)
    names = set(z.namelist())

    print('包:', os.path.basename(pack), len(names), '条目',
          '(%.2f MB)' % (os.path.getsize(pack) / 1024 / 1024))
    print()

    # ---- ① 对账 ----
    out = subprocess.run(['git', '-c', 'core.quotepath=false', 'ls-files'],
                         cwd=ROOT, capture_output=True, encoding='utf-8')
    tracked = {l.strip().replace('\\', '/') for l in out.stdout.splitlines() if l.strip()}
    should = {f for f in tracked
              if f not in BANNED_EXACT and not f.startswith(BANNED_PREFIX)}

    missing = sorted(should - names)
    extra = sorted(names - should)

    print('① 对账（git 跟踪 %d → 应进包 %d）' % (len(tracked), len(should)))
    print('   漏（应进包但不在）:', missing if missing else '无 ✅')
    print('   多（在包内但非跟踪文件）:', extra if extra else '无 ✅')
    ok1 = not missing and not extra

    # ---- ② 禁入项 ----
    bad = [x for x in names
           if x in BANNED_EXACT or x.startswith(BANNED_PREFIX)
           or x.startswith('.wbapp_') or x.endswith('.genie')
           or x.endswith('.log') or re.match(r'^_\w+\.txt$', x)]
    print('② 禁入项:', bad if bad else '无 ✅')
    ok2 = not bad

    # ---- ③ 关键文件 ----
    _base = {x.rsplit('/', 1)[-1] for x in names}
    miss2 = [f for f in MUST_HAVE if f.rsplit('/', 1)[-1] not in _base]
    print('③ 关键文件缺失:', miss2 if miss2 else '无 ✅')
    ok3 = not miss2

    # ---- 源码/测试数量对账 ----
    for d in ('src/', 'tests/'):
        a = len([x for x in names if x.startswith(d)])
        b = len([f for f in tracked if f.startswith(d)])
        flag = '✅' if a == b else '❌'
        print('   %-7s包内 %d / 仓库 %d  %s' % (d, a, b, flag))
        if a != b:
            ok1 = False

    # ---- 内容抽检 ----
    def rd(f):
        return z.read(f).decode('utf-8', 'replace') if f in names else ''

    # 版本号从 `src/version.ts` 读真源 —— 写死某个值（v0.8.7 / 667 条）每轮都会假红
    m = re.search(r"APP_VERSION\s*=\s*'([^']+)'", rd('src/version.ts'))
    ver = m.group(1) if m else ''

    checks = [
        ('README 指向包内协作方文档', '协作方接手.md' in rd('README.md')),
        # README 里不写版本号（以前那条「测试数是当前值 667」早已不适用 → 删）
        ('审核包在包内且自带路径说明', '你手上这个 zip' in rd('docs/archive/优化审核包.md')),
        ('接手文档含三条职责', '减少我（实现方）的 token 消耗' in rd('docs/协作/协作方接手.md')),
        ('台账版本是最新 %s' % (ver or '?'), bool(ver) and ver in rd('项目台账.md')),
        ('优化计划含「接手先看」', '接管先看' in rd('docs/archive/优化计划.md') or '接手先看' in rd('docs/archive/优化计划.md')),
    ]
    print()
    print('④ 内容抽检')
    for name, ok in checks:
        print('   %s %s' % ('✅' if ok else '❌', name))
        if not ok:
            ok3 = False

    print()
    if ok1 and ok2 and ok3:
        print('包审计通过：不多、不少、不泄。')
    else:
        print('包审计 **未通过** —— 修好再发。')
        sys.exit(1)


if __name__ == '__main__':
    main()
