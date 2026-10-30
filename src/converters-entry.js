// src/converters-entry.js
// 转换组件 bundle 入口：由 vite.config.converters.js 独立构建为 IIFE 单文件
// （window.DocLiteConverters），与应用主包分离安装——装了才可用格式转换功能。
// 运行时由 src/utils/convertersLoader.js 动态 <script> 注入加载。
import { convertFile, downloadBlob } from './utils/converters'

export { convertFile, downloadBlob }
export const COMPONENT_NAME = 'doclite-converters'
export const COMPONENT_VERSION = __COMPONENT_VERSION__
