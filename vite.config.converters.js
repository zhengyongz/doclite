// vite.config.converters.js
// 转换组件独立构建：IIFE 单文件（window.DocLiteConverters），输出 dist/converters/
// 与主应用构建（vite.config.js）完全分离——主包不包含任何转换库，实现"浏览/转换"分离安装。
import { defineConfig } from 'vite'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'))

export default defineConfig({
  plugins: [],
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
