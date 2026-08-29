---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '991ea98a-4aa2-416b-9502-937c4806aa72'
  PropagateID: '991ea98a-4aa2-416b-9502-937c4806aa72'
  ReservedCode1: 'e1157b09-0e3b-4188-91a7-6d6ea2fcec80'
  ReservedCode2: 'e1157b09-0e3b-4188-91a7-6d6ea2fcec80'
---

# 轻快文档工具箱 (LightDoc Viewer & Converter)

一个纯前端的文档查看器与格式转换工具。支持 Word、Excel、PPT、PDF 四种格式的浏览器本地预览与互转，**所有文件处理均在浏览器本地完成，不上传任何服务器**。

## 功能特性

### 文档预览

| 格式 | 渲染方式 | 缩放 |
|------|---------|------|
| Word (.docx) | docx-preview 渲染为 HTML | 50%–200% |
| Excel (.xlsx) | SheetJS 解析为表格，支持多 Sheet 切换 | 50%–200% |
| PPT (.pptx) | JSZip 解析 XML，提取文本与图片，16:9 幻灯片展示 | 50%–200% |
| PDF (.pdf) | pdfjs-dist 逐页渲染为 Canvas | 50%–200% |

### 格式转换

| 转换路径 | 技术方案 |
|---------|---------|
| Word → PDF | docx-preview → html2canvas → jsPDF |
| Excel → PDF | SheetJS → HTML 表格 → html2canvas → jsPDF |
| PPT → PDF | JSZip 解析 → HTML 幻灯片 → html2canvas → jsPDF |
| PDF → Word | pdfjs 文本提取（按行分组）→ docx 包生成 |
| PDF → PNG | pdfjs 2x 渲染 Canvas → PNG（多页打包 ZIP） |

### 其他特性

- 响应式布局，适配 PC 和手机浏览器
- 拖拽上传 + 点击上传（原生 label 兼容所有浏览器）
- 文件大小限制 50 MB
- 红色错误提示 Toast（5 秒自动消失）
- 转换进度显示
- PPT 支持键盘左右箭头翻页

## 技术栈

- **React 18** + **Vite 6** — 前端框架与构建工具
- **Tailwind CSS 3** — 样式系统（自定义 ink/accent 色系）
- **SheetJS (xlsx)** — Excel 解析
- **docx-preview** — Word 渲染
- **pdfjs-dist v4** — PDF 渲染与文本提取
- **JSZip** — PPTX ZIP/XML 解析
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
├── index.html              # HTML 入口
├── vite.config.js          # Vite 配置（端口 5180）
├── tailwind.config.js      # Tailwind 主题（ink/accent 色系）
├── postcss.config.js
├── package.json
├── public/
│   └── vite.svg
└── src/
    ├── main.jsx            # React 挂载入口
    ├── index.css           # 全局样式 + Tailwind 指令
    ├── App.jsx             # 主布局（FileProvider 包裹，左右分栏）
    ├── context/
    │   └── FileContext.jsx # 全局状态（文件、预览、缩放、转换）
    ├── utils/
    │   ├── fileHelpers.js  # 格式校验、大小格式化、常量
    │   └── converters.js   # 格式转换工具集
    └── components/
        ├── Header.jsx
        ├── Sidebar.jsx
        ├── UploadZone.jsx       # 上传区域（label 原生触发 + 拖拽）
        ├── PreviewToolbar.jsx   # 缩放控件
        ├── PreviewViewport.jsx  # 渲染器分发入口
        ├── ConvertPanel.jsx     # 格式转换按钮面板
        ├── ErrorToast.jsx       # 错误提示 Toast
        ├── EmptyState.jsx       # 空状态引导
        └── renderers/
            ├── XlsxRenderer.jsx
            ├── DocxRenderer.jsx
            ├── PdfRenderer.jsx
            └── PptxRenderer.jsx
```

## 安全说明

- 所有文件读取、渲染和格式转换完全在**浏览器本地沙盒**中进行
- 不依赖任何后端服务器，不发起任何网络请求上传文件
- 无需登录，无账号体系，无数据收集
- 文件关闭后内存中的数据自动释放

## 许可证

[MIT License](./LICENSE)

> AI生成