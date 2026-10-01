# -*- coding: utf-8 -*-
"""
一次性发布包（2026-09-30）—— 面向「这次要上线的东西」，比协作包更小更聚焦。

与 `pack-for-review.py` 的区别：
- `pack-for-review.py` 是**协作包**（给协作方审代码用的全量 tracked 文件）；
- 本脚本是**发布包**：只含发布真正需要的那几样 ——
  构建产物（dist/）、根目录已发布的产物文件、源码、测试、门禁脚本、文档，
  并额外放一份 RELEASE.txt 说明"这一版改了什么、门禁结果、怎么验证"。

⚠️ 与协作包一致的两条硬规矩：
  1. 只打 **git 已跟踪**的文件（防止把本机私有物带出去）；
  2. **排除 `.wbapp_*.genie`**（平台元数据、含本机路径，对别人无用）。

用法：python scripts/pack-release.py
输出：桌面 `跑团模拟器-发布包-YYYY-MM-DD.zip`
"""
import subprocess, zipfile, os, datetime, re, sys

ROOT = r"C:\Users\Administrator\WorkBuddy\跑团模拟器"
DESK = r"C:\Users\Administrator\Desktop"
TODAY = datetime.date.today().strftime("%Y-%m-%d")
OUT = os.path.join(DESK, "跑团模拟器-发布包-%s.zip" % TODAY)

os.chdir(ROOT)

# 只删**标准命名**的旧发布包（带后缀的是有意保留的，不碰）—— 沿用协作包的既有口径
STD = re.compile(r"^跑团模拟器-发布包-\d{4}-\d{2}-\d{2}\.zip$")
for old in sorted(
    f for f in os.listdir(DESK) if f.startswith("跑团模拟器-发布包-") and f.endswith(".zip")
):
    if STD.match(old) and old != os.path.basename(OUT):
        os.remove(os.path.join(DESK, old))
        print("已移除旧包:", old)

out = subprocess.run(
    ["git", "-c", "core.quotepath=false", "ls-files"],
    capture_output=True, encoding="utf-8",
)
tracked = [l.strip() for l in out.stdout.splitlines() if l.strip()]

EXCLUDE_PREFIX = (
    "node_modules/",
    ".git/",
    ".workbuddy/",
    ".vite/",
    "coverage/",
    # 美术基准图（7 MB、带水印）——实现方 09-26 的提交已明确"不进包"，
    # 它们是本机比对用的，对发布/验收无用，留着只会把包从 1 MB 撑到 8.7 MB。
    "generated-images/",
)
EXCLUDE_SUFFIX = (".pyc", ".log")
EXCLUDE_RE = re.compile(r"\.wbapp_[A-Za-z0-9]+\.genie$")

# 仓库根上"已发布的产物"（`publish-root.mjs` 把 dist/ 的结果发布到这里，
# 发布走的就是这一份 —— 必须进包，否则拿到包的人跑起来的是**开发模板**）。
PUBLISHED_ROOT_FILES = [
    "index.html",
    "version.json",
    "manifest.webmanifest",
    "sw.js",
    "sw-v2.js",
    "entry-redirect.js",
    "icon.svg",
]
ASSETS_DIR = "assets"
WORKBOX_RE = re.compile(r"^workbox-[0-9a-f]+\.js$")

files = []
for f in tracked:
    if f.startswith(EXCLUDE_PREFIX):
        continue
    if f.endswith(EXCLUDE_SUFFIX):
        continue
    if EXCLUDE_RE.search(f):
        continue
    if not os.path.exists(f):
        continue
    files.append(f)

# ---- 已发布的产物（仓库根 + assets/）----
# 为什么单独列：这些文件**不在 git 跟踪里**（`publish-root.mjs` 每次构建生成），
# 但发布/部署用的就是它们。少了它们，包里就没有"能直接跑的那一份"。
published = []
for name in PUBLISHED_ROOT_FILES:
    if os.path.exists(name):
        published.append(name)
if os.path.isdir(ASSETS_DIR):
    for base, _dirs, names in os.walk(ASSETS_DIR):
        for n in names:
            published.append(os.path.join(base, n).replace("\\", "/"))
for name in os.listdir(ROOT):
    if WORKBOX_RE.match(name):
        published.append(name)

# 构建产物：dist/（git 里通常不跟踪，但发布包要带一份以便核对）
DIST = "dist"
dist_files = []
if os.path.isdir(DIST):
    for base, _dirs, names in os.walk(DIST):
        for n in names:
            p = os.path.join(base, n)
            rel = os.path.relpath(p, ROOT).replace("\\", "/")
            if rel.endswith((".pyc", ".log")):
                continue
            dist_files.append(rel)

VERSION = "unknown"
try:
    with open(os.path.join(ROOT, "src", "version.ts"), encoding="utf-8") as fh:
        m = re.search(r"APP_VERSION\s*=\s*'([^']+)'", fh.read())
        if m:
            VERSION = m.group(1)
except OSError:
    pass

RELEASE = """跑团模拟器 · 发布包 {date}
版本：v{version}

这一版改了什么（三笔提交，全部为「玩家操作被曲解」的根因）：
1. 叙述一致性判据（src/orchestrator/narration.ts）
   —— 核「守密人有没有推翻玩家的操作与引擎的裁决」，纯函数、可测。
2. 有界纠正 + 可见降级（src/ui/App.tsx）
   —— 兜底回路从"一次性、两分支、重写后不再校验"改为"有界循环 + 三类违规"；
      用尽重试仍违规时，用一句人话告诉玩家可以回溯（不再是蒙在鼓里）。
3. 拒绝话术不再说"你没打中" + 运行期随机源做对
   —— src/core/state/refusal.ts（话术单一真源）· src/ui/runRng.ts（种子 + 调用日志，真机问题可复现）。

门禁结果（打包时实测）：
  tsc --noEmit                      0 错
  vitest run                        1153 / 1153（53 文件）
  npm run build                     通过（产物自检 / 契约门禁 / 边界闸门 / 记忆体检 四道全绿）

怎么验证：
  1. 解压后 npm ci（或直接用仓库根的产物文件）
  2. npm test         → 应 1153 全过
  3. npm run build    → 末尾四道自检应全绿
  4. 起 `npx vite preview` 打开 → 入口与资源应全 200

⚠️ 本包不含 node_modules（要 ng ci 重装）、不含 .git、不含 .workbuddy、不含平台元数据 .wbapp_*.genie。
""".format(date=TODAY, version=VERSION)

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f, f)
    for f in published:
        z.write(f, f)
    for f in dist_files:
        z.write(f, f)
    z.writestr("RELEASE.txt", RELEASE)

size_mb = os.path.getsize(OUT) / 1024 / 1024
total = len(files) + len(published) + len(dist_files) + 1
print("输出:", OUT)
print(
    "条目: %d （源码/文档 %d · 已发布产物 %d · dist %d · RELEASE.txt 1）"
    % (total, len(files), len(published), len(dist_files))
)
print("大小: %.2f MB" % size_mb)
print("版本: v%s" % VERSION)
