# DocLite 决策台账（STATE）

> **本文件记录项目所有"为什么这么做"的决策。** 目的：让任何 Agent 或人在接手时，不用重新考古历史、不用推翻已定方案、不用把踩过的坑再踩一遍。
> 决策 = 已做出的选择（及其理由）。尚未决策的事情记在 `docs/TASKS.md`，不写在这里。

## 决策格式

每条决策记录：**日期 · 决策 · 背景 · 理由 · 影响面**。

决策有两种状态：
- **生效中** —— 当前遵循的方案
- **已废止** —— 曾经这么做，后来改了（**必须保留**，否则会有人按旧方案来改回去）

---

## 一、架构级决策

### D-001 · 2026-11-03 · 浏览与转换功能拆分为独立组件
**决策**：主包默认只含浏览（预览）功能；格式转换打包为可独立安装的组件（`DocLite-converters`），三种安装途径（dev 目录 / 系统级 `/opt/DocLite/resources/converters` / 用户级 `userData`），版本高者优先。

**背景**：主包含全部转换库导致 asar 111M、deb 87M，用户只想看文档却要下载几十兆转换能力。

**理由**：功能解耦后主包 asar 降至 3.9M、deb 69M；组件 zip 仅 680K。

**影响面**：`electron/converters-component.cjs`、`src/utils/convertersLoader.js`、`build/pack-converters.cjs`、`package.json`（`build.files` 排除 node_modules）

---

### D-002 · 2026-11-03 · 主进程保持零 npm 依赖
**决策**：`build.files` 显式排除 `node_modules/**`，主进程仅用 Node 内置模块 + electron；renderer 由 Vite 全量 bundle；ZIP 解压借用主 bundle 里的 fflate（8KB）。

**背景**：electron-builder 默认把 node_modules 打进 asar，5840 个文件，主进程与 renderer 依赖混杂。

**理由**：主包体积可控；解压能力不额外引入依赖。

**影响面**：`electron/*.cjs`、`package.json`

---

### D-003 · 2026-11-03 · npm 缓存只 cache `~/.npm`，绝不缓存 node_modules
**决策**：`actions/setup-node` 用 `cache: 'npm'`，不缓存 `node_modules`。

**背景**：`postinstall` 跑 `patch-package`（给 foliate-js 打补丁）。

**理由**：缓存 node_modules 会导致 patch 不生效，MOBI/EPUB 渲染静默出错。

**影响面**：`.github/workflows/ci.yml`、`.github/workflows/release.yml`

---

### D-004 · 2026-11-03 · electron-builder 一律 `--publish never`，Release 由 action-gh-release 统一上传
**决策**：所有打包命令加 `--publish never`；`package.json` 里 `build.publish` 的 github provider 仅为生成 `latest.yml` 元数据服务。

**背景**：electron-builder 自带上传逻辑会在 CI 中用 GH_TOKEN 直接写 Release。

**理由**：上传时机可控（仅 tag 推送时上传），避免构建过程持有可写 token。

**影响面**：`package.json`、`.github/workflows/release.yml`

---

### D-005 · 2026-11-03 · CI 三平台矩阵 `fail-fast: false`
**决策**：`strategy.fail-fast: false`，单平台失败不影响其余平台产出。

**背景**：macOS 构建失败不应连带毁掉 Windows/Linux 产物。

**理由**：三平台独立产出，发版时可取可用平台的部分成果。

**影响面**：`ci.yml`、`release.yml`

---

## 二、安全与信任边界

### D-006 · 2026-11-05 · 副标题过滤采用「标题后有限窗口」，不采用「无限状态 + 宽松匹配」
**决策**：英文副标题丢弃限定在章节标题后 **3 行**（`postHeading = 3`）内；`looksLikeTitleLine` 只挡句读「。！？；」，允许「：、，」，长度 1..60。

**背景**：原实现用无限 `subtitleActive` 标志 + `looksLikeTitleLine` 白名单挡标点，两处一起导致：① 中文短标题行把状态带进正文，误删正文大写英文行；② 中文章名含「：」「、」时副标题收集被打断，原始 bug 原样复现。

**理由**：窗口方案把误删范围硬性限定在标题后 3 行，**即使判定逻辑漏判也不会伤及正文**。放宽标点比收紧标点风险更低。

**影响面**：`src/utils/converters.js`（`pdfToAzw3` 的 `postHeading` / `looksLikeTitleLine` / `looksLikeEnglishSubtitle`）

**关联**：R-005、R-006、R-007、R-051（英文副标题含冒号/Title Case 不识别 —— **已知限制，维持现状**，放宽会提高误删正文风险）

---

### D-007 · 2026-11-05 · 组件包必须强校验 sha256，缺失即中止
**决策**：`manifest.sha256` 与实算比对必须通过；期望 sha256 拿不到时**中止安装**，不降级放行。

**背景**：原实现 sha256 拿不到就跳过校验，且解压无上限 → zip 炸弹 DoS。

**理由**：组件包由自家发布流程产出，sha256 缺失属于发布异常而非正常情况，降级放行等于把异常当正常。配合单文件 20MB / 总量 60MB / 条目数 50 三级上限。

**影响面**：`electron/converters-component.cjs`

**关联**：R-016。**遗留信任根问题**：期望哈希本身也走镜像（R-023 / R-086），尚未解决 —— 从可信源取哈希或引入签名。

---

### D-008 · 2026-11-03 · macOS 暂用 ad-hoc 签名，不购买 Apple Developer ID
**决策**：CI 用 `codesign --force --deep --sign -` 做 ad-hoc 重签（解决"首次启动判已损坏"），`gatekeeperAssess: false`，`hardenedRuntime: true`。**不做** Developer ID 签名与公证。

**背景**：Apple Developer 账号需 $99/年；无 Developer ID 时 electron-updater 的 zip 替换必被 Gatekeeper 阻止。

**理由**：先用 ad-hoc + README 排障说明（`xattr -cr`）解决 90% 用户体验，成本为零。

**影响面**：`build/afterPack.cjs`、`package.json`（`build.mac`）、`README.md`、`electron/updater.cjs`（darwin 守卫：改为打开 Release 页 + 引导文案）

**遗留**：R-003。公证后 macOS 自动更新可零改动开通（entitlements 与 hardenedRuntime 已备好）。

---

### D-009 · 2026-10-30 · 组件写入采用「白名单 + 哈希 + 原子替换」三重校验
**决策**：只允许写 `converters.js` / `manifest.json` / `assets/**`；写盘先落临时目录 `.installing`，成功整体 `rm` + `rename` 原子替换；`converters.js` 校验 manifest 中的 sha256。

**背景**：渲染层回传解压结果构成持久化 XSS 通道 —— 若渲染层已被攻破，可借写盘植入任意文件。

**理由**：纵深防御：即使渲染层失守，写盘面已被白名单 + 哈希 + 路径校验三重收窄。

**影响面**：`electron/converters-component.cjs`

**关联**：R-001（已修）

---

### D-010 · 2026-11-05 · Electron 全面加固：sandbox + CSP + 窗口拦截
**决策**：`webPreferences.sandbox = true`；`index.html` 加 CSP meta；`setWindowOpenHandler` + `will-navigate` 拦截外部跳转；preload 只暴露最小 API。

**背景**：初版按 Electron 官方安全清单逐条对照缺口明显。

**理由**：preload 只用 ipcRenderer，完全可开 sandbox；转换组件是本地 JS，无需放宽 CSP 的 `script-src`。

**影响面**：`electron/main.cjs`、`electron/preload.cjs`、`index.html`

**关联**：R-013（已修）

---

### D-011 · 2026-09-21 · MOBI 生成器自研，零第三方依赖
**决策**：从零实现 MOBI6 格式二进制生成器（`src/utils/mobiWriter.js`，千余行），不依赖任何第三方库。

**背景**：npm 上的 MOBI 库都无法满足"Kindle + 文石双端可打开 + 可跳转目录"的要求。

**理由**：自研可控，且能与 calibre 黄金实现逐字节对齐（PDB 记录布局、TBS 尾部字节序列、INDX/CNCX 索引、无零记录、JPEG JFIF 头）。

**影响面**：`src/utils/mobiWriter.js`

**验证**：与 calibre 交叉验证 + Kindle Paperwhite（第七代）真机验证 + 文石 TAB10C 验证

---

### D-012 · 2026-09-21 · AZW3 渲染必须经 DOMPurify 消毒
**决策**：`dangerouslySetInnerHTML` 渲染电子书解出的 HTML 前，一律经 DOMPurify 清洗。

**背景**：恶意构造的 MOBI 可注入脚本，Electron 渲染进程会执行。

**理由**：电子书内容是外部不可信输入，与普通文件不同。

**影响面**：`src/components/renderers/Azw3Renderer.jsx`

**关联**：R-045（已修）

---

## 三、体验与交互决策

### D-013 · 2026-11-05 · 沉浸热区用窗口级 mousemove，不用固定蒙层
**决策**：删除 `fixed` 定位的 `.immersion-hotzone` 蒙层；改为监听窗口 `mousemove`，判定 `clientX <= innerWidth * 0.2` 时滑出侧栏；用 `sidebarOpenRef` 镜像状态避免高频 setState。

**背景**：用户要求"鼠标移到界面左边 20% 就滑出"。首版实现为 `w-[20%]` 的 fixed 蒙层，但蒙层与预览滚动容器是**兄弟节点**，导致左侧 1/5 区域的点击、**滚轮、触摸滑动全部失效**，光标还变箭头。

**理由**：mousemove 方案语义完全满足需求，且零代价消除全部副作用。

**影响面**：`src/App.jsx`、`src/index.css`

**关联**：R-004、B-018（已修）

---

### D-014 · 2026-11-04 · 沉浸态侧栏收起时加 `aria-hidden` + `inert`
**决策**：侧栏收起时 DOM 保留但加 `aria-hidden="true"` 与 `inert` 属性。

**背景**：仅 `translateX` 移出视口，DOM 仍在、可被 Tab 聚焦、读屏软件会读到隐藏内容。

**理由**：用 `translate` 做动画更流畅（300ms ease-out + will-change-transform），但需补 a11y 属性消除副作用。React 19 可直接用 `inert`。

**影响面**：`src/App.jsx`

**关联**：R-062（已修）

---

### D-015 · 2026-11-04 · 平台风格适配取「稳妥版」
**决策**：macOS 用 `titleBarStyle: 'hiddenInset'` + `vibrancy: 'under-window'` 毛玻璃 + 透明背景 + 红绿灯 78px 留白 + header 拖动区；Windows/Linux 保留系统标题栏，仅换字体栈。平台类通过 preload 暴露 `platform` 挂到 html，渲染层读不到时兜底 `'linux'`。

**背景**：用户在 macOS / Windows / Linux 三平台使用。

**理由**：稳妥版不改变各平台用户既有习惯（尤其 Windows 保留标题栏），实施风险最低。

**影响面**：`electron/main.cjs`、`src/index.css`、`src/main.jsx`

**遗留**：T-005 —— 毛玻璃与红绿灯真实效果需 macOS 真机验收。

---

### D-016 · 2026-11-04 · i18n 零第三方依赖，字典改纯文本
**决策**：`src/i18n.jsx` 自建中英双字典 + React Context（`I18nProvider` / `useI18n`），`t(key, vars)` 支持插值；字典值**只存纯文本**，样式放组件 className。

**背景**：新增界面双语化需求；同时字典里存 HTML 片段是长期注入隐患（翻译平台一改就能注入）。

**理由**：避免为翻译引入依赖；纯文本字典更安全也更易维护。

**影响面**：`src/i18n.jsx`、约 17 个组件、`electron/*.cjs` 经 IPC 回传的错误（以中文原文为 key 映射英文，未收录原样回退）

**注意**：**禁止把 `t` 加进 useCallback/useMemo 依赖数组** —— 会导致语言切换时重解析大文件（性能事故）。已在 `src/i18n.jsx` 顶部注释说明。

**关联**：R-075（已修）

---

### D-017 · 2026-11-04 · 升级链路的错误文案用 `ts()` 而非 `t()`
**决策**：`UpdateDialog` 的错误主文案用 `ts(errorMsg)`（正则兜底 + 已知中文原文映射），其他 UI 文案用 `t(key)`。

**背景**：`ts()` 支持按中文原文匹配已知错误并翻译，`t()` 只按 key 查字典。

**理由**：主进程回传的是中文原文而非 key，必须走 `ts()` 才能翻译。

**影响面**：`src/components/UpdateDialog.jsx`、`src/i18n.jsx`

**关联**：R-024（已修）

---

### D-018 · 2026-11-05 · 副标题尾部剔除只对「含中文」的行生效
**决策**：`stripEnglishSubtitleTail` 只对含中文的行做尾部剔除。

**背景**：原实现对纯英文行也剔除尾部，导致「HOW AN ECONOMY」被截成「HOW」、「WHY IT CRASHES」被截成「WHY」，反而漏进正文。

**理由**：纯英文行需要整体丢弃而非截断，剔除尾部只适用于中英混排行。

**影响面**：`src/utils/converters.js`

---

## 四、构建与发布决策

### D-019 · 2026-11-03 · Windows runner 清理步骤用 Node，不用 `rm -f`
**决策**：清理 `release/builder-debug.yml` 等产物用 `node -e "fs.rmSync(...)"`。

**背景**：Windows runner 默认 shell 是 PowerShell，不识别 `rm -f` → 清理静默失败 → win 上传被跳过。

**理由**：Node 跨平台且在所有 runner 上都可用。

**影响面**：`.github/workflows/release.yml`

---

### D-020 · 2026-11-03 · macOS 图标由 CI 用 sips + iconutil 生成，不入库
**决策**：CI 上从 `build/icon.png`（512×512）生成 `AppIcon.iconset` 再 `iconutil -c icns`。

**背景**：`.icns` 是二进制产物，入库易冲突。

**理由**：源码只留一张 png，产物在 CI 生成。

**影响面**：`.github/workflows/ci.yml`、`release.yml`、`.gitignore`（`build/icon.icns`）

**遗留**：T-002 —— 缺 1024×1024 母版。

---

### D-021 · 2026-11-03 · 发布用 tag 门控，`workflow_dispatch` 仅供调试
**决策**：上传资产步骤加 `if: startsWith(github.ref, 'refs/tags/v')`；组件 zip 只在 linux job 生成（`if: matrix.platform == 'linux'`）。

**背景**：① 手动触发 workflow 不打 tag 时不该上传；② 三平台各自产出同名组件 zip，字节可能不同 → 资产的 zip 与 .sha256 来自不同 job → 用户安装必报 sha256 不匹配。

**理由**：单一产物来源杜绝哈希错配；调试触发不产生副作用。

**影响面**：`.github/workflows/release.yml`

**关联**：R-012（已修）

---

### D-022 · 2026-11-03 · `pack-converters.cjs` 用固定 mtime 保证 zip 字节可复现
**决策**：`zipSync(files, { level: 9, mtime: FIXED_MTIME })`。

**背景**：zip 内文件时间戳不一致会导致字节不同，进而 sha256 不同。

**理由**：固定 mtime 后本地连打两次 sha256 一致（`a06533f0…`），消除"同一版本不同字节"的可能。

**影响面**：`build/pack-converters.cjs`

---

### D-023 · 2026-11-04 · 组件热更新需重置全局 API 与 scriptPromise
**决策**：`convertersLoader` 新增 `resetConvertersApi()`（删 `window.DocLiteConverters`、清 `scriptPromise`、移除注入的 script 标签），注入时加 `data-doclite-converters` 标记 + `?v=版本` 破缓存；`useConverters` 在 install/uninstall 成功后先重置再 refresh。

**背景**：用户更新组件后，界面显示新版本号，但 `convert()` 仍跑旧 bundle（`.xls` 一直报"不支持"）。

**理由**：单例 Promise + 全局变量在同页面生命周期内不会自动刷新，必须显式重置。

**影响面**：`src/utils/convertersLoader.js`、`src/useConverters.js`

**关联**：R-018（已修）

---

### D-024 · 2026-11-04 · 组件版本门槛：`.xls` 在旧组件下禁用导出
**决策**：`ConvertPanel` 对 `outdated && ext === '.xls'` 禁用导出按钮并提示"当前组件不支持 .xls"，落后横幅改为带一键「更新到 vX」按钮。

**背景**：旧版组件的 `convertFile` 只认 `.xlsx`，`.xls` 必然失败。

**理由**：早失败 + 给明确出路，优于让用户点了才报错。

**影响面**：`src/components/ConvertPanel.jsx`

**关联**：R-019（已修）

---

### D-025 · 2026-10-15 · 转 PDF 走「双档质量」，修 O(M²) 卡死
**决策**：文档转 PDF 从 O(M²) 优化为 O(M)；提供质量档位（`toDataURL('image/jpeg', quality)`），牺牲少量画质换速度与体积。

**背景**：原实现把转换结果**所有页**的 canvas 攒在内存再逐页塞进 jsPDF，长文档直接卡死。

**理由**：用户反馈"文档转 PDF 卡死"是阻塞级问题，优先保可用性。

**影响面**：`src/utils/converters.js`

---

### D-026 · 2026-10-31 · 差量升级走官方 electron-updater + blockmap
**决策**：用 `electron-updater` 6.8.x + blockmap 分块对比，二次升级起仅下载约 2% 流量。

**背景**：每次升级都全量下载 60M+ 安装包。

**理由**：官方方案成熟，自研成本远高于收益。

**影响面**：`electron/updater.cjs`、`package.json`

**踩坑记录**：electron-updater 6.8.x 的 Range 请求 / `latest.yml` 格式 / blockmap 生成时机 —— 详见 DEVLOG「阅读 electron-updater 6.8.x 源码得出的关键实现细节」。

---

### D-027 · 2026-11-03 · 升级下载用镜像轮询 + 自动切换
**决策**：直连 GitHub 失败或过慢时自动切换 ghfast / gh-proxy 等镜像；`check()` 在更新说明尾部追加镜像提示。

**背景**：国内直连 GitHub Release 不稳定。

**理由**：多源轮询提升成功率；镜像选择对用户透明。

**影响面**：`electron/updater.cjs`

**遗留**：R-023 —— 期望哈希也走镜像，信任根未解决。

---

### D-028 · 2026-10-16 · macOS `open-file` 监听注册在模块顶层，不放 whenReady 内
**决策**：`app.on('open-file')` 提到模块顶层注册。

**背景**：macOS 双击文件启动时该事件**早于** `whenReady` 触发，放在 whenReady 内会丢失首个事件。

**理由**：必须早于 ready 订阅才能拿到首次启动的文件路径。

**影响面**：`electron/main.cjs`

**关联**：R-095（已修）

---

### D-029 · 2026-11-04 · macOS 关窗不退出应用（darwin 分支）
**决策**：`window-all-closed` 加 darwin 判断；macOS 关窗后 `mainWindow` 置空并加 `isDestroyed()` 判断。

**背景**：macOS 惯例是关窗不退出。Finder 双击文件启动时若应用已在运行，事件会打到已销毁的 webContents。

**理由**：遵循平台惯例，同时守住"给已销毁窗口发消息"这个崩溃点。

**影响面**：`electron/main.cjs`

**关联**：R-022（已修）

---

### D-030 · 2026-10-31 · 体积优化：语言包裁剪 + 转换库懒加载
**决策**：构建后裁剪 Electron 自带语言包（只留中英）；转换库改为按需懒加载。

**背景**：安装包体积超预期。

**理由**：不影响功能的前提下减体积。

**影响面**：`build/afterPack.cjs`

**遗留**：T-001 —— macOS 语言包在 `Electron Framework.framework/Resources/*.lproj`（约 54M–57M）而非 afterPack 处理的 `locales` 目录，afterPack 已加 darwin 分支但需验证实际减重。

---

## 五、流程与协作决策

### D-031 · 2026-11-06 · 项目状态以仓库文件为唯一事实源，Obsidian 降级为只读视图
**决策**：`docs/TASKS.md`（问题与状态）+ `docs/STATE.md`（决策与理由）是唯一事实源；Obsidian Vault 里的历史审查报告归档保留，但不再作为工作入口。

**背景**：原流程把审查报告存 Obsidian、代码在 git、人工搬运上下文，导致：已知问题无状态、审查意见读完沉底、设计决策散落三处。Obsidian Vault 不是 git 仓库，与代码天然不同步。

**理由**：问题与决策必须与代码同版本、同历史，才能在"下一轮迭代"时仍可查。

**影响面**：`docs/TASKS.md`、`docs/STATE.md`、`.github/workflows/`（后续可加 verify job）

**关联**：T-007、V-001

---

### D-032 · 2026-11-06 · 保留双 Agent 审查机制
**决策**：星辰超级智能体负责实现，WorkBuddy 负责只读审查，问题项回写 `docs/TASKS.md`。

**背景**：不同模型盲区不同，双 Agent 交叉能挖出真问题 —— 实测 WorkBuddy 审查发现了热区滚轮失效、副标题标点白名单、子标题污染正文等单 Agent 遗漏的缺陷。

**理由**：审查质量收益 > 上下文搬运成本。搬运成本通过 `npm run handoff`（生成指令包）压缩到"一次复制粘贴"。

**状态**：生效中（`npm run handoff` 待实现，属 P2）

---

### D-033 · 2026-11-06 · 冒烟测试脚本必须入库，不能留在 `.temp/`
**决策**：把 `.temp/` 下的测试脚本迁入 `scripts/` 并入库，建立四层冒烟套件 + 统一入口 `npm run smoke` + 一键体检 `npm run verify`。

**背景**：`.temp/` 被 gitignore，冒烟脚本每次迭代都在被重新写，无法累积，也没法让 AI 自证。

**理由**：脚本是资产不是临时产物。入库后可被 CI 复用、可被 Agent 直接运行。

**实现（2026-11-06 完成）**：
- `scripts/smoke/run.mjs` — 四层调度 + 报告 + 退出码
- `scripts/smoke/unit-updater.cjs` — L2 升级链路纯逻辑（源自 `.temp/test-updater-mirror.cjs`）
- `scripts/smoke/unit-component-zip.cjs` — L3 组件解包安全（源自 `.temp/test-zip.cjs`）
- `scripts/smoke/integration-app.cjs` — L4 真实 Electron 进程断言
- `scripts/project-status.mjs` — 台账体检
- `scripts/verify.mjs` — 一键体检（台账 + 冒烟 + 决策）
- 文档：`docs/smoke/README.md`

**关联**：T-007（已修）、V-001（已修）、V-004（已修）、T-008（已修）

---

### D-034 · 2026-11-06 · 冒烟三态语义：失败 / 警告 / 跳过
**决策**：冒烟结果分三态 —— **失败**（本次改动引入的问题或既有回归）、**警告**（`docs/TASKS.md` 已登记的待修项）、**跳过**（环境跑不了，如渲染层 OOM）。只有「失败」计入退出码非零。

**背景**：两个坑会让冒烟彻底失去信号价值：
1. 若把已知待修项（如 R-033）算作失败 → 冒烟永远红 → AI 无法判断"我这次改动是否引入回归"。
2. 若把环境问题（如容器内存不足导致渲染层 OOM）算作失败 → 同上，且会掩盖真正的回归。

**理由**：冒烟要回答的是「本次改动有没有引入新问题」，不是「历史问题是否修完」「环境是否完美」。把这两类噪声剔除后，退出码才真正代表"可以合并"。

**实现**：待修项在测试里用 `warn()` 输出 ⚠；环境不可满足用 `skip()` 记为跳过并给出可执行提示。修好待修项后警告自动变 ✓，修复过程可被观察到。

**关联**：D-033

---

### D-035 · 2026-11-06 · CI 缓存 electron / electron-builder 下载目录
**决策**：`ci.yml` 与 `release.yml` 均加 `actions/cache@v4`，缓存 `~/.cache/electron` 与 `~/.cache/electron-builder`。**绝不缓存 node_modules**。

**背景**：electron-builder 每次要下载 Electron 二进制（~100MB/平台/架构）+ winCodeSign + nsis 工具链，不缓存则每次 CI/发版都重下（数分钟）。

**理由**：只缓存「下载缓存目录」是安全的 —— node_modules 每次 `npm ci` 全量重装，保证 `postinstall` 的 `patch-package` 每次都执行（否则 foliate-js 补丁不生效，见 D-003）。缓存 key 带 `hashFiles('package-lock.json')`，依赖版本变化时自动失效。

**关联**：T-008（已修）

---

## 六、待定决策（需要人拍板）

| 编号 | 议题 | 选项 | 影响 |
|---|---|---|---|
| Q-001 | macOS 是否购买 Apple Developer ID（$99/年）？ | 买 / 不买 | 决定 R-003 能否闭环、macOS 自动更新能否开通 |
| Q-002 | 是否引入 GitHub Issue 作为对外任务台账？ | 引入 / 不引入 | 当前 P0-P2 不依赖 Issue；引入需先装 `gh` |
| Q-003 | `xlsx` 是否迁移到 SheetJS 官方 CDN tarball？ | 迁移 / 维持 | 决定 R-053（CVE）是否处理；迁移会改变依赖来源 |
| Q-004 | 升级哈希信任根是否引入代码签名？ | 引入 / 维持镜像 | 决定 R-023 / R-086 是否闭环；签名成本高 |
| Q-005 | R-033 / R-034 / R-037 是否升级为 🔴？ | 升 / 不升 | 升级链路三项安全问题的优先级认定 |
