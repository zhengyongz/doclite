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

## v0.3.0 发布（2026-09-28）

- 新增自动升级功能（自研轻量、零依赖、GitHub Releases）
- 侧边栏底部新增"版本信息"卡片（版本号 + 检查更新入口）
- 新增 `app:get-version` IPC 供渲染层获取应用版本号
- workbuddy 审查 12 项问题全部修复
- Linux deb + Windows Setup.exe 双平台发布

## Markdown 查看（2026-10-10）

- 新增 `.md` / `.markdown` 文件预览（仅预览，不做转换），文件内文字可正常选中复制
- 渲染链路：marked 18（GFM：表格/删除线/任务列表）→ DOMPurify 消毒 → HTML 渲染，与 Azw3Renderer 共用同一套消毒机制
- 新增 `src/components/renderers/MdRenderer.jsx`，复用 DocxRenderer 的文档型布局（白底卡片、最大宽度 820px、支持缩放）
- `src/index.css` 手写轻量 `.md-body` 排版样式（标题层级/嵌套列表/表格/深色代码块/引用块/任务列表勾选框，零插件依赖）
- 接入点全覆盖：上传与拖拽（SUPPORTED_EXTENSIONS）、双击文件关联（main.cjs 参数解析 + package.json fileAssociations 注册 text/markdown）、格式徽标与侧边栏格式卡片（FORMAT_META）
- 已验证：标题/加粗/斜体/行内代码/删除线/嵌套列表/表格/深色代码块/引用块/任务列表/链接全部渲染正常，UTF-8 BOM 自动剥离

### workbuddy 审查修复（2026-10-10）

审查结论：安全链路（DOMPurify 默认策略 + CSP）逐条核验无问题，无高优先级问题；按报告修复 4 中 + 6 低：

- **M1**：MD 文件大小上限按格式收紧至 5MB（`MAX_FILE_SIZE_MB_BY_EXT`）+ 字符数硬兑底 2M 截断预览（防扩展名伪装），超限/截断均顶部提示条告知
- **M2**：显式 `TextDecoder('utf-8')` 解码 + U+FFFD 占比检测，疑似非 UTF-8 时仍渲染但顶部提示条引导（原 catch 分支不可达）
- **M3**：文档内 http/https 链接点击经新增最小 IPC `doclite:open-external`（主进程白名单校验，拒绝自定义 scheme）交系统浏览器打开，修复链接点击无反应
- **M4**：渲染竞态 seq 守卫，快速切换文件时不再显示上一个文件内容
- **L1**：main.cjs 注释与实际行为对齐（--no-sandbox 由 CLI 传入）
- **L2**：markdown 系统关联注册、上传区文案、README 格式表/关联说明补齐
- **L3**：侧边栏格式徽标合并展示（.md/.markdown 不重复出现）
- **L4**：零依赖 heading id 注入（marked v5+ 移除了 headerIds）+ 页内锚点平滑滚动
- **L5**：DEVLOG 结构修复，统一文末单一 AIGC 标记
- **L6**：DOMPurify `FORBID_ATTR: ['style']` 收紧（防内联样式伪造 UI）

## v0.4.0 发布（2026-10-10）

- 新增 Markdown（.md / .markdown）文件预览（marked 18 + DOMPurify，GFM 全语法，文字可选中复制）
- 文档内链接经系统浏览器打开、页内锚点平滑跳转
- 非 UTF-8 编码与超大文件截断均有提示条引导
- MD 大小上限 5MB（其余格式维持 100MB）
- electron:dev 脚本追加 --no-sandbox（Ubuntu 24.04 AppArmor 环境兼容）
- workbuddy 审查 10 项问题（4 中 + 6 低）全部修复
- Linux deb 发布（Windows 安装包待 Win 机构建后补传）

## v0.4.1 Linux 一键安装（2026-10-10）

升级体验改进：Linux 下载完成后从"复制命令到终端手动安装"升级为"一键安装"——

- **updater.cjs** 新增 `updater:install` IPC：`pkexec dpkg -i <主进程记账路径>`（PolicyKit 提权，系统弹出原生图形密码框，全程无需终端）；错误分类处理（ENOENT→缺 pkexec 提示 / 126,127→已取消 / 其他→显示 dpkg 错误摘要）
- 新增 `updater:relaunch` IPC：安装成功后 `app.relaunch()` 一键重启加载新版本
- **UpdateDialog**（Linux ready 态）重构：主按钮"立即安装（自动弹出密码框）"→ 安装中提示"请在系统弹出的密码框中输入密码" → 成功态"✓ 安装成功 + 立即重启"；原终端命令收纳为"安装失败？可改用终端命令手动安装"折叠兜底（保留复制能力）
- Windows 体验不变（打开安装器本就一键）；复用下载互斥锁防重复点击
- 验证：pkexec 错误路径单测 2/2（ENOENT/127 分类）、build + 冒烟无错误
- 注：本功能自 0.4.1 起生效，0.3.0/0.4.0 升级到 0.4.1 仍需手动安装最后一次；此后所有升级均为一键

## 体积与性能优化（2026-10-14）

### 语言包裁剪（build/afterPack.cjs）

- electron-builder afterPack 钩子：Chromium locales 只保留 简中/繁中/英文（52→3 个语言包）
- 效果：安装后磁盘占用 430M→391M（-39M）；deb 94M→87M（压缩收益小，磁盘收益大）

### 转换库懒加载（converters.js）

- pdfjs-dist / jspdf / html2canvas / xlsx / jszip / docx / mobiWriter 全部改为函数内动态 import()
- 浏览文档时零加载转换库（Vite 自动拆 chunk），启动更快、常驻内存更低

### 修复文档转 PDF 卡死（O(M²) → O(M)）⚠️ 严重性能缺陷

**根因**：html2canvas 每截一页都会克隆整个 ownerDocument。旧实现把渲染容器挂在应用主文档，而主文档还有预览区的整份文档渲染，对 M 页文档每页截图克隆 ~2M 页 DOM × M 次 = 复杂度 O(M²)。用户报告 0.3MB Word（上百页）转 PDF 超 10 分钟且界面冻结。

**修复**（converters.js）：
- 新增 `withOffscreenDoc()`：渲染放到离屏 iframe（about:blank 同源小文档），html2canvas 克隆范围不再包含应用 UI 与预览区
- 新增 `canvasSequenceToPdf()`：统一"逐页截图→写 PDF→释放 canvas"管线，替代原 elementToPdf
- 单页隔离：截图瞬间 DOM 只保留当前页，每次克隆成本 O(1)；pptx 改为惰性构建（幻灯片只在截图瞬间存在于 DOM）
- 三条转 PDF 路径（docx/xlsx/pptx）全部接入 onProgress，UI 实时显示转换百分比（不再"看似卡死"）

**基准实测**（60 页文本型 docx，同机同数据）：

| | 旧算法 | 新算法 | 提升 |
|---|---|---|---|
| 转换耗时 | 173.8s | 36.6s / 38.2s | **~4.7 倍** |
| 复杂度 | O(M²) | O(M) | 数百页文档由 10~30 分钟降为分钟级 |

**回归验证**：输出 PDF 60 页齐全、第 30 页（含表格）视觉检查排版正常；xlsx→PDF 2s 完成且表格/表头正常；冒烟无错误。

### 转 PDF 导出质量档位（2026-10-14）

用户实测 0.38M Word（约 200+ 页）转出 128M PDF、耗时 170s——截图型管线在高页数下体积膨胀刺眼。新增双档质量策略：

- **标准（默认）**：scale 1.5 / JPEG 0.75——屏幕阅读清晰，体积约为高清的 55%
- **高清（勾选"高清导出"）**：scale 2 / JPEG 0.85（约 200 DPI）——打印级，与旧版一致
- ConvertPanel 在"导出为 PDF"可用时显示"高清导出（打印级，体积较大）"复选框（默认关闭，转换中隐藏）
- 实现：`QUALITY_PRESETS` 档位表 + `convertFile(file, ext, targetFormat, onProgress, { highQuality })` 参数链

**基准实测**（60 页 docx，同机同数据）：

| 档位 | 耗时 | 体积 |
|---|---|---|
| 标准（默认） | 36.2s | **29.3MB** |
| 高清 | 46.8s | 52.8MB |

标准档第 30 页 96DPI 屏显渲染经视觉检查：文字清晰、无压缩痕迹，屏幕阅读合格。按此推算用户 200+ 页文档：约 128M→70M、耗时约降 15~30%。

## v0.4.2 发布（2026-10-14）

- 体积：语言包裁剪（deb 87M，磁盘 -39M）、转换库懒加载
- 性能：文档转 PDF 由 O(M²) 修复为 O(M)（431 页实测 10+ 分钟 → 2 分 42 秒）
- 体验：转 PDF 双档质量（标准默认 / 高清勾选），进度百分比实时显示
- 用户实测验收：0.38M/431 页 Word → 72.6M/2分42秒（标准）、128M/2分51秒（高清）

> AI生成