---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '60bcb63c-75cc-4adf-bc3f-44224d46b4e8'
  PropagateID: '60bcb63c-75cc-4adf-bc3f-44224d46b4e8'
  ReservedCode1: '0c100a99-fd2f-460d-b70f-08e183f0b126'
  ReservedCode2: '0c100a99-fd2f-460d-b70f-08e183f0b126'
---

# 轻快文档工具箱 (DocLite)

一个 Electron 桌面文档工具箱。支持 Word、Excel、PPT、PDF、MOBI/AZW3 格式的本地预览与互转，**所有文件处理均在本地完成，不上传任何服务器**。

## 功能特性

### 文档预览

| 格式 | 渲染方式 | 缩放 |
|------|---------|------|
| Word (.docx) | docx-preview 渲染为 HTML | 50%–200% |
| Excel (.xlsx) | SheetJS 解析为表格，支持多 Sheet 切换 | 50%–200% |
| PPT (.pptx) | JSZip 解析 XML，提取形状位置/背景色/图片，绝对定位渲染 | 50%–200% |
| PDF (.pdf) | pdfjs-dist 逐页渲染为 Canvas | 50%–200% |
| MOBI/AZW3 (.mobi/.azw3) | foliate-js 渲染 | 50%–200% |

### 格式转换

| 转换路径 | 技术方案 |
|---------|---------|
| Word → PDF | docx-preview → html2canvas → jsPDF |
| Excel → PDF | SheetJS → HTML 表格 → html2canvas → jsPDF |
| PPT → PDF | JSZip 解析 → HTML 幻灯片 → html2canvas → jsPDF |
| PDF → Word | pdfjs 文本提取（按行分组）→ docx 包生成 |
| PDF → PNG | pdfjs 2x 渲染 Canvas → PNG（多页打包 ZIP） |
| PDF → MOBI/AZW3 | pdfjs 文本/图片提取 → 自研 mobiWriter 生成（含 NCX 目录 + TBS 索引） |

### 其他特性

- Electron 桌面应用，支持文件关联（双击文件直接打开）
- 单实例运行，二次打开文件传给已有窗口
- 响应式布局，适配 PC 和手机浏览器
- 拖拽上传 + 点击上传
- PPT 支持键盘左右箭头翻页

## 技术栈

- **React 18** + **Vite 6** — 前端框架与构建工具
- **Electron 33** + **electron-builder** — 桌面应用框架与打包
- **Tailwind CSS 3** — 样式系统（自定义 ink/accent 色系）
- **SheetJS (xlsx)** — Excel 解析
- **docx-preview** — Word 渲染
- **pdfjs-dist v4** — PDF 渲染与文本提取
- **JSZip** — PPTX ZIP/XML 解析
- **foliate-js** — MOBI/AZW3 电子书渲染（patched）
- **mobiWriter.js** — 自研 MOBI6 生成器（零依赖，含 TBS/INDX/CNCX 索引）
- **html2canvas + jsPDF** — HTML → PDF 转换
- **docx** — Word 文档生成（PDF → Word 转换）

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器 (http://localhost:5180)
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

## 项目结构

```
doclite/
├── electron/
│   ├── main.cjs            # Electron 主进程（文件关联 + 单实例 + IPC）
│   └── preload.cjs         # contextIsolation 桥接
├── build/
│   ├── icon.png / icon.ico # 应用图标
│   └── after-install.sh    # deb 安装后脚本
├── patches/
│   └── foliate-js patch    # foliate-js 兼容性补丁
└── src/
    ├── main.jsx            # React 挂载入口
    ├── App.jsx             # 主布局（FileProvider 包裹，左右分栏）
    ├── context/
    │   └── FileContext.jsx # 全局状态
    ├── utils/
    │   ├── fileHelpers.js  # 格式校验、常量
    │   ├── converters.js   # 格式转换工具集（含 PDF→MOBI 管线）
    │   └── mobiWriter.js   # MOBI6 生成器（PDB+TBS+INDX+CNCX，零依赖）
    └── components/
        ├── Header.jsx / Sidebar.jsx / UploadZone.jsx
        ├── PreviewToolbar.jsx / PreviewViewport.jsx
        ├── ConvertPanel.jsx / ErrorToast.jsx / EmptyState.jsx
        └── renderers/
            ├── XlsxRenderer.jsx
            ├── DocxRenderer.jsx
            ├── PdfRenderer.jsx
            ├── PptxRenderer.jsx   # 形状绝对定位渲染
            └── Azw3Renderer.jsx   # MOBI/AZW3 预览
```

详细开发记录见 [DEVLOG.md](./DEVLOG.md)。

## 安全说明

- 所有文件读取、渲染和格式转换完全在**浏览器本地沙盒**中进行
- 不依赖任何后端服务器，不发起任何网络请求上传文件
- 无需登录，无账号体系，无数据收集
- 文件关闭后内存中的数据自动释放

## 许可证

[MIT License](./LICENSE)

> AI生成