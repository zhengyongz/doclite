// vite.config.converters.js
// 转换组件独立构建：IIFE 单文件（window.DocLiteConverters），输出 dist/converters/
// 与主应用构建（vite.config.js）完全分离——主包不包含任何转换库，实现"浏览/转换"分离安装。
import { defineConfig } from 'vite'
import { readFileSync, copyFileSync, mkdirSync } from 'fs'
import { resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const HERE = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(HERE, 'package.json'), 'utf8'))

// R-096：pdfjs worker 以真实文件随组件发布。
// 组件内联的 pdfjs 与主应用是两个独立模块实例，worker 必须自带；data:/blob: 形态
// 会被 Chromium/CSP 拒绝，`?url` 在 lib 模式下又会被内联成 data: URL ——
// 故构建期直接把 worker 复制到 dist/converters/assets/（代码侧用
// document.currentScript 定位组件目录后拼 assets/pdf.worker.min.mjs）。
function copyPdfjsWorker() {
  return {
    name: 'copy-pdfjs-worker',
    closeBundle() {
      const src = resolve(HERE, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
      const dest = resolve(HERE, 'dist/converters/assets/pdf.worker.min.mjs')
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
      console.log(`[converters] pdfjs worker → ${relative(HERE, dest)}`)
    },
  }
}

export default defineConfig({
  plugins: [copyPdfjsWorker()],
  // 不复制 public 目录（避免 vite.svg 等主应用资源混入组件包）
  publicDir: false,
  define: {
    __COMPONENT_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // IIFE：单文件、无 import 语句，file:// 直接 <script> 加载（避免 ESM 跨源问题）
    lib: {
      entry: resolve(dirname(fileURLToPath(import.meta.url)), 'src/converters-entry.js'),
      name: 'DocLiteConverters',
      formats: ['iife'],
      fileName: () => 'converters.js',
    },
    outDir: 'dist/converters',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // IIFE 要求动态 import 全部内联（转换库的延迟 import 在运行时仍按 Promise 语义执行，
        // 但代码预先打进单文件——组件是"可选安装"，体积优先级低于可靠性）
        inlineDynamicImports: true,
        assetFileNames: 'assets/[name][extname]',
      },
    },
    // 组件含 jspdf/pdfjs/xlsx 等大库，chunk 警告阈值放宽
    chunkSizeWarningLimit: 5000,
    // 发布产物不 sourcemap（安装包体积优先）
    sourcemap: false,
    minify: 'esbuild',
  },
})
