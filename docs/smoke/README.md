# 冒烟测试套件

让 AI（星辰 / WorkBuddy）能自己验证修改是否正确 —— 这是「AI 自证」的前提。

> 原始动机：项目此前的冒烟脚本散落在 `.temp/`（被 gitignore），每轮迭代都在重写，
> 且没有统一入口与退出码。AI 无法运行它们，也就无法自证，只能靠人肉验证。

## 快速开始

```bash
npm run smoke              # 全跑（L1 → L4）
npm run smoke:static       # 只跑 L1 静态检查（秒级）
npm run smoke:logic        # 只跑 L2 逻辑单元
npm run smoke:unit         # 只跑 L3 组件安全单元
npm run smoke:integration  # 只跑 L4 集成（需图形环境）
npm run verify             # 一键体检（台账 + 冒烟 + 决策）
```

退出码：`0` = 通过；`1` = 有失败。CI 与 Agent 都靠这个判断。

## 四层结构

| 层 | 需要 | 耗时 | 覆盖 |
|---|---|---|---|
| **L1 静态** | 无 | <1s | 安全基线存在性、决策台账完整性、组件加固常量、副标题窗口、i18n 键 |
| **L2 逻辑** | Node | <1s | 镜像源顺序、版本比较、darwin 资产命名回归、已知待修项监控 |
| **L3 单元** | Electron | ~5s | zip 解包白名单、sha256 强校验、体积防线、CRC 完整性 |
| **L4 集成** | Electron + 图形环境 | ~20s | 真实渲染层断言（27 项）：DOM / preload API / IPC 往返、沉浸热区与侧栏交互（20% 滑出防回归）、PDF→AZW3 转换端到端（合成 PDF → 真实 convertFile → 应用自身 foliate-js 预览 → 副标题/中文章名/目录断言） |

分层依赖：L1/L2/L3 任一失败即中止后续层（避免在坏基础上继续测）。

## 输出

- 终端：彩色分项 + 失败清单 + 跳过项说明
- 机器可读：`.smoke-report/smoke.json`

```bash
npm run smoke -- --json          # 直接输出 JSON
node scripts/smoke/run.mjs --open # 只列未闭环问题
```

## 三态语义（重要）

| 状态 | 含义 | 计入失败 |
|---|---|---|
| ✓ 通过 | 断言成立 | — |
| ✗ 失败 | 断言不成立 = **本次改动引入的问题或既有回归** | ✅ 是 |
| ⚠ 警告 | `docs/TASKS.md` 已登记的待修项（如 R-033/R-034） | ❌ 否 |
| ⚠ 跳过 | 环境跑不了（如渲染层 OOM、无图形环境） | ❌ 否 |

**为什么待修项是警告而不是失败**：冒烟要回答的是「这次改动有没有引入新问题」，
不是「历史问题是否已修完」。若把待修项算失败，冒烟永远红，就失去了信号价值。
修好后警告会自动变 ✓，修复过程可被观察到。

**为什么环境问题算跳过而不是失败**：跑不起来属于「测不了」，不属于「测出问题」。
把它算成失败会掩盖真正的回归。

## 已知环境约束

### `ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化成纯 Node
症状：`TypeError: Cannot read properties of undefined (reading 'disableHardwareAcceleration')`
原因：该变量存在时 Electron 以纯 Node 模式启动，`require('electron')` 返回**路径字符串**而非模块对象。
处理：套件已自动剔除该变量（`cleanEnv()`），并在预检中报告。

### 以 root 运行需 `--no-sandbox`
症状：`FATAL: Running as root without --no-sandbox is not supported`
处理：套件已固定传 `--no-sandbox`。

### `node_modules/electron` 的二进制可能与包声明版本不一致
症状：`electron --version` 返回 20.x 但包声明 33.x（postinstall 下载失败时残留旧二进制）。
处理：预检会检出并给出修复命令：
```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
```

### L4 在无图形环境会被跳过
症状：`渲染进程崩溃：{"reason":"crashed","exitCode":5}`（exitCode 5 = OOM）
原因：容器/无显示环境下渲染层起不来，或内存不足被 OOM killer 杀掉。
处理：识别为跳过并给出提示。在有显示环境的开发机或 GitHub Actions runner 上可正常跑。

## 目录结构

```
scripts/
├── smoke/
│   ├── run.mjs                    # 统一入口（四层调度 + 报告 + 退出码）
│   ├── unit-updater.cjs           # L2：升级链路纯逻辑
│   ├── unit-component-zip.cjs     # L3：组件解包安全
│   └── integration-app.cjs        # L4：真实 Electron 进程断言
├── project-status.mjs             # 台账体检（问题状态 + 基建检查）
└── verify.mjs                     # 一键体检（台账 + 冒烟 + 决策）
```

产物目录 `.smoke-report/`（已 gitignore）：`smoke.json`、`integration.json`、截图 `smoke-app.png`。

## 写新测试时

- 断言输出统一用 `✓ 名称` / `✗ 名称`（L2/L3）或 `[assert] PASS: 名称` / `[assert] FAIL: 名称`（L4）
- L2/L3 在 Electron 环境跑，`require('electron')` 必须解构：`const { app } = require('electron')`
- 路径用 `path.join(__dirname, '..', '..')` 定位仓库根（注意层级）
- 新发现的待修项 → 加到 `docs/TASKS.md`，在测试里用 `warn()` 而非 `ok()` 断言
- 修好后把 `warn()` 改回 `ok()`，测试即变绿
