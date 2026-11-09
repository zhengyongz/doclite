# DocLite 问题清单（TASKS）

> **本文件是项目问题的唯一事实源。** 任何 Agent（星辰 / WorkBuddy / 人）在开始工作前必须先读本文件。
> 状态变更必须立即回写本文件，不允许只在对话或 commit message 里口头提及。
> 审查报告原文归档在 `docs/reviews/`，本文件只保留可执行条目。

## 状态字典

| 状态 | 含义 | 下一步责任方 |
|---|---|---|
| `待修` | 已确认存在，未开始 | 星辰 |
| `进行中` | 正在修改 | 星辰 |
| `待验` | 代码已改，等待冒烟/真机验证 | 星辰 → 人 |
| `已修` | 已验证修复，标注关闭版本 | — |
| `已知限制` | 判定不修，记原因 | — |
| `已搁置` | 暂不做，记原因 | — |

## 优先级字典

| 标记 | 含义 |
|---|---|
| 🔴 | 高 —— 安全、数据损坏、核心功能不可用，或已承诺发版前必修 |
| 🟡 | 中 —— 功能缺陷、体验问题、一致性风险 |
| ⚪ | 低 —— 清理项、一致性、可选加固 |

## ID 规则

`R-xxx` 审查意见与测试发现 · `B-xxx` 手动测试/用户反馈 · `T-xxx` 开发过程中的技术债 · `V-xxx` 验证缺口

---

## 一、汇总看板

> 数字由 `npm run status` 统计生成，与下方条目一一对应。

| 维度 | 数量 |
|---|---|
| 总条目 | **144** |
| ├ R-xxx 审查意见 | 107 |
| ├ B-xxx 用户反馈 | 24 |
| ├ T-xxx 技术债 | 8 |
| └ V-xxx 验证缺口 | 5 |
| 🔴 高 | 14（+ B 段 24 项按 🔴 计） |
| 🟡 中 | 59 |
| ⚪ 低 | 47 |

| 状态 | 数量 |
|---|---|
| 已修 | 79 |
| 已知限制 | 7 |
| **未闭环（待修 56 + 待验 2）** | **58** |

**未闭环分布**：🔴 0 · 🟡 31 · ⚪ 27

### 未闭环高优先级（当前 0 项）

> 2026-11-09：B-020 经用户真机复核闭环；当轮新报 B-021~B-024 三修一登记，无新增 🔴 遗留。

### 未闭环中优先级（31 项，按主题归类）

| 主题 | 条目 | 数量 |
|---|---|---|
| 升级链路安全与健壮性 | R-023、R-033、R-034、R-035、R-036、R-037 | 6 |
| Markdown 查看功能 | R-029、R-030、R-031、R-032 | 4 |
| 性能与内存 | R-038、R-039、R-040、R-041、R-043、R-044、R-046 | 7 |
| 依赖与供应链 | R-053、R-054 | 2 |
| 验证缺口 | V-003、V-005 | 2 |
| 开发技术债 | T-001、T-002、T-003、T-005、T-006 | 5 |
| 清理项 | R-049 | 1 |
| v0.8.2 审查发现（worker/组件安全/测试） | R-097、R-099、R-100、R-101 | 4 |

### 未闭环低优先级（27 项）

R-056、R-057、R-058、R-060、R-061、R-070、R-080、R-081、R-082、R-083、R-084、R-085、R-086、R-087、R-088、R-089、R-090、R-091、R-092、R-093、R-094、R-102、R-103、R-104、R-105、R-106、R-107

> 其中 **R-033 / R-034 / R-037** 虽列 🟡，实为升级链路安全项（渲染层可指定任意路径 / 任意剪贴板内容 / 无大小校验），**建议提到 🔴**（见 Q-005）。

---

## 二、🔴 高优先级

| ID | 来源 | 问题 | 定位 | 状态 | 关闭版本 | 备注 |
|---|---|---|---|---|---|---|
| R-001 | 审查 v0.5.0 H1 | 渲染层回传写盘构成持久化 XSS 通道 | `electron/converters-component.cjs` | 已修 | v0.5.1 | 已加文件名白名单 `ALLOWED_FILES` + `converters.js` 哈希校验 |
| R-002 | 审查 v0.5.0 H1 | macOS 产物未签名（非 ad-hoc），首次启动大概率"已损坏" | `build/afterPack.cjs` / `release.yml` | 已修 | v0.7.0 | ad-hoc 重签 `codesign --force --deep --sign -`；**未公证**，见 R-003 |
| R-003 | 审查 v0.6.0 H2 | macOS 未做 Apple Developer ID 签名与公证 | `release.yml` | 已知限制 | — | 需 Apple 开发者账号（$99/年）。未公证 → 用户须右键打开或 `xattr -cr`。**决策见 STATE.md D-008** |
| R-004 | 审查 三项修复 H1 | 20% 热区固定蒙层导致左 1/5 区域滚轮/触摸滚动完全失效 | `src/App.jsx` | 已修 | v0.8.1 | 已删蒙层，改窗口级 `mousemove` 判定 `clientX <= innerWidth*0.2` |
| R-005 | 审查 三项修复 H2 | 中文副标题含「：、，」或超 40 字时，原 bug 原样复现 | `src/utils/converters.js:836` | 已修 | v0.8.1 | `looksLikeTitleLine` 放宽为只挡「。！？；」，长度 1..60 |
| R-006 | 审查 三项修复 M1 | `subtitleActive` 无窗口上限，中文短行把状态带进正文，误删正文大写英文行 | `src/utils/converters.js:919` | 已修 | v0.8.1 | 改为「标题后 3 行」有限窗口 `postHeading = 3` |
| R-007 | 审查 三项修复 M2 | 中文章名副标题被并进正文首段，非独立段落 | `src/utils/converters.js` | 已修 | v0.8.1 | 窗口内中文短标题用 `flushPara` 包裹独立成段 |
| R-008 | 审查 三项修复 M3 | macOS 手动更新面板无「重新检查」，侧栏「检查更新」一直重开旧面板 | `src/components/UpdateDialog.jsx` | 已修 | v0.8.1 | `openDialog` 在 error 态也自动重新检查 |
| R-009 | 审查 三项修复 M4 | macOS 英文界面更新说明仍插入整段中文 | `electron/updater.cjs:196` | 已修 | v0.8.1 | 主进程不再拼中文说明，只下发 `manualDownload` 标记 |
| R-010 | 审查 i18n H1 | 英文界面下组件安装/卸载失败整段显示中文，绕过翻译层 | `src/components/ConvertPanel.jsx` | 已修 | v0.8.0 | `{compError}` 改 `{ts(compError)}` |
| R-011 | 审查 i18n H2 | 中文界面 AZW3 章节渲染失败显示原始 key | `src/i18n.jsx:118` | 已修 | v0.8.0 | zh 字典补 `renderer.azw.sectionFailed` |
| R-012 | 审查 v0.6.0 H1 | 组件 zip 三平台重复上传，zip 与 sha256 可能来自不同 job | `.github/workflows/release.yml` | 已修 | v0.7.0 | Pack converters 步骤加 `if: matrix.platform == 'linux'` |
| R-013 | 审查 项目审查 #5 | Electron 安全加固不全：缺 sandbox / CSP / 窗口拦截 | `electron/main.cjs` | 已修 | v0.2.0 | 已开 `sandbox: true`、`setWindowOpenHandler`、`will-navigate`、index.html CSP |
| R-096 | L4 端到端 2026-11-07 | 组件 bundle 内联的 pdfjs 与主应用是两个模块实例、从未配置 workerSrc → 应用内 PDF 转 Word/PNG/AZW3 全部抛 `No "GlobalWorkerOptions.workerSrc" specified.`（组件拆分 v0.5.0 起即坏） | `src/utils/converters.js` + `vite.config.converters.js` + `build/pack-converters.cjs` | 已修 | v0.8.2 | worker 随组件 assets 发布（构建期复制 + 打包硬校验），方案见 STATE.md D-036；L4 C 段真实链路验证 |

---

## 三、🟡 中优先级

| ID | 来源 | 问题 | 定位 | 状态 | 关闭版本 | 备注 |
|---|---|---|---|---|---|---|
| R-014 | 审查 v0.5.0 M1 | `converters:install` 无并发互斥，双下载写同一文件 + installSession 覆盖致 Promise 悬挂 | `electron/converters-component.cjs` | 已修 | v0.5.1 | 模块级 `installing` 布尔互斥 |
| R-015 | 审查 v0.5.0 M2 | 组件版本与主程序可错配，`minAppVersion` 写入但从不校验 | `electron/converters-component.cjs` | 已修 | v0.5.1 | 已校验 `minAppVersion` 兼容性 |
| R-016 | 审查 v0.5.0 M3 | sha256 拿不到就跳过校验 + 解压无上限 → zip 炸弹 DoS | `electron/converters-component.cjs` | 已修 | v0.5.1 | 强制校验 sha256（缺失即中止）+ 三级上限 |
| R-017 | 审查 v0.5.0 M4 | 解压失败错误信息误导 + unzip-result 返回值语义失真 | `electron/converters-component.cjs` | 已修 | v0.5.1 | — |
| R-018 | 审查 v0.6.0 M1 | 组件更新后当前会话不生效：界面显示新版本，跑的仍是旧 bundle | `src/utils/convertersLoader.js` | 已修 | v0.7.0 | 新增 `resetConvertersApi()` + `?v=版本` 破缓存 |
| R-019 | 审查 v0.6.0 M2 | `.xls` 转换无组件版本门槛，旧组件下必然失败 | `src/components/ConvertPanel.jsx` | 已修 | v0.7.0 | `outdated && ext==='.xls'` 禁用导出 |
| R-020 | 审查 v0.6.0 M3 | `release.yml` 的 `contents: write` 未收敛到上传步骤 | `.github/workflows/release.yml` | 已修 | v0.7.0 | 去掉 job 级 GH_TOKEN，仅上传步骤注入 |
| R-021 | 审查 v0.6.0 M4 | macOS 更新弹窗文案与行为不匹配（显示 zip、点下载变错误页） | `src/components/UpdateDialog.jsx` | 已修 | v0.8.1 | 改「前往下载」引导 |
| R-022 | 审查 v0.6.0 M5 | macOS 关窗后 `open-file` 向已销毁窗口发消息 | `electron/main.cjs` | 已修 | v0.7.0 | `isDestroyed()` 判断 + `closed` 监听置空 |
| R-023 | 审查 v0.6.0 M6 | 升级校验的「期望哈希」本身也走镜像，size 交叉核对挡不住同尺寸替换 | `electron/updater.cjs` | 待修 | — | **信任根问题**，需从可信源取 sha256 或引入签名 |
| R-024 | 审查 i18n M1 | 升级链路错误/进度文案大面积未收录，`UpdateDialog` 用 `t()` 而非 `ts()` | `src/components/UpdateDialog.jsx` | 已修 | v0.8.0 | 改 `ts(errorMsg)` + 补规则 |
| R-025 | 审查 i18n M2 | `useUpdater.js` 整文件未接入 i18n，3 个备好英文键成死键 | `src/hooks/useUpdater.js` | 已修 | v0.8.0 | 接入 `useI18n` |
| R-026 | 审查 i18n M3 | 切换语言后已「捕获成中文」的文案不跟着变（含真实闭包 bug） | `src/App.jsx` | 已修 | v0.8.0 | 改用 `tRef.current` |
| R-027 | 审查 i18n M4 | `<html lang>` 不随语言切换（a11y） | `src/i18n.jsx:472` | 已修 | v0.8.0 | `document.documentElement.lang` 随语言 |
| R-028 | 审查 i18n M5 | 英文缺 key 时静默回退中文，无告警无守卫 | `src/i18n.jsx:392` | 已修 | v0.8.0 | DEV 下 `console.warn` |
| R-029 | 审查 md功能 M1 | 超大 Markdown 无阈值降级：主线程同步解析 + 全量 DOM 渲染 | `src/components/renderers/MdRenderer.jsx` | 待修 | — | 触发需主动打开超大 MD，失败形态为可感知卡顿 |
| R-030 | 审查 md功能 M2 | 非 UTF-8 文件的错误提示永远不可达，实际表现为静默乱码 | `src/components/renderers/MdRenderer.jsx` | 待修 | — | — |
| R-031 | 审查 md功能 M3 | Markdown 内的链接点击后毫无反应 | `src/components/renderers/MdRenderer.jsx` | 待修 | — | — |
| R-032 | 审查 md功能 M4 | 快速切换文件时渲染竞态，可能显示上一个文件的内容 | `src/components/renderers/MdRenderer.jsx` | 待修 | — | — |
| R-033 | 审查 自动升级 H1 | `updater:open-installer` 未限定目标路径，可打开渲染层传入的任意路径 | `electron/updater.cjs` | 待修 | — | **安全项，建议提到 🔴** |
| R-034 | 审查 自动升级 M1 | `updater:copy-install-cmd` 未校验入参，剪贴板内容可被渲染层任意指定 | `electron/updater.cjs` | 待修 | — | 安全项 |
| R-035 | 审查 自动升级 M2 | 快速双击「下载更新」把 UI 误切 error 态（下载实际仍在进行） | `src/components/UpdateDialog.jsx` | 待修 | — | — |
| R-036 | 审查 自动升级 M3 | 手动检查绕过缓存且按钮无防抖，易触发 GitHub API 限额 | `src/components/UpdateDialog.jsx` | 待修 | — | 60 次/小时/IP |
| R-037 | 审查 自动升级 M4 | 响应无 content-length 时大小校验被跳过，磁盘可被无限写入 | `electron/updater.cjs` | 待修 | — | 安全项 |
| R-038 | 审查 项目审查 #7 | `pdfToDocx` 提取文字未记录 `x` 坐标，`groupTextByLine` 内排序形同虚设 | `src/utils/converters.js:486` | 待修 | — | 多栏/交错文本可能错序 |
| R-039 | 审查 项目审查 #9 | PPT 解析逻辑在 `PptxRenderer.jsx` 与 `converters.js` 重复实现两份 | `src/components/renderers/PptxRenderer.jsx` | 待修 | — | 建议抽公共模块 |
| R-040 | 审查 项目审查 #10 | `PdfRenderer` 加载时逐页 `getPage` 取高度，上千页首屏前卡很久 | `src/components/renderers/PdfRenderer.jsx` | 待修 | — | 可只取第 1 页高度近似 |
| R-041 | 审查 项目审查 #1 | 转换时内存峰值高：所有页 canvas 攒在内存 + base64 再涨 33%，长文档易 OOM | `src/utils/converters.js` | 待修 | — | — |
| R-042 | 审查 项目审查 #2 | Excel 大表 `Math.max(...rows.map())` 行数超 10 万抛 RangeError | `src/utils/converters.js:132` | 已修 | v0.4.2 | 已改 reduce 循环 |
| R-043 | 审查 项目审查 #3 | `Azw3Renderer` 封面 blob URL 泄漏（清理 effect 捕获首次渲染的 null） | `src/components/renderers/Azw3Renderer.jsx` | 待修 | — | — |
| R-044 | 审查 项目审查 #6 | 异步任务无取消机制，切文件时旧 Promise 不 abort，状态竞态 + objectURL 泄漏 | 多处渲染器 | 待修 | — | — |
| R-045 | 审查 项目审查 #4 | `Azw3Renderer` 用 `dangerouslySetInnerHTML` 渲染电子书 HTML 未消毒 | `src/components/renderers/Azw3Renderer.jsx:319` | 已修 | v0.2.0 | 已引入 DOMPurify 消毒 |
| R-046 | 审查 项目审查 #8 | Office→PDF 转换未接 `onProgress`，只有 spinner 无百分比 | `src/utils/converters.js` | 待修 | — | 体验不一致 |
| R-047 | 审查 项目审查 #11 | `FileContext` Provider value 每次渲染新建对象，所有消费组件重渲染 | `src/context/FileContext.jsx:72` | 已修 | v0.2.0 | 已用 `useMemo` 包裹 |
| R-048 | 审查 项目审查 #12 | `DocxRenderer` 用 50ms×20 轮询等 ref 出现 | `src/components/renderers/DocxRenderer.jsx:43` | 已修 | v0.2.0 | 已改 `useLayoutEffect` |
| R-049 | 审查 项目审查 #16 | `converters.js` 文件头注释未列出 PDF→MOBI/AZW3 转换路径 | `src/utils/converters.js` | 待修 | — | 文档同步 |
| R-050 | 审查 三项修复 L5 | 副标题过滤窗口不跨页（标题在页尾、副标题在次页顶部会漏） | `src/utils/converters.js` | 已知限制 | — | 预存在；修复需把状态提到页循环外 |
| R-051 | 审查 三项修复 L6 | 英文副标题含冒号/Title Case（`How an Economy Grows`）不识别 | `src/utils/converters.js` | 已知限制 | — | 放宽会提高误删正文风险，**决策见 STATE.md D-006** |
| R-052 | 审查 i18n L2 | 导出物内容仍含中文（`— 第 N 页 —`、`<h1>目录</h1>`、`creator: 'DocLite 生成'`） | `src/utils/converters.js` | 已知限制 | — | 需把 lang 传进转换器，成本不低 |
| R-053 | 审查 v0.6.0 L5 | `xlsx@0.18.5` 是 npm 最后一版，存在 CVE-2023-30533 / CVE-2024-22363 | `package.json:45` | 待修 | — | 修复版只在 SheetJS 官方 CDN；.xls 支持扩大了 BIFF 解析面 |
| R-054 | 审查 v0.6.0 L6 | `actions/*@v4`、`softprops/action-gh-release@v2` 用可变 tag，发版 job 持写权限 | `.github/workflows/release.yml` | 待修 | — | 建议 pin 到 commit SHA |
| R-097 | 审查 v0.8.2 M2 | 系统级/deb 组件不读取 `minAppVersion`，新组件可装旧版应用 | `electron/converters-component.cjs:176-198` | 待修 | — | `readComponentInfo` 读 minAppVersion 标记 compatible，状态过滤 + UI 提示；D-036 措辞需修正 |
| R-098 | 审查 v0.8.2 M3 | 旧组件缺 worker 时报原始英文错误，PDF 转换未前置拦截 | `src/components/ConvertPanel.jsx` + `src/i18n.jsx` | 已修 | v0.8.2 | 已做 `.pdf` 过时门槛（to-docx/png/azw3 禁用）+ ts() worker 报错映射；余「workerOk 主进程探测」可 0.8.3 补 |
| R-099 | 审查 v0.8.2 M4 | `manifest.files` 只写不校验，安装后还写成数字 | `electron/converters-component.cjs:137-165,335` | 待修 | — | 校验清单与键集合一致；写回保留数组或改 `fileCount` |
| R-100 | 审查 v0.8.2 M5 | `assets/../converters.js` 可绕过脚本哈希覆盖（`..` 归一化） | `electron/converters-component.cjs:55-60,231` | 待修 | — | 拒绝 `.`/`..` 段 + 归一目标去重 + 受保护文件最后写 |
| R-101 | 审查 v0.8.2 M1+M6 | L4 C2 空断言；CI 不跑 L4/xvfb，R-096 类缺陷无回归门禁 | `integration-app.cjs:348`、`ci.yml` | 待修 | — | CI worker 存在性门禁已在 v0.8.2 完成；余：去 C2 短路 + xvfb L4 |

---

## 四、⚪ 低优先级

| ID | 来源 | 问题 | 定位 | 状态 | 关闭版本 | 备注 |
|---|---|---|---|---|---|---|
| R-055 | 审查 v0.5.0 L1 | `clean.includes('..')` 过严，合法文件名含 `..`（如 `a..b.js`）被误拒 | `electron/converters-component.cjs:93` | 已修 | v0.5.1 | 已改白名单方案，自然消失 |
| R-056 | 审查 v0.5.0 L2 | `img-src ... file:` 放宽疑无必要 | `index.html:8` | 待修 | — | 组件无图片资产，DOMPurify 亦拒绝 |
| R-057 | 审查 v0.5.0 L3 | 卸载只删 `converters` 目录，不清 `.installing` 残留与 zip | `electron/converters-component.cjs` | 待修 | — | — |
| R-058 | 审查 v0.5.0 L4 | 「更新组件」按钮不比对版本、装完无完成反馈；`uninstall` 无 UI 入口（死路径） | `src/components/ConvertPanel.jsx` | 待修 | — | — |
| R-059 | 审查 v0.5.0 L5 | 每次 ConvertPanel 挂载都触发 3 目录磁盘 IO | `src/useConverters.js:12` | 已知限制 | — | IO 廉价，非必改 |
| R-060 | 审查 v0.5.0 L6 | `electron:dev` 每次串行跑两条 vite build（组件构建十几秒起） | `package.json:12` | 待修 | — | 建议加 `DOCLITE_SKIP_CONVERTERS=1` |
| R-061 | 审查 v0.5.0 L7 | Recommends 追加正则只匹配单行；xz9 重压缩约 4 分钟 | `build/pack-converters.cjs:87` | 待修 | — | 优化项非缺陷 |
| R-062 | 审查 v0.6.0 L1 | 沉浸态侧栏 DOM 仍在、可被 Tab 聚焦，读屏会读到 | `src/App.jsx:76` | 已修 | v0.7.0 | 已加 `aria-hidden` + `inert` |
| R-063 | 审查 v0.6.0 L2 | 注释写「透明热区不挡点击」，实际会吃掉最左 8px 点击 | `src/index.css:177` | 已修 | v0.7.0 | 注释已如实说明 |
| R-064 | 审查 v0.6.0 L3 | 浮层侧栏半透明无 backdrop-filter，下方文档文字透出形成重影 | `src/index.css:167` | 已修 | v0.7.0 | 侧栏改不透明 |
| R-065 | 审查 v0.6.0 L4 | `top-14` 写死 56px，与 Header 强耦合 | `src/App.jsx:95` | 已修 | v0.7.0 | 已改 `top-[var(--header-h)]` |
| R-066 | 审查 v0.6.0 L7 | CI 只读，`GH_TOKEN` 其实用不上 | `.github/workflows/ci.yml:23` | 已修 | v0.7.0 | 已删 |
| R-067 | 审查 三项修复 L1 | `RELEASE_URL` 渲染层硬编码第二份仓库地址 | `src/components/UpdateDialog.jsx:37` | 已修 | v0.8.1 | 改用主进程下发的 `releasePageUrl` |
| R-068 | 审查 三项修复 L2 | 点「前往下载」只开浏览器不关弹窗 | `src/components/UpdateDialog.jsx:37` | 已修 | v0.8.1 | 已补 `setOpen(false)` |
| R-069 | 审查 三项修复 L3 | `isMacManual` 用宽正则匹配 | `src/components/UpdateDialog.jsx:36` | 已修 | v0.8.1 | 收窄为 `=== true` 或固定前缀正则 |
| R-070 | 审查 三项修复 L4 | `flushSubtitle()` 空数组时残留 `null` | `src/utils/converters.js:924` | 待修 | — | 不影响逻辑，只影响可读性 |
| R-071 | 审查 三项修复 L7 | 单字中文标题（如「序」）不满足 `length >= 2` | `src/utils/converters.js` | 已修 | v0.8.1 | 长度下限放到 1 |
| R-072 | 审查 三项修复 L8 | DEVLOG 写「构建 + 冒烟通过」但无 macOS 真机验证 | `DEVLOG.md` | 已修 | v0.8.1 | 措辞已修正 |
| R-073 | 审查 i18n L1 | 两条中文错误未收录，会拼进英文前缀 | `src/utils/convertersLoader.js:16` | 已修 | v0.8.0 | 已补字典键 |
| R-074 | 审查 i18n L3 | 文件头注释写 `src/i18n.js`（实际 `.jsx`）；import 置于文件中部 | `src/i18n.jsx:1` | 已修 | v0.8.0 | 已归位 |
| R-075 | 审查 i18n L4 | 字典值里存 HTML 片段，长期是维护/注入隐患 | `src/i18n.jsx:251` | 已修 | v0.8.0 | 已改纯文本 |
| R-076 | 审查 i18n L5 | `aria-label="Switch language"` 未说切到哪种语言，无 `aria-pressed` | `src/components/Header.jsx:24` | 已修 | v0.8.0 | 已改动态说明 |
| R-077 | 审查 i18n L6 | 英文 README 顶部引导语仍为中文 | `README.en-US.md:14` | 已修 | v0.8.0 | 已改 |
| R-078 | 审查 i18n L7 | 只看 `navigator.language`，未看 `navigator.languages` | `src/i18n.jsx:15` | 已修 | v0.8.0 | 已优先 `navigator.languages` |
| R-079 | 审查 i18n L8 | 用了 `t` 但依赖数组不含 `t`（刻意为之，需注释防后人"顺手加上"） | 各渲染器 / `useConverters.js` | 已修 | v0.8.0 | 已补注释说明 |
| R-080 | 审查 自动升级 L1 | `compareVersions` 对预发布号处理粗糙 | `electron/updater.cjs` | 待修 | — | — |
| R-081 | 审查 自动升级 L2 | macOS `activate` 重建窗口后，updater 推送发往已销毁旧窗口 | `electron/updater.cjs` | 待修 | — | — |
| R-082 | 审查 自动升级 L3 | 响应头取值依赖单元素数组隐式转换 | `electron/updater.cjs` | 待修 | — | — |
| R-083 | 审查 自动升级 L4 | 下载目录旧版本安装包不清理 | `electron/updater.cjs` | 待修 | — | — |
| R-084 | 审查 自动升级 L5 | 冒烟截图写入 `__dirname/..`，打包环境下不可写 | `electron/main.cjs` | 待修 | — | — |
| R-085 | 审查 自动升级 L6 | 杂项一致性 | 多处 | 待修 | — | 详见原报告 |
| R-086 | 审查 自动升级 L7 | 无哈希完整性校验 | `electron/updater.cjs` | 待修 | — | 与 R-023 同源，见 D-007 |
| R-087 | 审查 md功能 L1 | `--no-sandbox` 加注方式脆弱，注释与代码已不一致 | `electron/main.cjs` | 待修 | — | — |
| R-088 | 审查 md功能 L2 | 双扩展名接入不完整（关联注册 / 文案 / README） | 多处 | 待修 | — | — |
| R-089 | 审查 md功能 L3 | 侧边栏「支持的格式」出现两条重复 MD 徽标 | `src/components/Sidebar.jsx` | 待修 | — | — |
| R-090 | 审查 md功能 L4 | MD 内的页内锚点跳转失效 | `src/components/renderers/MdRenderer.jsx` | 待修 | — | — |
| R-091 | 审查 md功能 L5 | DEVLOG 结构错位，出现两个 `> AI生成` 标记 | `DEVLOG.md` | 待修 | — | — |
| R-092 | 审查 md功能 L6 | `style` 属性默认放行，可做视觉覆盖 | DOMPurify 配置 | 待修 | — | 可选收紧 |
| R-093 | 审查 项目审查 #13 | 死代码：`MIME_MAP`、`formatSize`、`downloadMobi`、`linearSections`、`pdfjsLibGetPage` 等 | 多处 | 待修 | — | `downloadMobi` 仍在（`mobiWriter.js:1019`） |
| R-094 | 审查 项目审查 #14 | `ErrorToast` 内层 `setTimeout(clearError, 300)` 未纳入清理 | `src/components/ErrorToast.jsx` | 待修 | — | 影响极小 |
| R-095 | 审查 项目审查 #15 | `main.cjs` 未处理 macOS `open-file` 事件 | `electron/main.cjs` | 已修 | v0.6.0 | 已移至模块顶层注册 |
| R-102 | 审查 v0.8.2 L1 | 静态 `import pdfjs` 破坏「重依赖函数内动态 import」设计 | `src/utils/converters.js:28` | 待修 | — | 顶层只算 `WORKER_URL`，转换函数内 import 后再设 workerSrc |
| R-103 | 审查 v0.8.2 L3+L6 | 「27 项断言」实为 25 项；「复用 main.cjs」实为手工建窗 | `DEVLOG.md`、`scripts/smoke/integration-app.cjs` | 待修 | — | 修正文档；抽 `createMainWindow()` 供测试复用 |
| R-104 | 审查 v0.8.2 L2+L4+L5 | L4 只测 PDF→AZW3 未覆盖 DOCX/PNG；normCJK 覆盖不全；pdfWin 窗口泄漏 | `scripts/smoke/integration-app.cjs` | 待修 | — | 各加 1 条魔数断言；NFKC 先行；`try/finally destroy` |
| R-105 | 审查 v0.8.2 L7+L8 | smoke 触发真实 GitHub 请求；release.yml job 级 `contents: write` 仍在 | `integration-app.cjs`、`release.yml` | 待修 | — | `registerUpdater` 加 `autoCheck` 开关；上传拆独立 job |
| R-106 | 审查 v0.8.2 L9 | `pack-converters.cjs` 对 `assets/**` 递归收任意文件，未来 Vite 吐字体/图片会悄悄进包 | `build/pack-converters.cjs:32-44` | 待修 | — | 只收 `pdf.worker.min.mjs` 或按扩展名白名单（.mjs/.js/.wasm） |
| R-107 | 用户反馈 B-022 | 真 AZW3(KF8) 输出未实现（当前为 MOBI6 容器 + .mobi 扩展名） | `src/utils/mobiWriter.js` | 待修 | — | KF8 需 skeleton/FDST/RESC/双 MOBI 结构，工作量独立成轮；Kindle/文石对 MOBI6 支持完好；是否值得做待用户拍板（0.9.0 评估） |

---

## 五、🔴 用户反馈 / 手动测试发现

| ID | 来源 | 问题 | 定位 | 状态 | 关闭版本 | 备注 |
|---|---|---|---|---|---|---|
| B-001 | 2026-09-09 | PDF 转 mobi 后文石 TAB10C 无法打开 | MOBI 生成器 | 已修 | v0.2.0 | 新增 Kindle Paperwhite 验证通过 |
| B-002 | 2026-09-09 | 转换后章节排序乱 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-003 | 2026-09-09 | 转换后文字折行 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-004 | 2026-09-09 | 乱码 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-005 | 2026-09-09 | 脚本残留（HTML 标签未转义） | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-006 | 2026-09-09 | 文字没有排满行 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-007 | 2026-09-09 | 目录中多出「故事引申、现实链接」等条目 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-008 | 2026-09-09 | 点击章节不能跳转到对应页面 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-009 | 2026-09-21 | Kindle 目录多出「高风险投资」行且带跳转 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-010 | 2026-09-21 | 每章节跳转页面都有「how grows and why」 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-011 | 2026-09-21 | Kindle 中图片全部丢失（大量空白页） | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-012 | 2026-09-21 | PC 端打开 PPT 布局错乱 + 图片红叉 | `PptxRenderer.jsx` | 已修 | v0.2.0 | — |
| B-013 | 2026-09-21 | 文石可打开但点目录提示「how grows and why」 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-014 | 2026-09-21 | 文石点「目录」不列出目录 | MOBI 生成器 | 已修 | v0.2.0 | — |
| B-015 | 2026-09-21 | PC 端打开 PPT 布局错乱 + 无文字 | `PptxRenderer.jsx` | 已修 | v0.2.0 | — |
| B-016 | 2026-09-21 | `test_ppt.pptx` 是空白文件 | PPT 解析 | 已修 | v0.2.0 | — |
| B-017 | 2026-11-05 | AZW3/MOBI 每章出现「HOW AN ECONOMY GROWS AND WHY IT CRASHES」 | `src/utils/converters.js` | 已修 | v0.8.1 | 副标题过滤状态机重构 |
| B-018 | 2026-11-05 | 沉浸热区仅 8px，要求改为左 20% | `src/App.jsx` | 已修 | v0.8.1 | 最终改窗口级 mousemove（R-004） |
| B-019 | 2026-11-05 | macOS 升级弹窗报错「macOS 暂不支持自动更新」 | `src/components/UpdateDialog.jsx` | 已修 | v0.8.1 | 改「前往下载」引导 |
| B-020 | 2026-11-05 | 用户反馈三项修复后**端到端仍需真机复核** | 全链路 | 已修 | v0.8.2 | **V-002**；2026-11-09 用户真机确认英文副标题已消失 |
| B-021 | 2026-11-09 | 转 MOBI 后正文图片全部消失只剩封面（真机/应用内均复现） | `src/utils/converters.js` + `Azw3Renderer.jsx` | 已修 | v0.8.3 | 双根因：① `<img recindex>` 未按 MOBI 规范 5 位补零（Kindle/文石不认；v8 修复曾存在未入库脚本，converters 重写时丢失）；② DOMPurify 默认正则剥掉 foliate 生成的 blob: img src（应用内预览无图）。L4 C9 断言护网（提取+补零+加载全链） |
| B-022 | 2026-11-09 | 只能转 MOBI 不能转 AZW3 | `src/utils/converters.js` | 已知限制 | — | 输出本就是 MOBI6 容器（.mobi 扩展名是文石/Kindle 能开的前提）；真 AZW3=KF8 需独立生成器，见 R-107 |
| B-023 | 2026-11-09 | 含目录文件，鼠标移到目录位置被沉浸侧栏浮层遮挡 | `src/App.jsx` + `Azw3Renderer.jsx` | 已修 | v0.8.3 | 目录面板标 `data-toc-panel`，热区 mousemove 做 DOM 命中测试让路 |
| B-024 | 2026-11-09 | macOS 打开 PDF 清晰度低（Retina 模糊） | `PdfRenderer.jsx` | 已修 | v0.8.3 | 渲染 scale 随 devicePixelRatio（≤2），canvas 缓冲与 CSS 布局解耦；真机确认见 V-005 |

---

## 六、🟡 开发过程中的技术债

| ID | 问题 | 定位 | 状态 | 备注 |
|---|---|---|---|---|
| T-001 | macOS 语言包未裁剪（Electron Framework Resources 的 `*.lproj` 约 54M–57M） | `build/afterPack.cjs` | 待修 | afterPack 已加 darwin 分支裁剪，需验证实际减重 |
| T-002 | `icon.icns` 缺 1024×1024 母版 | `build/icon.png` | 待修 | 需重制 |
| T-003 | 转换组件未在 macOS 真机验证 | `electron/converters-component.cjs` | 待修 | — |
| T-004 | `.doc` / `.ppt` 不支持（无纯 JS 渲染库） | — | 已知限制 | 二进制文本提取方案本期不实施 |
| T-005 | macOS hiddenInset + vibrancy 效果未真机验收 | `electron/main.cjs` | 待修 | 需 macOS 真机 |
| T-006 | `converters.js` 单文件 2.2MB，dev 构建十几秒起 | 构建链 | 待修 | 与 R-060 同源 |
| T-008 | CI 每次重下 Electron 二进制（~100MB/平台/架构）+ winCodeSign + nsis 工具链 | `.github/workflows/` | 已修 | v0.8.2 | ci.yml 与 release.yml 均加 `actions/cache@v4` 缓存 `~/.cache/electron` 与 `~/.cache/electron-builder` |
| T-007 | 测试脚本散落在 `.temp/`（被 gitignore），每次重写 | `.temp/` | 已修 | v0.8.2 | 已建 `scripts/smoke/` 四层套件 + `scripts/project-status.mjs` + `scripts/verify.mjs`，全部入库 |

---

## 七、🟡 验证缺口

| ID | 缺口 | 影响 | 状态 | 备注 |
|---|---|---|---|---|
| V-001 | 无自动化测试，`package.json` 无 `test` script | AI 无法自证修改正确，每轮必须人肉验证 | 已修 | v0.8.2 | 已建 `npm run smoke`（L1 静态 / L2 逻辑 / L3 组件安全 / L4 集成）+ `npm run verify`；见 `docs/smoke/README.md` |
| V-002 | 三项问题修复仅单元样例验证，无源 PDF 端到端 | B-017 的真实闭环未确认 | 已修 | v0.8.2 | 2026-11-09 用户真机样本确认（英文副标题已消失）；本地 L4 C 段 2026-11-07 已过 |
| V-003 | macOS `ad-hoc` 重签与 `.lproj` 裁剪未在 macOS CI/真机验证 | macOS 产物正确性未知 | 待验 | — |
| V-004 | CI 不跑冒烟，只验构建 | 功能坏掉要等发版才暴露 | 已修 | v0.8.2 | ci.yml 的 linux job 加 `Smoke test (L1-L3)` 步骤 |
| V-005 | B-024 的 retina 渲染修复未在 macOS 真机验证 | macOS 清晰度实际效果未知 | 待验 | 需 macOS 真机（本机 Linux dpr=1 无法复现） |

---

## 八、复查方式

```bash
# 未闭环问题（按优先级排序）
grep -E "待修|进行中|待验" docs/TASKS.md

# 统计各状态数量
grep -oE "待修|进行中|待验|已修|已知限制|已搁置" docs/TASKS.md | sort | uniq -c

# 某文件的全部相关问题
grep "converters.js" docs/TASKS.md
```

> **维护规则**：星辰修完一项 → 立即把该行状态改 `待验` → 验证通过改 `已修` 并填关闭版本 → 在 commit message 末尾写 `Closes: R-0xx`。
> WorkBuddy 审查时新增的问题 → 追加到对应优先级表格 → **审查报告原文存 `docs/reviews/`**。
