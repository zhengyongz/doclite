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

## v0.4.3 下载镜像加速 + 自动切换（2026-10-16）

用户实测 v0.4.2 自动升级成功，但反馈"下载慢"。根因：GitHub 资产服务器（objects.githubusercontent.com）国内直连极慢（本机实测约 110KB/s，87MB 约需 13 分钟）。

### 镜像源轮询（electron/updater.cjs）

- 新增 `DOWNLOAD_SOURCES` 候选源：**官方直连 → ghfast.top → gh-proxy.com → ghproxy.net**（ghproxy 类服务格式 = 前缀 + 官方完整 URL，已逐源实测连通性与速度）
- `download()` 重构为多源轮询：每个源独立哈希累计，失败/过慢则清理残留并切换下一源；全部失败汇总各源原因（不再只报单一"下载失败"）
- 新增**启动期慢速检测**：收到首个数据块后 10s 内累计 < 2MB（约 200KB/s）判定当前源过慢，主动断开切换镜像——直连"连得上但龟速"的场景自动走镜像
- **sha256 期望值获取同样走镜像轮询**（小文件任一源成功即用），下载完成后全源统一校验，防止镜像被篡改

### 修复下载挂死 bug（严重）

- **现象**：带 sha256Url 时下载在"获取 sha256"阶段无限挂起（无任何失败日志，进程不退出）
- **根因**：官方 GitHub 资产对 sha256 小文件请求偶发 30 秒无响应；原实现依赖 `req.destroy()` 触发的 error 事件结算 promise，实测 Electron 下 **destroy() 后 error 事件不触发**，promise 永不 settle
- **修复**：`requestUrl` / `downloadFromUrl` 的超时定时器回调内**直接 reject**（destroy 仅作连接清理），不再依赖 error 事件；慢速检测同理
- 同时修复了编辑过程中误引入的 requestUrl 函数头重复（语法错误）

### 界面提示

- 下载进度条下方新增"当前源"显示（官方直连 / 镜像 xxx），切换时提示"已自动切换（上一源：xxx）"（useUpdater.js + UpdateDialog.jsx）

### 验证

- 单元测试 12 项通过（候选源顺序/前缀拼接/compareVersions 回归）
- Electron 主进程真实下载冒烟：87MB deb 全程 **77.3s**（原直连预估 13 分钟），sha256 与官方一致 PASS
- 镜像完整性核对：ghfast.top 下载产物 sha256 与官方发布逐位一致（无篡改）
- build + electron-builder 打包无错误（deb 87M）

## v0.5.0 安装时可选文件转换功能（2026-10-30）

用户需求："程序安装时选择是否安装文件转换功能——默认浏览功能，可选转换功能。"

### 结构性拆分（浏览 / 转换分离）

- **主包**：仅浏览功能（PDF/Word/Excel/PPT/MOBI/AZW3/MD 预览）。ConvertPanel 不再 import converters.js，转换库从主 bundle 彻底剥离（jspdf 390K / html2canvas 202K / xlsx / docx / mobiWriter 等全部移出）
- **转换组件**：新增 `vite.config.converters.js` 独立构建（lib 模式 IIFE 单文件 `converters.js` 2.2MB，gzip 后 680K），入口 `src/converters-entry.js` 运行时挂 `window.DocLiteConverters`
- **主进程零 npm 依赖**：生产环境排除全部 node_modules（Vite bundle 后运行时依赖为零），app.asar 从 111M → 3.9M；主包 deb 87M → **69.2M**（-18M）

### 组件安装途径（三种，版本高者优先）

1. **dev**：`dist/converters`（源码运行自动可用）
2. **系统级（Linux）**：独立组件包 `doclite-converters_<版本>_amd64.deb` 安装到 `/opt/DocLite/resources/converters`；主 deb 添加 `Recommends: doclite-converters (>= 版本)`——`apt install ./doclite_x.deb` 自动带上（默认完整功能），`dpkg -i`（一键升级流程）= 纯浏览
3. **用户级（双平台统一）**：应用内一键安装——主进程镜像轮询下载组件 zip（复用升级器基建 + sha256 防篡改）→ 渲染层 fflate 解压 → 写入 `~/.config/doclite/converters`（免提权，支持更新/卸载）

### 应用内安装管线（electron/converters-component.cjs + convertersLoader.js）

- ConvertPanel 检测组件状态：未安装→"安装转换组件（约 1MB，仅需一次）"引导；已安装→正常转换 + "更新组件"入口（组件版本显示）
- 主进程零依赖原则：zip 解压由渲染层 fflate 完成（主 bundle 新增唯一小依赖，8KB），IPC 回传 + 主进程防路径穿越/体积上限校验 + 临时目录原子替换
- CSP 调整：`script-src 'self' file:`（允许动态加载本地磁盘组件脚本）
- updater.check() 补充 releaseAssets 资产清单，供组件定位 `DocLite-converters-<版本>.zip` 及配套 sha256

### 打包链（build/pack-converters.cjs）

- `npm run build` = 主构建 + 组件构建；`electron:build` 追加组件打包
- 产物：主 deb（Recommends 后处理）+ `DocLite-converters-0.5.0.zip(+.sha256)` + `doclite-converters_0.5.0_amd64.deb(+.sha256)`
- 主 deb 后处理原子替换（临时文件 + rename 防中断损坏）；xz9 压缩与 electron-builder 原生水平一致（69.2M，构建多约 4 分钟）

### Windows 路线说明

electron-builder NSIS oneClick 模式无组件选择页（自定义组件页与模板冲突、风险高），Windows 保留一键安装（浏览版）+ 应用内 zip 安装组件，与 Linux 用户级路线统一。

### 验证

- 主 bundle 静态验证：转换库 chunk 全部消失、零 node_modules 引用、asar 无 node_modules（5840 个文件 → 0）
- e2e 冒烟（Electron 真实进程）：A 模式 状态检测→script 注入→convertFile 真实 docx→pdf 返回 CONVERT_OK；B 模式（移除组件目录）installed=false PASS
- sha256sum -c 三产物校验通过（deb 69,231,916B / 组件 deb 560,558B / zip 696,350B）
- 历史遗留：本地 release/ 的 0.4.1 deb 副本与 sha256 文件不符（GitHub 资产为准）

> AI生成

## v0.5.1 转换组件安全加固（workbuddy 审查修复，2026-10-30）

审查报告：H1（高）+ M1~M4（中）+ L1~L7（低）。本轮修复 H1/M1/M2/M3/M4 及 L2/L3/L4/L6/L7；L1/L5 随白名单与既有设计自然收敛。

### H1 持久化 XSS 通道（信任边界收口）⚠️ 核心变更

- **问题**：原实现由渲染层解压 zip 并回传文件内容，主进程仅做路径/体积校验 → 渲染层被攻破时可写入任意 `converters.js`，且下次启动自动注入执行（持久化）
- **审查建议的 manifest 内嵌哈希方案存在自身弱点**（攻击者可同时伪造 manifest 与脚本），故采取更彻底方案：
  - **主进程内置最小 zip 解包器**（Node `zlib.inflateRawSync` + 自研 CRC32 + 中央目录解析，约 120 行，零依赖）
  - 删除 `converters:unzip-request/unzip-result` IPC 与渲染层 fflate 解压管线——**主进程不再信任渲染层回传任何内容**
  - 解包白名单：仅 `converters.js` / `manifest.json` / `assets/**`；`inflateRawSync` 加 `maxOutputLength`（防 zip 炸弹）；CRC32 全文件校验
  - manifest 校验：version 格式回验（ZIP_NAME_RE）、`minAppVersion` 兼容性、`sha256` 与实算比对（纵深防御）
  - 渲染层 fflate 引用移除；preload 暴露面收缩（删除 2 个 API）

### M1 安装并发互斥

- 模块级 `installing` 标志（并发请求直接拒绝）；下载临时文件随机后缀（`converters-download-<ts>-<rand>.zip`），消除双流写同文件与 session 覆盖悬挂

### M2 组件与主程序版本错配

- `locateComponentAsset` 只选择**不高于当前主程序版本**的组件 zip；manifest `minAppVersion` 高于当前应用则拒绝安装

### M3 校验缺失与 zip 炸弹

- `.sha256` 资产缺失/获取失败时**中止安装**（不再降级跳过）；下载体积硬上限 100MB；解压单文件 20MB / 总量 60MB / 条目 50 上限 + inflate 输出上限

### M4 错误透传

- 解压/校验失败的真实原因直接从主进程返回（"组件包内容为空"等误导性错误消失）

### 低优先级

- L2：CSP 移除多余的 `img-src file:`（仅保留 `script-src file:`）
- L3：卸载连带清理 `.installing` 残留与 `converters-download-*.zip`
- L4：ConvertPanel 按版本比对显示"更新到 vX"、安装/卸载成功反馈（notice）、用户级"移除"入口
- L6：构建脚本拆分 `build:app` / `build:converters`（开发可单独跳过组件构建）
- L7：主 deb control 无变更时跳过 xz9 重压缩（省约 4 分钟）；zip 构建固定 mtime（1980-01-01）实现字节级可复现

### 验证

- 单测 22/22：正常/ store 解包、白名单（evil.exe、../、绝对路径、盘符）、CRC 篡改、截断包、sha256 不符、非法 version、minAppVersion 过高、缺 manifest、21MB 预检、CRC32 标准向量
- e2e（真实网络）：应用内安装 → 主进程解包写盘 → 状态检测 → 组件加载 → docx→pdf CONVERT_OK → 卸载清理，PASS
- 修复一个 UI 误导 bug：安装结果返回"本次安装版本"而非全局最高版本

> AI生成

## 2026-10-31 · 差量升级（electron-updater）

### 动机

升级一直是全量下载 71.76MB：安装包里业务代码 app.asar 仅 2.57MB，其余 96% 是几乎不变的 Electron 运行时——每次升级重复下载。

### 方案（方案 A：官方 electron-updater + blockmap 差量）

- 集成 electron-updater 6.8.11 作为唯一运行时依赖（dependencies）；原 14 个浏览器侧库全部移入 devDependencies（Vite 打进 dist，无需进安装包），延续 v0.5.0 "node_modules 清零"精神——asar 内仅 electron-updater 的 11 包闭包（app.asar 2.57→4.65MB，NSIS 压缩后安装包 71.76→72.07MB，净增 0.31MB）
- build 新增 publish: github（生成 app-update.yml：provider + updaterCacheDirName=doclite-updater；**必需**，否则 electron-updater 下载时读配置 ENOENT 导致差量路径整体失效）+ 构建脚本 --publish never 防误发布
- updater.cjs 新增差量引擎 downloadDifferential：Windows 升级时优先走差量，逐源（官方直连+ghfast/gh-proxy/ghproxy 镜像）尝试 generic feed（releases/latest/download/ 稳定地址），失败自动回退原镜像全量下载（行为与旧版一致）；进度/结果事件沿用 updater:status 协议，渲染层零改动

### 阅读 electron-updater 6.8.x 源码得出的关键实现细节（均已处理）

1. 差量对照旧文件固定读 cacheDir/installer.exe，但下载产物按原始名存 pending/ 且换代清空——库自身从不写该文件，**需下载成功后主动播种**（seedDiffBaseFile 复制一份），否则差量永远不触发
2. 旧 blockmap 优先读本地 cacheDir/current.blockmap（每次成功后自动提升），与播种文件同版本；stable feed 地址下服务端旧 blockmap 404 无需依赖
3. generic provider 默认 multipart/byteranges 多段请求，GitHub/镜像多不支持——显式 useMultipleRangeRequest:false 走逐块单 Range
4. 未打包环境需 forceDevUpdateConfig=true 才启用 updater（electron:dev 可调试升级）
5. electron-builder 25 的 latest.yml 为新格式（size 在 files[0] 内，顶层无 size），解析需兼容
6. 安全：拼装后 sha512 全文校验（latest.yml）；另用 GitHub API 资产 size 与 latest.yml 交叉核对，防镜像同改安装包与元数据

### E2E 验证（本地 Range 服务器 + 双跳模拟，.temp/difftest）

- hop1（无播种）：feed 检查 → 全量 75,569,979B（旧 blockmap 404 触发引擎内回退，符合代码路径）→ sha512 一致 → 播种建立
- hop2（差量）：latest.yml(342B) + 新 blockmap(78KB) + **9 个 206 Range 块共 1,368,879B（仅 1.37MB）** → 拼回 75,569,582B 完整安装包 → sha512 一致 → 播种自动更新为 9.9.9
- **传输节省 98.2%**（72MB → 1.37MB）；生产中首次 electron-updater 下载为全量（同现网体验），第二次起均差量

### 发布清单（每次发版必须）

Release 资产除安装包外，**必须同时上传** electron-builder 生成的：
- latest.yml（feed 元数据：版本+sha512+文件名）
- Setup.exe.blockmap（分块哈希图，差量对比基准）
镜像/直连 feed 地址为 
eleases/latest/download/<文件名> 稳定地址，始终指向最新 Release。

> AI生成

## v0.6.0 macOS 版本首发 + 三平台 CI 自动发版（2026-11-03）

按《DocLite-macOS构建-智能体提示词正文.md》执行（本次按用户指示跳过第三方审查直接发布）。

### macOS 构建（无 Xcode 依赖）

- `package.json` 新增 `build.mac` 段：dmg+zip × x64/arm64 双架构、`build/icon.icns`、productivity 分类、`hardenedRuntime`、`gatekeeperAssess: false`（ad-hoc 签名下关掉 Gatekeeper 评估，否则安装被拦）
- `build/entitlements.mac.plist`：4 key，其中 `files.user-selected.read-write` 为 macOS 文件关联打开所必需
- 图标：CI 上由 sips/iconutil 从 512×512 png 生成 icon.icns（不入库，.gitignore 排除）
- macOS 一期仅手动更新：无 Developer ID 签名时 electron-updater zip 替换必被 Gatekeeper 阻止——`download()` 加 darwin 守卫（打开 Release 页 + 指引文案），check() 在更新说明尾部追加手动下载指引； entitlements/hardenedRuntime 已备好，获取签名后可零改动开通

### 平台适配修复

- `main.cjs`：open-file 监听从 whenReady 内移至模块顶层（macOS 双击文件启动时事件早于 ready 触发，原写法丢失首个事件）；window-all-closed 加 darwin 判断（macOS 惯例关窗不退出）
- `updater.cjs` pickAsset darwin 分支。⚠️ 踩坑实录：electron-builder zip 历史命名怪癖——arm64 为 `*-arm64-mac.zip`，x64 无 arch 后缀直接叫 `*-mac.zip`；首版正则按文档写的 `-arm64.zip/-x64.zip` 匹配不到实际产物，mac 检测到更新会误报"未找到可用安装包"。已按真实资产名修正并单测验证

### GitHub Actions（首次建立 CI）

- `release.yml`：推 v* tag 三平台矩阵构建（fail-fast:false）→ sips 生成 icns（mac）→ 各平台 `--publish never` 打包 → pack-converters（全平台出组件 zip）→ softprops/action-gh-release 上传 16 资产；tag 门控（workflow_dispatch 调试不上传）；npm 缓存只 cache ~/.npm（node_modules 必须每次 npm ci，保证 patch-package 生效）
- `ci.yml`：master/PR 三平台构建验证，不发版
- ⚠️ 踩坑：Windows runner 默认 shell 为 PowerShell，清理步骤 `rm -f` 失败导致 win 上传被跳过——改 Node 跨平台单行
- 发现并清理：`release/*.yml` 通配误传 builder-debug.yml / latest-linux.yml（AppImage 专用）；macOS 语言包位于 `Electron Framework.framework/Resources/*.lproj` 而非 afterPack 处理的 locales 目录，mac 产物多约 54M（待下版给 afterPack 加 mac 分支）

### v0.6.0 发布实录（tag 复位重发）

首跑三平台成功后验证资产发现 pickAsset 正则与实际 mac zip 命名不匹配 → 修复 → tag 复位到修复提交重触发（mac/linux 产物覆盖为修复版）；Windows job 因上述 shell 问题上传被跳过，保留首跑产物（本次 diff 仅 darwin 死代码 + workflow 文件，不影响 Windows 功能，exe/blockmap/latest.yml 三件套同源自洽）；残留调试文件已 API 删除；已补发布说明。

### 验证

- Linux 本机：--mac --dir 双架构 .app 产出（Info.plist 版本/关联/分类正确）、Linux deb 全链回归（Recommends 后处理正常）、src/ 零改动、启动冒烟正常
- CI：三平台构建成功；16 资产完整上传（mac dmg×2/zip×2+blockmap、win exe+blockmap+latest.yml、linux deb×2+组件×3、latest-mac.yml）
- pickAsset 正则修正后单测：arm64 优先/x64 回退/防误选 converters/win+linux 不变 全过

### 遗留

- Apple Developer 签名公证（$99/年）→ 解锁 macOS 自动更新与免"右键打开"
- macOS 语言包裁剪（afterPack 加 mac 分支，可减 ~54M）
- icon 1024 母版重制
- converters-component 真机 macOS 验证
- 下次发布建议对本轮改动补一次 workbuddy 审查

> AI生成

## v0.7.0 .xls 老格式支持 + 沉浸式预览 + 平台风格适配（2026-11-04）

三项用户需求（方案经确认：.doc/.ppt 不做——纯 JS 无渲染库；平台风格取稳妥版；无侧栏固定开关）。

### 1. .xls（Excel 97-2003）完整支持

- 白名单链路 7 处：fileHelpers（SUPPORTED/FORMAT_META/MIME_MAP）、main.cjs 两处、UploadZone、PreviewViewport case、ConvertPanel 转换入口、converters.js to-pdf 分发（`ext === '.xlsx' || ext === '.xls'`）、package.json fileAssociations
- 原理：XlsxRenderer 与转换组件同用 SheetJS `XLSX.read()`，其原生识别 BIFF2/5/8 → 预览/转 PDF 双链路零适配成本
- 验证：生成 BIFF8 中文双 sheet 测试文件（aoa_to_sheet bookType:'biff8'）→ 预览渲染（中文/数字/日期/双 sheet 标签）与 to-pdf 转换（CONVERT_OK）均实测通过

### 2. 沉浸式预览（侧栏自动隐藏）

- 交互：打开文件 → 侧栏自动收起、预览区全宽；鼠标移到屏幕左缘（8px 热区）→ 工具栏浮层滑出（fixed z-40 + 阴影，不挤压文档）；鼠标移开 300ms 防抖收起；空态恢复常驻
- 实现（App.jsx）：`immersive = !!currentFile`；浮层态侧栏容器切 fixed + translate 动画（300ms ease-out，will-change-transform）；热区 z-30 低于侧栏（展开时被覆盖，mouseEnter 直接 setSidebarOpen）；scheduleHide/cancelHide 用 ref 计时器
- 冒烟钩子增强（main.cjs DOCLITE_SMOKE 块，dev-only）：新增 INTERACT/DARWIN 模式——sendInputEvent 分步模拟鼠标路径（热区→侧栏内→文档区）+ executeJavaScript 实测 computed transform
- ⚠️ 测试方法论记录：sendInputEvent 瞬移不触发中间元素的 enter/leave（Chromium hover 由鼠标事件驱动 hit-test），首测"直接瞬移到文档区"测得侧栏不收起——是测试假象非功能 bug；分步路径复测后 transform=-336px 收起正常。真实用户鼠标路径天然连续，无此问题。

### 3. 平台风格适配（稳妥版）

- macOS：`titleBarStyle: 'hiddenInset'`（标题栏并入界面保留红绿灯）+ `vibrancy: 'under-window'` 毛玻璃 + backgroundColor 透明（main.cjs darwin 分支）；CSS（index.css 平台段）：header 拖动区（-webkit-app-region: drag）+ 红绿灯 78px 留白 + 根容器/顶栏半透明（ink-50/86%）透出毛玻璃、文档区保持白底（侧栏保持不透明，避免文档文字透出重影）
- Windows：Segoe UI/微软雅黑字体栈；Linux：Cantarell/Ubuntu 字体栈；两平台保留系统标题栏
- 平台类挂载：preload 暴露 `platform: process.platform` → main.jsx 给 html 挂 platform-darwin/win32/linux；渲染层读不到时兜底 'linux'
- 验证：Linux 本机 platform-linux 生效 + 手动切 platform-darwin 类模拟截图（布局无崩溃、留白生效）；毛玻璃/红绿灯真实效果需 macOS 真机验收（CI 构建后用户实测）

### 4. workbuddy 审查修复（发布前，2026-11-04）

审查报告：`~/文档/Obsidian Vault/检查doclite-v0.6.0补审与v0.7.0.md`（范围 A：v0.6.0 macOS/CI 补审；范围 B：v0.7.0 工作区改动）

- **H1 组件 zip 三平台重复上传**：release.yml 的 Pack converters 步骤加 `if: matrix.platform == 'linux'`（原先三平台各自产出同名 zip，字节可能不同 → 资产的 zip 与 .sha256 可能来自不同 job，用户安装必报 sha256 不匹配）；pack-converters.cjs 显式 `zipSync(files, { level: 9, mtime: FIXED_MTIME })`，本地连打两次 sha256 一致（a06533f0…）
- **H2 macOS 未签名**：afterPack.cjs 新增 darwin 分支——先裁 `*.lproj`（Electron Framework Resources，55 个约 57M，保留 en/zh_CN/zh_TW），再 `codesign --force --deep --sign -` ad-hoc 重签；解决 CI 无证书时 electron-builder 直接跳过签名、下载后首启被判“已损坏”的问题（未公证仍需右键打开/xattr）；README 补 `xattr -cr` 排障说明
- **M1 组件热更新不生效**：convertersLoader 新增 `resetConvertersApi()`（删全局、清 scriptPromise、移除注入 script），注入时加 `data-doclite-converters` 标记 + `?v=版本` 破缓存；useConverters 在 install/uninstall 成功后先重置再 refresh（此前界面显示新版本但 convert 仍跑旧 bundle）
- **M2 .xls 版本门槛**：ConvertPanel 对 `outdated && ext==='.xls'` 禁用导出按钮并提示“当前组件不支持 .xls”，落后横幅改为带一键“更新到 vX”按钮（旧组件 convertFile 只认 .xlsx）
- **M3 CI 权限收敛**：release.yml 去掉 job 级 GH_TOKEN，仅“Upload release assets”步骤注入（npm ci/electron-builder 不再全程持有可写 token）
- **M5 销毁窗口误发消息**：notifyRenderer 加 `mainWindow.isDestroyed()` 判断；createWindow 补 `closed` 监听置空 mainWindow（macOS 关窗不退出后，Finder 双击文件会打向已销毁 webContents）
- **低优顺手**：侧栏收起时 `aria-hidden` + `inert`（L1）；热区注释改为如实说明会吃掉左缘 8px 点击（L2）；侧栏改不透明（L3）；`top-14` 改 `top-[var(--header-h)]`（L4）；ci.yml 删除无用 GH_TOKEN（L7）
- **验证**：npm run build 通过；冒烟实测 .xls 双 sheet 预览正常、沉浸侧栏收起 transform=-336px、平台类模拟截图正常；两个 workflow YAML 解析通过
- **留待下轮**：M4（macOS 更新弹窗文案/交互）、M6（哈希期望值走镜像的信任根）、L5（xlsx CVE，评估 SheetJS 官方 CDN）、L6（action pin commit SHA）

### 5. 中/英文界面（i18n，2026-11-04）

用户要求 GitHub 站点的自述/发行说明双语化，并给应用加英文界面（原确认全中文、无 i18n）。

- **文档双语化**：新增 `README.en-US.md`（完整英文版）；README.md 顶部加 [English] 入口；v0.7.0 发布说明补英文版
- **应用 i18n**：新建 `src/i18n.jsx`（零第三方依赖）——中英双字典 + React Context（I18nProvider / useI18n），`t(key, vars)` 支持插值；语言首次按系统语言检测、顶栏按钮手动切换、localStorage 记住
- **覆盖范围**：约 17 个组件的全部界面文案（Header/Sidebar/UploadZone/EmptyState/Toolbar/Viewport/ConvertPanel/UpdateDialog/ErrorToast + 6 个渲染器 + useConverters），以及主进程/转换器经 IPC 回传的错误与提示（以中文原文为 key 映射英文，未收录原样回退；ErrorToast 统一走 t 透传翻译）
- **语言入口**：Header 右侧“EN / 中文”按钮；document.title 随语言切换
- **验证**：npm run build 通过；浏览器实测中文 ↔ 英文切换与刷新记忆正常（localStorage=doclite-lang）；Electron 冒烟 .xls 预览与沉浸侧栏无回归
- **待办**：i18n 属新功能，按发布规范需 workbuddy 审查后再发版；后续可评估把主进程错误也改为“错误码 + 渲染层文案”以彻底解耦

### 6. i18n workbuddy 审查修复（0.8.0 发布前，2026-11-04）

审查报告：`~/文档/Obsidian Vault/检查doclite-i18n双语界面.md`。按结论修复：

- **H1**：ConvertPanel 两处 `{compError}` 改 `{ts(compError)}`；`ts()` 补「组件安装/校验」前缀规则（含不允许文件、解压失败、需升级主程序、当前版本无匹配包）
- **H2**：zh 字典补 `renderer.azw.sectionFailed`（此前 en 有 zh 缺，中文用户会看到原始 key）；字典改为纯文本（去掉内联 HTML，杜绝翻译资源注入面）
- **M1**：UpdateDialog 错误主文案 `t(errorMsg)` 改 `ts(errorMsg)`（正则兜底才生效）；`ts()` 补更新链路规则（安装失败：、GitHub 响应异常、下载失败(HTTP)、已自动切换、feed 版本不高、源均失败、·差量、源过慢）
- **M2**：`useUpdater` 接入 `useI18n`，兜底文案用 t('updater.checkFailed' / 'updater.installIncomplete')（此前整文件漏接，死键复用）
- **M3**：`App.jsx` `useOpenFileFromArgs` 改用 `tRef.current`（闭包 bug——切英文后文件关联报错仍中文）；Md/Azw3 的瞬态文案遗留下轮
- **M4**：`document.documentElement.lang` 随语言切换（a11y）
- **M5**：`resolve()` 在 DEV 下对「en 缺 key」告警；`ts()` 增加 `s==null` 守卫
- **低优**：L1（补转换器脚本两条中文错误键）、L3（注释/import 归位、顶部说明补「勿把 t 加依赖」）、L5（语言切换 aria-label 动态说明目标语言）、L6（en README 顶部改英文引导）、L7（`navigator.languages` 优先）
- **验证**：npm run build 通过；Electron 冒烟 .xls 预览 + 沉浸侧栏收起 -336px 无回归
- **遗留**：M3 的 MdRenderer notices / Azw 章节失败占位文案（瞬态）不随切语言重算，下轮改存 key；导出物（PDF/Word/MOBI）内嵌文案仍是中文（L2，成本高，记为已知限制）

### 7. 用户反馈三项修复（2026-11-05，待 workbuddy 审查）

来源：`~/文档/Obsidian Vault/doclite项目中的问题_20261105.md`

1. **AZW3/MOBI 每章出现英文副标题**（如“HOW AN ECONOMY / GROWS AND / WHY IT CRASHES”）
   - 根因：章节标题（第X章，h3）后常先有一行中文章名，其后再跟多行大写英文副标题；原副标题收集器在“h3 → 中文标题行”后就被打断，导致英文副标题漏进正文
   - 修复（converters.js pdfToAzw3）：新增 `looksLikeTitleLine`，标题后的中文短标题行正常输出但**保持副标题收集状态**，其后连续英文大写行仍被整组丢弃；`subtitleActive` 标记统一管理收集/丢弃
   - 验证：判定函数样例命中；构建 + Electron 冒烟通过。问题 1 属**单元样例验证**，无源 PDF，端到端待样本/真机复核（workbuddy L8 已修正措辞）
2. **沉浸热区改为窗口左边 20%**
   - 原为固定 8px（w-2）；按用户要求改为 `w-[20%]`（App.jsx），鼠标移到界面左边 20% 即滑出
   - 注意：热区覆盖区域内的鼠标点击会被占用（PDF 左缘选词等），为交互代价，已在注释说明
3. **macOS 升级弹窗**（原点击“下载更新”后报错“macOS 暂不支持自动更新…”，红底 error + 关闭/重试）
   - 修复（UpdateDialog）：`info.manualDownload` 时“有新版本”面板改为「前往下载」按钮（openExternal 打 Release 页），不再触发下载/报错；error 态若为 macOS 手动更新消息，改显「手动更新」引导 + 关闭/前往下载，不再给“重试”
   - i18n 补 `update.macManualTitle/Hint/goDownload` 中英键

### 8. 三项问题修复·workbuddy 审查修复（0.8.1 发布前，2026-11-05）

审查报告：`~/文档/Obsidian Vault/检查doclite-三项问题修复.md`。按结论修复：

- **H1 热区改窗口级 mousemove**：删除固定定位蒙层（蒙层与预览滚动容器是兄弟节点，左 20% 区域的点击/滚轮/触摸滚动全部失效且光标变箭头）；App.jsx 改为 `mousemove` 判定 `clientX <= innerWidth * 0.2`，`sidebarOpenRef` 镜像状态避免高频 setState；同步删除 `.immersion-hotzone` 样式
- **H2+M1 副标题过滤改“标题后有限窗口”**：`postHeading = 3`（按已输出行计数：窗口内大写英文行=副标题整组丢弃且不占窗口；普通行输出并消耗一格；窗口耗尽后大写英文按正文处理），误删范围限定在标题后 3 行内；`looksLikeTitleLine` 放宽为只挡句读「。！？；」（允许 ：、，）、长度 1..60（H2 的 B/C/D 复现样例全部转通过）
- **M2**：窗口内中文短标题/章名行独立成段（flushPara 包裹），不再与正文首句拼段
- **样例实测新发现并修复**：`stripEnglishSubtitleTail` 此前会把纯英文副标题行截成残词（"HOW AN ECONOMY"→"HOW"、"WHY IT CRASHES"→"WHY"）漏进正文；现限定仅对**含中文**的行做尾部剔除
- **M3**：`openDialog` 在 error 态也自动重新检查——macOS 手动更新引导后，侧栏「检查更新」不再只是重开旧面板
- **M4**：主进程不再往 `releaseNotes` 尾部拼中文手动更新说明（英文界面会混入整段中文），只下发 `manualDownload` 标记，文案由渲染层 i18n 组装
- **低优**：L1 `releasePageUrl` 由主进程统一下发（渲染层删掉第二份硬编码仓库地址）；L2 「前往下载」点完关弹窗；L3 `isMacManual` 判定收窄（`=== true` 或固定前缀正则）；L7 单字标题（如「序」）可命中；L8 第 7 节验证措辞修正
- **验证**：8 组状态机样例（含审查 B/C/D/E 复现样例与同物理行尾巴剔除）全部通过；`npm run build` 通过；Electron 冒烟 `.xls` 预览 + 侧栏滑出/收起（-336px）正常
- **已知限制（预存在）**：副标题过滤窗口不跨页（标题在页尾、副标题在次页顶部会漏）；英文副标题含冒号/Title Case 不识别（维持现状防误删正文）

### 9. L4 集成测试重写 + R-096 pdfjs worker 缺失修复（2026-11-07）

B-020 / V-002 的本地端到端闭环（接手 `npm run handoff` 交接指令包的唯一 🔴 项）。

- **修 `project-status.mjs` 基建误报**：原是 P1 方案（检查 `scripts/smoke.cjs` 单文件、package.json test script——早被 D-033 四层套件取代）→ 持续报 3 ✗；重写为检查 npm scripts 齐备 + `run.mjs` + 三套测试脚本存在性 → 3 ✓
- **重写 L4 `scripts/smoke/integration-app.cjs`**（A 环境准备 / B 沉浸交互 / C 转换端到端，共 27 项断言）：
  - 修复原 4 项误报：`.app-sidebar` 仅沉浸态挂载（改测侧栏根节点）、固定 sleep 换轮询等待、瞬移不触发 DOM enter/leave（改单步跳变驱动窗口级 mousemove）、隐藏窗口过渡冻结（B 段前 `showInactive()`）
  - B 段防回归：打开文件自动收起（轮询至 -336）、x=200（左 20% 内）滑出侧栏（守住 v0.8.1 20% 热区方案，防退回 8px）、分步移出收起
  - C 段（B-017/B-020/V-002 本地部分）：`printToPDF` 合成含用户报告结构的 PDF（两章 + 每章中文章名 + 三行大写英文副标题 + 目录页）→ 注入真实组件 bundle → `convertFile('to-azw3')` 真实转换（拦 `downloadBlob` 产物落盘）→ 用应用自身 foliate-js 预览打开 → C5 正文零英文副标题 / C6 中文章名保留 / C7 目录无英文 / C8 目录含两章标题
- **R-096 新发现并已修**（v0.5.0 组件拆分起即存在的真实缺陷）：组件 bundle 内联的 pdfjs 与主应用是两个模块实例，组件从未配置 workerSrc → **应用内 PDF 转 Word/PNG/AZW3 全部抛 `No "GlobalWorkerOptions.workerSrc" specified.`**；此前单元测试全测纯函数、端到端从未跑过（V-002 缺口的实证，顺带证实用户此前报不出此错的链路）。修复：`converters.js` 模块顶层同步捕获 `document.currentScript` 合成组件目录定位 worker；`vite.config.converters.js` 构建期 `copy-pdfjs-worker` 插件复制 worker 到 `dist/converters/assets/`（不能用 `?url`——Vite lib 模式内联成 data: URL，Chromium/CSP 拒绝 data: worker）；`pack-converters.cjs` 把 `assets/**` 纳入 zip/deb/manifest 并对 worker 缺失硬校验中断打包。方案全文见 STATE.md D-036
- **测试方法论沉淀**（STATE.md D-037）：隐藏窗口 CSS 过渡不推进（300ms 实测 1.8s 悬挂）、hover hit-test 不更新、printToPDF + Noto CJK 汉字变康熙部首变体（⼗≠十、目录→⽬录）→ 对策：`showInactive()` / 轮询 transform / fixture 目录页标题用英文 `Contents` + `normCJK()` 归一化
- **MOBI 目录来源确认**：foliate-js 从书内目录页的 `a[filepos]`（guide 指向）读 TOC，源 PDF 无目录页则 TOC 为空——旧 C8 失败是 fixture 覆盖问题而非缺陷
- **验证**：`npm run build`（含组件 bundle）通过；`npm run smoke` **93/93 项全过（0 失败 0 跳过）**，L4 B/C 段全绿；转换产物存 `.smoke-report/smoke-subtitle-e2e.pdf / .mobi` 供人工复核
- **待真机**：B-020 / V-002 剩原始样本 PDF + Kindle/文石真机复核；R-096 修复随 v0.8.2 组件发布才对存量用户生效（旧组件装入新应用不报错但转换仍坏，见 D-036 兼容边界）

### 遗留

- .doc/.ppt 不支持（无纯 JS 渲染库；如需可后续做二进制文本提取，本期按确认不实施）
- macOS hiddenInset+vibrancy 效果待真机验证
- H2 的 ad-hoc 重签与 .lproj 裁剪需 macOS CI/真机验证（本机 Linux 无法运行 .app）
- v0.8.1 三项修复（B-017~B-019）：本地端到端已闭环（2026-11-07 L4 C 段），剩原始样本 PDF + Kindle/文石真机复核（B-020 / V-002）

> AI生成
