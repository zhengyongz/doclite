import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 平台样式分流：html 根节点挂 platform-darwin / platform-win32 / platform-linux，
// CSS 按 class 提供各平台字体栈、控件风格与 macOS 红绿灯留白（见 index.css 底部）
;(function applyPlatformClass() {
  document.documentElement.classList.add(`platform-${window.doclite?.platform || 'linux'}`)
})()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
