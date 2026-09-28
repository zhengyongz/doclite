---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '09fb36ec-e59d-4b04-a24f-8debc04f7636'
  PropagateID: '09fb36ec-e59d-4b04-a24f-8debc04f7636'
  ReservedCode1: '9769ef59-080f-4fd8-a117-0ef4140e227e'
  ReservedCode2: '9769ef59-080f-4fd8-a117-0ef4140e227e'
---

# DocLite 开发记录

## 项目概述

DocLite 是一个 Electron + React 桌面文档工具箱，支持 Word/Excel/PPT/PDF/MOBI/AZW3 格式的本地预览与互转。所有文件处理均在本地完成，不上传服务器。

## 技术栈

- **前端**: React 18 + Vite 6 + Tailwind CSS 3
- **桌面**: Electron 33 + electron-builder
- **文档解析**: pdfjs-dist (PDF), SheetJS (Excel), docx-preview (Word), JSZip (PPTX/MOBI ZIP 解析)
- **MOBI 生成**: 自研 `mobiWriter.js`（零依赖纯 JS 实现 PDB + PalmDOC + MOBI6 + TBS + INDX/CNCX 索引）
- **电子书预览**: foliate-js（patched，MOBI/AZW3 渲染）

## 核心模块

### src/utils/mobiWriter.js — MOBI 生成器

从零实现的 MOBI6 格式二进制生成器，不依赖任何第三方库。生成结果通过 calibre 和 Kindle/文石实体设备交叉验证。

**PDB 记录布局**（对齐 calibre 黄金）:
```
Record 0:     PalmDOC 头(16B) + MOBI 头(232B) + EXTH + 标题
Record 1..N:  文本记录（PalmDOC LZ77 压缩 + multibyte overlap + TBS trailing）
Record N+1:   NCX 索引（INDX/IDXT/CNCX 三记录）
Record N+2..: 图片资源（JPEG with JFIF header）
末尾:         FLIS + FCIS + EOF
```

**关键技术点**:
- **TBS (Trailing Byte Sequence)**: 每条文本记录尾部追加索引数据，告诉 Kindle 该记录覆盖哪些 NCX 条目。使用 forward varint 编码（`encodeFvwi`），与 calibre/foliate-js 一致
- **INDX/CNCX 索引**: NCX 目录由三条记录组成——INDX(头+TAGX) / IDXT(条目+偏移表) / CNCX(压缩标题)
- **无零记录**: `firstNonBook = numText + 1 = indx`（对齐 calibre，文石用 `numText+1` 定位 INDX）
- **JPEG JFIF 头**: 生成的 JPEG 手动插入 `FFD8FFE0` JFIF APP0 标记（Kindle 不接受无 JFIF 头的 JPEG）

### src/components/renderers/PptxRenderer.jsx — PPT 渲染

解析 PPTX 内部 XML，提取形状位置/尺寸/背景色/文字颜色，用绝对定位渲染。

**关键 bug 修复**: XML 中 `<a:off>`/`<a:ext>` 是 DrawingML `a:` 命名空间，不是 `p:` 命名空间（`<p:off>` 匹配全失败导致空白）。

### electron/main.cjs — Electron 主进程

- 文件关联：双击文件直接在 DocLite 打开
- 单实例锁：后续双击文件传路径给已运行实例
- IPC：renderer 通过 `doclite:get-open-file` 拉取待打开文件
- contextIsolation + preload 桥接

## MOBI 生成器迭代历史

从 v1 到 v11，经 5 轮迭代修复了所有 Kindle/文石兼容性问题：

| 版本 | 修复内容 | 根因 |
|------|---------|------|
| v1-v6 | 基础 MOBI 生成 + 图片资源 + NCX 目录 | PDB/MOBI 头字段逐步对齐 calibre |
| v7 | TBS trailing bytes（4096 切分 + overlap + TBS） | extra_data_flags=0x03, exthFlags=0x50 |
| v8 | TBS fvwi 编码方向 + NCX size + img 标签格式 | forward varint vs backward varint |
| v9 | 过滤英文装饰行 + 排除小节标题 + JPEG JFIF 头 | PDF 章节装饰页 + sharp 无 JFIF |
| v10 | INDX header offset 180 TAGX offset | 文石依赖此字段定位 TAGX |
| v11 | 移除零记录 + a:off/a:ext 命名空间修复 | 文石用 numText+1 定位 INDX + PPT 空白 |

### 最终验证结果（v11）

- **Kindle**: 目录正常显示 45 条，跳转正确，图片完整
- **文石 TAB10C**（安卓 11）: 目录菜单列出 45 条，点击跳转正确
- **calibre 交叉验证**: 285 个 HTML 章节 + 188 张图片 + TOC
- **PPT 渲染**: 形状位置/背景色/文字颜色正确提取

## 构建方式

```bash
# 开发
npm run dev

# 构建 deb 包（Linux）
npm run build && npx electron-builder --linux deb

# 构建 NSIS 包（Windows）
npm run build && npx electron-builder --win nsis
```

## 项目清理记录

2026-09-19: 项目目录从 1.5G 清理至 931M（不含 node_modules 实际源码约 300K）
- 删除 release/linux-unpacked/（429M 构建中间产物）
- 删除 13 个旧版测试 MOBI（143M）
- 删除 dist/ 构建产物、根目录旧 deb
- 移除过时入口文件 electron/main.js、根目录 main.cjs
- 修正 package.json electron:dev 脚本指向 main.cjs

## 自动升级功能（2026-09-28）

零第三方依赖的轻量升级方案，基于 GitHub Releases：

- **electron/updater.cjs**：检查更新（net.request 请求 `/releases/latest`）、语义化版本比对、按平台选资产（win32→Setup.exe / linux→amd64.deb）、流式下载（背压写盘防内存峰值、空闲超时、大小完整性校验、失败自动清理）、进度经 IPC 推送
- **main.cjs**：ready 后注册升级 IPC；启动 3 秒后静默检查，发现新版才通知渲染层（不打扰）
- **preload.cjs**：暴露 checkUpdate / startDownload / copyInstallCmd / openInstaller / onUpdateStatus
- **前端**：useUpdater hook（App.jsx 集成）+ 侧边栏底部"版本信息"卡片（显示版本号 + 检查更新按钮，有新版时高亮+徽标）+ UpdateDialog 弹窗（版本/更新说明/下载进度/Linux sudo dpkg 安装引导/Windows 直接启动安装器）
- **安装方式**：Windows 打开 NSIS 安装包；Linux 需 sudo 权限，弹窗提供可复制的 `sudo dpkg -i` 命令（系统限制，无法免密自动装）
- **容错**：GitHub 访问失败（大陆网络常见 504/连接重置）静默跳过或提示重试，不影响正常使用

> 注意：实测 Electron 33 的 `net.fetch` 在部分网络环境对 GitHub 返回 504，故使用经典 `net.request` 实现。

### 验证记录

- 单元测试 10/10 通过（版本比较 / 资产选择）
- 真实 GitHub API 检查成功（解析 v0.2.0、正确判定"已是最新"）
- 本地服务器端到端下载 20MB：精确落盘、进度推送 20 次、完成事件、失败清理均正常
- DOCLITE_SMOKE=1 冒烟模式：真实应用启动渲染无错误、6 秒截图验证 UI 正常

### workbuddy 审查修复（2026-09-28）

审查结论：核心设计（背压/互斥/转义/零依赖/安全基线）全部确认无问题；按报告修复 12 项：

- **H1/M1（安全）**：`open-installer` / `copy-install-cmd` 改为**主进程记账**（`lastDownloaded`），升级 IPC 一律不接受渲染层传入的路径/命令，杜绝"沙箱点火"通道
- **M2**：下载防重入（hook 同步锁 `startingRef` + 忽略"下载已在进行中"错误，消除快速双击闪红）
- **M3**：手动检查走 60s TTL 缓存（不再 force 绕缓存）、403/429 专属文案、检查中按钮禁用
- **M4**：下载大小硬上限（期望 ×1.1，未知按 500MB 兜底）+ content-length 与预期严重不符提前拒绝，防无限写盘
- **L1**：`compareVersions` 支持预发布号（`0.3.0-beta < 0.3.0`）
- **L2**：状态推送懒取 `BrowserWindow.getAllWindows()[0]`，窗口重建后自动指向新窗口
- **L3**：content-length 响应头显式处理数组形态
- **L4**：下载前清理历史同类型安装包
- **L5**：冒烟截图改 `app.getPath('temp')` + 仅 `!app.isPackaged` 启用
- **L7**：可选 sha256 完整性校验（Release 附带 `<资产>.sha256` 即自动启用，旧版本无则跳过）
- 顺带修复：`req.destroy(err)` 在 response 回调中不保证触发 error 事件导致 Promise 挂起的隐患，改为直接 reject + 关闭连接

### 审查后回归验证

- 单元测试 14/14（新增预发布/异常输入用例）
- 本地端到端 9/9：正常下载+旧包清理、sha256 成功/失败、M4 两种拒绝路径、失败残留清理
- vite build + DOCLITE_SMOKE 冒烟（截图至 /tmp）+ deb 打包（95M，asar 含新模块）全部通过

> AI生成

## v0.3.0 发布（2026-09-28）

- 新增自动升级功能（自研轻量、零依赖、GitHub Releases）
- 侧边栏底部新增"版本信息"卡片（版本号 + 检查更新入口）
- 新增 `app:get-version` IPC 供渲染层获取应用版本号
- workbuddy 审查 12 项问题全部修复
- Linux deb + Windows Setup.exe 双平台发布

> AI生成