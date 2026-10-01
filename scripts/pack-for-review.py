# -*- coding: utf-8 -*-
"""打包跑团模拟器代码包给协作方验收。
清单来源：git 已跟踪文件（协作方要看的全在这里）。
⚠️ 曾手工塞过 .wbapp_*.genie（部署平台元数据）—— **它含本机路径且对协作方无用，已去掉**：
   主人只发代码包给协作方，包内不该有与本机环境绑定的东西。
排除：node_modules / dist / .git / .workbuddy / 仓库根构建产物
"""
import subprocess, zipfile, os, sys, glob, datetime, re

ROOT = r"C:\Users\Administrator\WorkBuddy\跑团模拟器"
DESK = r"C:\Users\Administrator\Desktop"

# 日期必须动态取当天 —— 曾经硬编码成 2026-09-18，导致 09-19 打的包叫昨天的名字。
# 遵守「桌面只留一个包」，但**只删标准命名的**（-YYYY-MM-DD.zip）。
# ⚠️ 曾经用宽 glob 把主人留的「... - 稳定版.zip」也删了 —— 带后缀的是有意保留的，不许碰。
TODAY = datetime.date.today().strftime("%Y-%m-%d")
STD = re.compile(r"^跑团模拟器-代码包-\d{4}-\d{2}-\d{2}\.zip$")
for old in sorted(glob.glob(os.path.join(DESK, "跑团模拟器-代码包-*.zip"))):
    name = os.path.basename(old)
    if STD.match(name) and name != "跑团模拟器-代码包-%s.zip" % TODAY:
        os.remove(old)
        print("已移除旧包:", name)
    elif not STD.match(name):
        print("保留（非标准命名，不自动删）:", name)
OUT = os.path.join(DESK, "跑团模拟器-代码包-%s.zip" % TODAY)

os.chdir(ROOT)

# git 已跟踪文件
# ⚠️ git 默认会把非 ASCII 路径按 C 风格转义成 `"\345\215..."`，必须关掉：
#    -c core.quotepath=false  → 输出原始 UTF-8 路径
out = subprocess.run(
    ["git", "-c", "core.quotepath=false", "ls-files"],
    capture_output=True,
    encoding="utf-8",
)
tracked = [l.strip() for l in out.stdout.splitlines() if l.strip()]

# 一律只打 git 已跟踪文件 —— 未跟踪的一律不进包（防"多"）
genie = []

# 仓库根的构建产物（.gitignore 忽略的那些）—— 确保绝不进包
# 🔴 **大体积资产不进包**（2026-09-26）：
#    `generated-images/` 是**画风比对用的平台生图**（5 张 ≈ 7 MB，占全仓体积七成）。
#    ① 它们**带水印、不可作正式资产**（见 `美术制作计划.md` 的「阶段 0-1 实测结论」）；
#    ② 协作方要的是**代码与文档**，比图的结论已经写进 `美术制作计划.md` 的文字里，不必再给原图；
#    ③ 不排除的话包必定 8 MB，超出 2 MB 的约定上限。
#    ⚠️ 改这里要同步改 `scripts/audit-pack.py` 的 BANNED_PREFIX —— 两边口径不一致，对账会报「漏」。
BANNED_PREFIX = ("assets/", "dist/", "node_modules/", ".git/", ".workbuddy/",
                 "generated-images/")
BANNED_EXACT = {"index.html", "version.json", "sw.js", "sw-v2.js",
                "manifest.webmanifest", "icon.svg", "entry-redirect.js"}
# 📌 **文档一律打进包**（2026-09-20 主人定，推翻当天早些时候"协作清单不打"那条）：
#    协作清单 / 测试报告 / 台账 / 接手文档 …全都进包，方便协作方一次拿到全部上下文。
#    这里只拦**构建产物与本机环境绑定物**，文档一个都不拦。
# 📌 **谁来打包**：交给**最后一个改动的人**；无法明确归属时由我（hy4）打。

files, banned = [], []
for f in tracked + genie:
    f = f.replace("\\", "/")
    if f in BANNED_EXACT or f.startswith(BANNED_PREFIX):
        banned.append(f)
        continue
    p = os.path.join(ROOT, f.replace("/", os.sep))
    if not os.path.isfile(p):
        print("!! 缺文件:", f)
        continue
    files.append((f, p))

print("将打包:", len(files), "个文件")
if banned:
    print("已拦截（构建产物/禁入）:", banned)

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for arc, p in files:
        z.write(p, arc)

size = os.path.getsize(OUT)
print("输出:", OUT)
print("大小: %.2f MB" % (size / 1024 / 1024), "(", size, "bytes )")
if size > 2 * 1024 * 1024:
    print("!! 超过 2MB 约定上限")
    sys.exit(1)

with zipfile.ZipFile(OUT) as z:
    n = z.namelist()
    print("包内条目:", len(n))
    print("顶层:", sorted(set(x.split("/")[0] for x in n)))
    # 复查禁入项
    leak = [x for x in n if x in BANNED_EXACT or x.startswith(BANNED_PREFIX)]
    print("构建产物泄漏:", leak if leak else "无 ✅")
