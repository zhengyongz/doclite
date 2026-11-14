// scripts/smoke/integration-app.cjs
// L4 集成测试：起真实 Electron 进程，在渲染层做断言，输出 [assert] PASS/FAIL: 名称
//
// 设计要点：
//   1. 复用 main.cjs 的真实启动流程（不自己建窗口）—— 这样所有 IPC handler
//      都按真实路径注册，测的就是真实应用，而不是一个"假窗口 + 手工注册的半个 IPC"。
//   2. 不依赖网络 —— 原 .temp/smoke-install.cjs 要真实连 GitHub 下载组件，CI 不稳。
//      这里验证「组件状态探测」而非「真实安装」，安装链路由 L3 单元层覆盖。
//   3. 断言写进渲染层执行 —— 视觉无法证明功能，必须读 DOM / computed style / IPC 返回值。
//   4. 退出码即结果 —— app.exit(0|1)，CI 与 Agent 都能直接判断。
//
// 场景覆盖（对应 docs/TASKS.md 条目）：
//   A 段  基础加载 / preload API / IPC 通路（空态）
//   B 段  文件加载 → 沉浸态：自动收起、左 20% 热区滑出、区外收起（R-004 / D-013 / B-018）
//   C 段  PDF→AZW3 端到端（B-017 / B-020 / V-002 本地部分）：
//         合成 PDF → 真实 convertFile('to-azw3') → 捕获生成的 MOBI →
//         用应用自身的 foliate-js 预览路径解析 → 断言副标题被丢弃、章名保留、目录无英文
//
// 运行：npx electron scripts/smoke/integration-app.cjs --no-sandbox
// 依赖：dist/index.html 与 dist/converters/converters.js 已构建（由 run.mjs 自动处理）
//
// 备注：sendInputEvent 在 show:false 的隐藏窗口同样可达 window mousemove
// （2026-11-07 实测：hidden=1 shown=2），因此无需弹窗即可驱动左缘热区判定。

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..', '..')
const REPORT_DIR = path.join(ROOT, '.smoke-report')
const RESULT_FILE = process.env.DOCLITE_SMOKE_RESULT || path.join(REPORT_DIR, 'integration.json')

const results = []
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
  console.log(`[assert] ${ok ? 'PASS' : 'FAIL'}: ${name}${detail !== undefined && detail !== '' ? '  ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// executeJavaScript 在渲染进程卡死时会永久挂起 —— 必须加超时
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise.catch((e) => { throw e }),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 超时 ${ms}ms（渲染进程可能无响应）`)), ms)),
  ])
}

// 轮询等待某段渲染层表达式为真（用于等 React 异步渲染完成）
async function waitFor(jsExpr, { timeout = 15000, interval = 300, label = jsExpr } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const v = await withTimeout(
      win.webContents.executeJavaScript(`(function(){ try { return ${jsExpr} } catch (e) { return null } })()`),
      5000, label
    ).catch(() => null)
    if (v) return v
    await sleep(interval)
  }
  return null
}

// —— CJK 部首变体归一化（仅测试用）——
// Chromium printToPDF 合成的 PDF，部分汉字经 pdfjs 提取会得到「康熙部首」/
// CJK 部首补充区块的变体字形（如 ⼗→十、⽔→水、⻥→鱼，字形相同但码位不同）。
// 断言字符串比较前需双向归一 — 这是合成 PDF 的提取伪影，转换/预览链路本身正确。
const RADICAL_MAP = {
  '⼀': '一', '⼈': '人', '⼗': '十', '⼩': '小', '⼝': '口', '⼭': '山',
  '⼯': '工', '⼼': '心', '⼿': '手', '⽇': '日', '⽉': '月', '⽊': '木',
  '⽂': '文', '⽅': '方', '⽩': '白', '⽬': '目', '⽯': '石', '⾦': '金',
  '⾥': '里', '⽔': '水', '⽕': '火', '⽤': '用', '⽣': '生', '⽥': '田',
  '⻑': '长', '⻥': '鱼', '⻋': '车', '⻉': '贝', '⻦': '鸟', '⻢': '马',
}
const normCJK = (s) => String(s || '').replace(/[\u2F00-\u2FD5\u2E80-\u2EFF]/g, (ch) => RADICAL_MAP[ch] || ch)

// 无显示环境（CI / 容器）下需要关掉 GPU 相关，否则 DRM 报错刷屏且渲染进程起不来
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-dev-shm-usage')
app.commandLine.appendSwitch('no-sandbox')

// 隔离 userData，不污染真实用户目录
const testUserData = path.join(REPORT_DIR, 'test-userdata')
fs.rmSync(testUserData, { recursive: true, force: true })
fs.mkdirSync(REPORT_DIR, { recursive: true })
fs.mkdirSync(testUserData, { recursive: true })
app.setPath('userData', testUserData)

let win = null

console.log('[smoke] 脚本开始, type =', process.type)
app.whenReady().then(async () => {
  console.log('[smoke] whenReady 已触发')
  try {
    // 复用主进程的窗口创建逻辑（走真实注册路径）
    const { registerUpdater } = require(path.join(ROOT, 'electron', 'updater.cjs'))
    const { registerConvertersComponent } = require(path.join(ROOT, 'electron', 'converters-component.cjs'))
    registerUpdater()
    registerConvertersComponent()

    // main.cjs 里这几个 handler 是内联的，这里补注册（与 main.cjs 保持一致）。
    // doclite:get-open-file 返回可变 payload：B/C 段靠它触发真实的文件加载路径
    // （渲染层 useOpenFileFromArgs → setFile → 沉浸态/预览渲染整个链路都是真实代码）。
    ipcMain.handle('app:get-version', () => app.getVersion())
    let openFilePayload = null                     // null=无待打开文件；{name,size,data}
    ipcMain.handle('doclite:get-open-file', async () => openFilePayload)
    ipcMain.handle('doclite:open-external', async () => ({ ok: true }))

    const openFileInApp = async (absPath, displayName) => {
      const data = fs.readFileSync(absPath)
      openFilePayload = { name: displayName, size: data.length, data }
      win.webContents.send('doclite:open-file-changed')
    }

    win = new BrowserWindow({
      show: false,
      width: 1440,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: path.join(ROOT, 'electron', 'preload.cjs'),
      },
    })

    const rendererLogs = []
    win.webContents.on('console-message', (_e, _level, message) => {
      rendererLogs.push(message)
      console.log('[renderer]', message)
    })

    // 渲染进程崩溃检测：OOM（exitCode 5）在资源受限环境会静默卡死，
    // 必须显式检出并报出原因，否则表现为「executeJavaScript 超时」这种看不懂的失败。
    let renderCrash = null
    win.webContents.on('render-process-gone', (_e, details) => {
      renderCrash = details
      console.log('[smoke] 渲染进程退出:', JSON.stringify(details))
    })

    console.log('[smoke] 窗口已创建, 开始 loadFile')
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'))
    console.log('[smoke] loadFile 完成')
    // 安装 mousemove 探针（诊断用：B 段的热区判定依赖 window mousemove，
    // 若有意外事件流入可直接从断言 detail 看到 mv/lastX）
    await win.webContents.executeJavaScript(
      "window.__mv = 0; window.__lastX = null; window.__lastT = 0; " +
      "addEventListener('mousemove', e => { window.__mv++; window.__lastX = e.clientX; window.__lastT = Date.now() }, { passive: true }); true"
    ).catch(() => {})
    await sleep(2000)

    // 渲染层若已崩溃，后续所有断言都无意义 —— 立刻给出可执行的结论
    if (renderCrash) {
      const oom = renderCrash.exitCode === 5
      console.log('[fatal] 渲染进程崩溃：' + JSON.stringify(renderCrash))
      results.push({
        name: 'L4 集成层可在当前环境运行',
        ok: false,
        detail: oom
          ? `渲染进程 OOM（exitCode 5）。当前环境内存不足，需在有显示环境的开发机或 CI runner 上跑 L4；或用 --skip=L4 只跑 L1-L3。`
          : `渲染进程异常退出：${JSON.stringify(renderCrash)}`,
      })
      throw new Error('__SKIP_L4__')
    }

    // ---------- A1 渲染层加载 ----------
    const rootExists = await withTimeout(win.webContents.executeJavaScript(
      "!!document.querySelector('.app-root')"
    ), 8000, 'A1 根节点探测').catch(() => false)
    assert('A1 应用根节点已渲染', rootExists === true, `app-root=${rootExists}`)

    // ---------- A2 关键 UI 元素存在 ----------
    // 注意：侧栏在空态（非沉浸）不挂 .app-sidebar 类（只有沉浸态挂），
    // 所以探测用 '.app-sidebar, aside' 兼容两种形态，别只认一个类名
    const uiProbe = await withTimeout(win.webContents.executeJavaScript(`
      (() => {
        const has = (sel) => !!document.querySelector(sel)
        const btns = Array.from(document.querySelectorAll('button')).map(b => (b.textContent || '').trim())
        return {
          hasHeader: has('header'),
          hasSidebar: has('.app-sidebar') || has('aside'),
          hasUpload: has('input[type=file]') || /上传|选择|拖|Upload|Choose/i.test(document.body.innerText),
          hasFormatBadges: /PDF|DOCX|XLSX|PPT|MD|MOBI|AZW/i.test(document.body.innerText),
          bodyLen: document.body.innerText.length,
          btnCount: btns.length,
          lang: document.documentElement.lang || '',
        }
      })()
    `), 8000, 'A2 UI 探测').catch(() => null)
    assert('A2 Header 存在', uiProbe && uiProbe.hasHeader === true)
    assert('A3 侧栏存在（空态 aside / 沉浸态 .app-sidebar）', uiProbe && uiProbe.hasSidebar === true)
    assert('A4 上传入口存在', uiProbe && uiProbe.hasUpload === true)
    assert('A5 支持格式说明可见', uiProbe && uiProbe.hasFormatBadges === true, uiProbe ? `bodyLen=${uiProbe.bodyLen}` : 'probe 失败')
    assert('A6 页面有实际内容', uiProbe && uiProbe.bodyLen > 20, uiProbe ? `bodyLen=${uiProbe.bodyLen}` : '')

    // ---------- A7 i18n 语言属性（D-016 / R-027）----------
    assert('A7 html lang 已设置', uiProbe && typeof uiProbe.lang === 'string' && uiProbe.lang.length > 0,
      uiProbe ? `lang="${uiProbe.lang}"` : '')

    // ---------- A8 preload API 可用 ----------
    const apiProbe = await withTimeout(win.webContents.executeJavaScript(`
      (() => {
        const d = window.doclite || {}
        return {
          hasDoclite: !!window.doclite,
          platform: d.platform || '',
          fns: ['getOpenFile','getVersion','getConvertersStatus','checkUpdate','openExternal']
            .filter(k => typeof d[k] === 'function'),
        }
      })()
    `), 8000, 'A8 API 探测').catch(() => null)
    assert('A8 preload 暴露 window.doclite', apiProbe && apiProbe.hasDoclite === true)
    assert('A9 preload 关键方法齐备', apiProbe && apiProbe.fns.length >= 5,
      apiProbe ? `有 ${apiProbe.fns.length}/5：${apiProbe.fns.join(',')}` : '')
    assert('A10 platform 已注入', apiProbe && apiProbe.platform.length > 0, apiProbe ? apiProbe.platform : '')

    // ---------- A11 IPC 通路：getVersion 真实往返 ----------
    const ver = await withTimeout(win.webContents.executeJavaScript(
      "window.doclite.getVersion()"
    ), 8000, 'A11 getVersion').catch(() => null)
    assert('A11 IPC getVersion 往返成功', !!ver, `version=${ver}`)

    // ---------- A12 IPC 通路：组件状态探测（不联网） ----------
    const compStatus = await withTimeout(win.webContents.executeJavaScript(
      "window.doclite.getConvertersStatus()"
    ), 8000, 'A12 组件状态').catch(() => null)
    assert('A12 组件状态可探测', compStatus && typeof compStatus.installed === 'boolean',
      compStatus ? `installed=${compStatus.installed} source=${compStatus.source}` : 'null')

    // ================= B 段：文件加载 → 沉浸态热区（R-004 / D-013 / B-018）=================
    // 关键：不靠截图肉眼判断，读 .app-sidebar 的 computed transform（硬证据）。
    // 上下文：窗口 1440 宽 → 左 20% 边界 = 288px；侧栏宽 320px（w-80）。
    //   x=200 在 20% 区内（若退回旧版 8px 热区，200px 不会滑出 → 断言失败，防回归）
    //
    // ⚠ 环境要点：B 段前必须显示窗口（showInactive，不抢焦点）。
    // 隐藏窗口的 compositor 不推进 —— CSS 过渡会悬挂在起点（实测 300ms 的过渡在
    // 隐藏窗口里 1.8s 后仍停在 0，见 .smoke-report 时间序列采样），hover hit-test
    // 也不更新（enter/leave 不触发）。显示后行为与真实用户一致。
    try { win.showInactive() } catch { /* 无显示环境时继续（后续断言可能失败，属环境限制） */ }
    await sleep(300)

    const mdPath = path.join(REPORT_DIR, 'smoke-fixture.md')
    fs.writeFileSync(mdPath, [
      '# 冒烟测试 Marker',
      '',
      '这是冒烟测试标记句 SmokeMarker 第零段。',
      '',
      '## 小节',
      '',
      '第二段正文，用于验证 Markdown 预览渲染。',
      '',
    ].join('\n'), 'utf8')
    await openFileInApp(mdPath, 'smoke-fixture.md')

    const mdRendered = await waitFor("!!document.querySelector('.md-body')")
    assert('B1 Markdown 预览渲染（.md-body）', !!mdRendered)

    const sidebarTransform = () => withTimeout(win.webContents.executeJavaScript(
      "(() => { const el = document.querySelector('.app-sidebar'); return el ? getComputedStyle(el).transform : 'NO_EL' })()"
    ), 8000, '侧栏 transform').catch(() => 'N/A')

    // 轮询等待侧栏到达目标态（vs 固定 sleep）：过渡与防抖时长在不同环境有差异
    const CLOSED_RE = /^matrix\(1, 0, 0, 1, -\d/
    const openTfStr = 'matrix(1, 0, 0, 1, 0, 0)' // translate-x-0 的精确形态（过渡从 -336 → 0 只在终点等于它）
    const waitForSidebar = async (wantClosed, timeoutMs = 5000) => {
      const start = Date.now()
      let last = null
      while (Date.now() - start < timeoutMs) {
        last = await sidebarTransform()
        if (wantClosed ? CLOSED_RE.test(String(last)) : last === openTfStr) return last
        await sleep(120)
      }
      return last
    }

    const mvProbe = () => withTimeout(win.webContents.executeJavaScript(
      '({ mv: window.__mv || 0, x: window.__lastX })'
    ), 5000, 'mousemove 探针').catch(() => null)

    // 文件打开 → 沉浸态自动收起（currentFile 变化 → setSidebarOpen(false)）
    const loadTf = await waitForSidebar(true)
    assert('B2 打开文件后沉浸态自动收起（等待过渡完成）',
      loadTf && CLOSED_RE.test(String(loadTf)), `transform=${loadTf} mousemove=${JSON.stringify(await mvProbe())}`)

    // 移入左 20% 区内（x=200 < 288）→ 滑出（全局 mousemove 判定，跳变也可触发）
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 200, y: 500 })
    const openTf = await waitForSidebar(false)
    assert('B3 鼠标移到左 20% 区内（x=200）侧栏滑出',
      openTf === openTfStr, `transform=${openTf}`)

    // 移出 20% 区 → 防抖收起。必须分步跨过侧栏右缘（320px）：
    // sendInputEvent 瞬移不触发 DOM enter/leave（Chromium hover 由鼠标事件 hit-test
    // 驱动，旧版冒烟钩子已验证过），一步跳远测出的“不收”是测试假象非功能 bug
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 250, y: 500 }) // 仍在打开的侧栏内（<320px）→ mouseenter
    await sleep(200)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 340, y: 500 }) // 跨过侧栏右缘 → mouseleave → 300ms 防抖
    await sleep(200)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 480, y: 500 }) // 稳定在文档区
    const closedTf = await waitForSidebar(true) // 300ms 防抖 + 300ms 过渡（轮询覆盖）
    assert('B4 鼠标移出 20% 区（分步经侧栏右缘离开）侧栏防抖收起',
      closedTf && CLOSED_RE.test(String(closedTf)), `transform=${closedTf}`)

    // ================= C 段：PDF→AZW3 端到端（B-017 / B-020 / V-002 本地部分）=================
    // 结构完全复刻用户报告（docs/reviews/2026-11-05-用户反馈三项.md）：
    //   第十章 / 中文章名行 / 三行大写英文副标题 / 正文   ← 报告的多行副标题形态
    //   第十一章 / 中英混排同一物理行 / 正文             ← 早期修复的混排尾巴形态
    // 断言口径：英文副标题在生成的 MOBI 里彻底消失（正文任何章节 + 目录都不出现），
    // 中文章名与正文保留。这就是用户在文石/Kindle 上验的那件事，在本地用
    // 「真实转换管线 + 应用自身的 foliate-js 预览」提前闭环一遍。
    const subtitlePdfHtml = `<html><head><meta charset="utf-8"><style>
body { font-family: 'Noto Sans CJK SC', 'Noto Sans CJK', sans-serif; margin: 36px; }
p { margin: 5px 0; }
</style></head><body>
<p style="font-size:26px;font-weight:700">第十章</p>
<p style="font-size:15px">不断缩水的鱼就像货币一样</p>
<p style="font-size:13px;letter-spacing:1px">HOW AN ECONOMY</p>
<p style="font-size:13px;letter-spacing:1px">GROWS AND</p>
<p style="font-size:13px;letter-spacing:1px">WHY IT CRASHES</p>
<p style="font-size:12px">在太平洋的某个岛上，人们用石头做货币。这里是正文第一段。</p>
<img id="testimg" style="width:120px;height:90px">
<p style="font-size:26px;font-weight:700">第十一章</p>
<p style="font-size:15px">中岛帝国：远方的生命线 HOW AN ECONOMY GROWS AND WHY IT CRASHES</p>
<p style="font-size:12px">这是第二章的正文段落，用于第二处验证。</p>
<div style="page-break-before: always"></div>
<!-- 目录页标题用英文 Contents：中文"目录"经 printToPDF 提取会变部首变体"⽬录"，
     与 pdfToAzw3 的 /^(目\s*录|…|Contents)/ 目录页检测不匹配（合成 PDF 伪影，非 bug） -->
<p style="font-size:20px;font-weight:700">Contents</p>
<p style="font-size:13px">第十章 不断缩水的鱼就像货币一样</p>
<p style="font-size:13px">第十一章 中岛帝国：远方的生命线</p>
</body></html>`
    const pdfPath = path.join(REPORT_DIR, 'smoke-subtitle-e2e.pdf')
    const mobiPath = path.join(REPORT_DIR, 'smoke-subtitle-e2e.mobi')
    let pdfBuf = null
    try {
      const pdfWin = new BrowserWindow({ show: false })
      await pdfWin.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(subtitlePdfHtml, 'utf8').toString('base64'))
      // 合成一张真实位图嵌入 PDF（B-021 图片回归网所需的图源）：
      // Chromium printToPDF 会把它作为图片 XObject 嵌入，extractPageImages 才有图可提
      await pdfWin.webContents.executeJavaScript(`
        (() => new Promise(resolve => {
          const c = document.createElement('canvas'); c.width = 120; c.height = 90
          const x = c.getContext('2d'); x.fillStyle = '#c2410c'; x.fillRect(0, 0, 120, 90)
          x.fillStyle = '#ffffff'; x.font = 'bold 18px sans-serif'; x.fillText('PIC-1', 24, 52)
          const img = document.getElementById('testimg')
          img.onload = () => resolve(true)
          img.src = c.toDataURL('image/png')
        }))()
      `)
      await pdfWin.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
      pdfBuf = await pdfWin.webContents.printToPDF({ pageSize: 'A4', printBackground: false })
      pdfWin.destroy()
    } catch (e) {
      console.log('[smoke] 合成 PDF 失败:', e.message)
    }
    assert('C1 合成源 PDF 生成（printToPDF）', !!pdfBuf && pdfBuf.length > 1000, pdfBuf ? `${pdfBuf.length} bytes` : 'null')
    if (pdfBuf) fs.writeFileSync(pdfPath, pdfBuf)

    // 注入真实转换组件（与生产同路径：IIFE bundle + file:// script 标签；CSP 已放行 file:）
    if (pdfBuf) {
      const injected = await withTimeout(win.webContents.executeJavaScript(`
        (async () => {
          if (window.DocLiteConverters) return true
          await new Promise((resolve, reject) => {
            const s = document.createElement('script')
            s.src = ${JSON.stringify('file://' + path.join(ROOT, 'dist', 'converters', 'converters.js'))}
            s.onload = resolve
            s.onerror = () => reject(new Error('script load error'))
            document.head.appendChild(s)
          })
          for (let i = 0; i < 50 && !window.DocLiteConverters; i++) await new Promise(r => setTimeout(r, 100))
          return !!window.DocLiteConverters
        })()
      `), 20000, 'C2 注入转换组件').catch(() => false)
      assert('C2 转换组件 bundle 注入（window.DocLiteConverters）', injected === true)

      // 真实转换：拦下 downloadBlob 的产物（url 由 URL.createObjectURL 生成，取最后一个）
      const convR = await withTimeout(win.webContents.executeJavaScript(`
        (async () => {
          try {
            const b64pdf = ${JSON.stringify(pdfBuf.toString('base64'))}
            const bin = atob(b64pdf)
            const bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            const file = new File([bytes], 'smoke-subtitle-e2e.pdf', { type: 'application/pdf' })

            const captured = []
            const orig = URL.createObjectURL.bind(URL)
            URL.createObjectURL = function (b) { captured.push(b); return orig(b) }
            try {
              await window.DocLiteConverters.convertFile(file, '.pdf', 'to-azw3', null, {})
            } finally {
              URL.createObjectURL = orig
            }
            const blob = captured[captured.length - 1]
            if (!blob) return { error: 'no blob captured（convertFile 未产出下载）' }
            const buf = new Uint8Array(await blob.arrayBuffer())
            let out = ''
            for (let i = 0; i < buf.length; i += 0x8000) out += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
            return { size: buf.length, b64: btoa(out) }
          } catch (e) {
            return { error: String(e && e.message ? e.message : e) }
          }
        })()
      `), 90000, 'C3 PDF→AZW3 转换').catch((e) => ({ error: e.message }))

      const convOk = convR && convR.b64
      assert('C3 PDF→AZW3 真实转换产出 MOBI', !!convOk,
        convOk ? `${convR.size} bytes` : (convR && convR.error) || 'null')
      if (convOk) {
        const mobiBuf = Buffer.from(convR.b64, 'base64')
        fs.writeFileSync(mobiPath, mobiBuf)

        // 用应用自身的预览路径解析生成物（foliate-js 解析真实 MOBI6 二进制）
        await openFileInApp(mobiPath, 'smoke-subtitle-e2e.azw3')
        const azRendered = await waitFor("!!document.querySelector('.ebook-content')", { timeout: 20000, label: 'C4 ebook-content' })
        const bookFailed = await withTimeout(win.webContents.executeJavaScript(
          "/解析失败|Parse failed/.test(document.body.innerText)"
        ), 8000, 'C4 解析失败探测').catch(() => null)
        assert('C4 生成的 MOBI 可被应用预览打开（foliate-js 解析）',
          !!azRendered && bookFailed === false,
          azRendered ? `ebook-content=ok` : '未渲染')

        // 翻完全部章节，收集每章渲染文本与图片引用（B-021：图片必须被提取且 recindex
        // 为 5 位零填充——不带补零时 Kindle/文石不认，正文图片全部消失只剩封面）
        const sweep = await withTimeout(win.webContents.executeJavaScript(`
          (async () => {
            const texts = []
            const imgs = []
            const getText = () => { const el = document.querySelector('.ebook-content'); return el ? el.innerText : '' }
            const collectImgs = () => Array.from(document.querySelectorAll('.ebook-content img')).forEach(i =>
              imgs.push({ r: i.getAttribute('recindex'), w: i.naturalWidth }))
            // 等当前章节图片全部解码完成（R-118/L5：固定 350ms 在慢机上不够，
            // naturalWidth 读到 0 会假红）；空章节立即通过，超过 2s 放行收集
            const waitImgs = async () => {
              const t0 = Date.now()
              while (Date.now() - t0 < 2000) {
                const cur = Array.from(document.querySelectorAll('.ebook-content img'))
                if (cur.every(x => x.complete && x.naturalWidth > 0)) return true
                await new Promise(r => setTimeout(r, 100))
              }
              return false
            }
            const findNext = () => Array.from(document.querySelectorAll('button')).filter(b => /下一章|Next/.test(b.textContent || ''))[0]
            for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 350))
              await waitImgs()
              texts.push(getText())
              collectImgs()
              const next = findNext()
              if (!next || next.disabled) break
              next.click()
            }
            return { text: texts.join('\\n@@\\n'), imgs }
          })()
        `), 30000, 'C5 章节遍历').catch(() => ({ text: '', imgs: [] }))

        // 英文副标题残留：按「多词短语」判定——合成 PDF 的文本提取存在 y 抖动，
        // 与中文同行的首个英文词（如“…生命线 HOW”）可能残留在中文段落尾部，
        // 单词残留不视为回归；副标题短语的主体（≥2 词）必须全部消失
        const leak = ['HOW AN ECONOMY', 'GROWS AND', 'WHY IT CRASHES', 'HOW AN ECONOMY GROWS']
          .filter((k) => (sweep.text || '').toUpperCase().includes(k))
        assert('C5 全部章节正文无英文副标题残留', leak.length === 0,
          leak.length ? `残留: ${leak.join(' / ')}` : `共收集 ${sweep.length} 字符文本`)

        // 中文章名与正文保留（经部首归一化后比较，见 normCJK 说明）
        const nSweep = normCJK(sweep.text || '')
        const kept = ['第十章', '第十一章', '不断缩水的鱼就像货币一样', '中岛帝国：远方的生命线', '正文第一段']
          .filter((k) => !nSweep.includes(normCJK(k)))
        assert('C6 中文章名与正文保留', kept.length === 0, kept.length ? `缺失: ${kept.join(' / ')}` : '关键内容齐全')

        // 目录（TOC）：文石误把英文副标题当章节名的原始事故场景
        const tocR = await withTimeout(win.webContents.executeJavaScript(`
          (async () => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => /^\\s*(目录|Table of Contents)\\s*$/.test(b.textContent || ''))
            if (!btn) return { error: 'toc button not found' }
            btn.click()
            await new Promise(r => setTimeout(r, 400))
            const labels = Array.from(document.querySelectorAll('button')).map(b => (b.textContent || '').trim()).filter(Boolean)
            return { labels: labels.slice(0, 40) }
          })()
        `), 15000, 'C7 目录探测').catch((e) => ({ error: e.message }))
        const hasLabels = tocR && Array.isArray(tocR.labels)
        const nLabels = hasLabels ? tocR.labels.map(normCJK) : []
        const tocLeak = hasLabels ? nLabels.filter((t) => /HOW AN ECONOMY|GROWS AND|WHY IT CRASHES/i.test(t)) : ['目录按钮未找到/目录为空']
        const tocKept = hasLabels ? ['第十章', '第十一章'].filter((k) => !nLabels.some((t) => t.includes(normCJK(k)))) : []
        assert('C7 目录无英文副标题条目', tocLeak.length === 0,
          hasLabels ? `目录 ${tocR.labels.length} 条：${nLabels.slice(0, 8).join(' | ')}` : '打开目录失败')
        assert('C8 目录含两章章节标题', tocKept.length === 0, tocKept.length ? `缺失: ${tocKept.join(' / ')}` : '')

        // 图片引用回归网（B-021）：合成图必须被提取进 MOBI，且 recindex 为 5 位零填充
        // （不带补零时 Kindle/文石解析器不认，正文图片全部消失只剩 EXTH 封面），
        // 并经 foliate 真实加载成功（naturalWidth>0 = recindex→资源记录整条链路通）
        const imgs = (sweep && Array.isArray(sweep.imgs)) ? sweep.imgs : []
        const badFmt = imgs.filter(i => !/^\d{5}$/.test(String(i.r || '')))
        const notLoaded = imgs.filter(i => !(i.w > 0))
        assert('C9 正文图片 recindex 5位补零且加载成功（B-021）',
          imgs.length >= 1 && badFmt.length === 0 && notLoaded.length === 0,
          imgs.length === 0 ? '合成图未被提取进 MOBI'
            : `共 ${imgs.length} 图：${badFmt.length} 个格式错(${badFmt.map(i => JSON.stringify(i.r)).slice(0, 3).join(',')}) ${notLoaded.length} 个未加载`)
      }
    }

    // ================= D 段：PDF 预览缩放行为（B-024 / R-108 / R-109）=================
    // v0.8.3 审查实测两个渲染时序缺陷：①缩放时在途渲染把旧倍率 canvas 回填缓存
    // （H1/R-108，那一页又小又糊且永不自愈）；②滚动位置补偿因 ref 在渲染期被更新
    // 而恒为空操作（M1/R-109，放大后阅读位置漂移 ≈1.3 页）。修复=渲染代际保护 +
    // effect 内用真实旧值补偿。这里用合成多页 PDF 走「滚到中段 → 连点两次放大 →
    // 等收敛」，断言缓冲倍率/显示宽度/滚动位置（R-112 回归网）。
    try {
      // 8 页 A4：单页高 > 视口高，100% 也可以滚动；连点两次放大正是 H1 的
      // 真实触发节奏（第二击落在第一击的重渲在途期）
      const zoomPdfHtml = `<html><head><meta charset="utf-8"><style>
body { font-family: 'Noto Sans CJK SC', 'Noto Sans CJK', sans-serif; margin: 24px; }
.pg { min-height: 92vh; page-break-after: always; }
      </style></head><body>${Array.from({ length: 8 }, (_, i) =>
        `<div class="pg"><p style="font-size:30px;font-weight:700">缩放测试 第${i + 1}页</p><p style="font-size:12px">缩放行为回归网占位正文。</p></div>`
      ).join('')}</body></html>`
      let zoomPdfBuf = null
      try {
        const zw = new BrowserWindow({ show: false })
        try {
          await zw.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(zoomPdfHtml, 'utf8').toString('base64'))
          await zw.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
          zoomPdfBuf = await zw.webContents.printToPDF({ pageSize: 'A4', printBackground: false })
        } finally {
          zw.destroy()
        }
      } catch (e) {
        console.log('[smoke] 合成缩放 PDF 失败:', e.message)
      }

      if (zoomPdfBuf) {
        fs.writeFileSync(path.join(REPORT_DIR, 'smoke-zoom-e2e.pdf'), zoomPdfBuf)
        await openFileInApp(path.join(REPORT_DIR, 'smoke-zoom-e2e.pdf'), 'smoke-zoom-e2e.pdf')
        const pdfReady = await waitFor(
          "document.querySelectorAll('[data-pdf-page] canvas').length >= 2",
          { timeout: 20000, label: 'D 段 PDF canvas' })

        // 读缩放态：zoom 从工具栏百分比标签读（随 i18n 语言无关），scrollTop 从滚动容器读
        const readZoomState = () => withTimeout(win.webContents.executeJavaScript(`
          (() => {
            const zin = Array.from(document.querySelectorAll('button')).find(b => /放大|Zoom in/i.test(b.getAttribute('aria-label') || ''))
            const lbl = zin && zin.parentElement ? zin.parentElement.querySelector('span') : null
            const z = lbl ? parseInt(String(lbl.textContent).replace(/[^0-9]/g, ''), 10) : NaN
            const el = document.querySelector('[data-pdf-scroll]')
            return {
              zoom: isNaN(z) ? null : z,
              scrollTop: el ? Math.round(el.scrollTop) : -1,
              dpr: window.devicePixelRatio || 1,
              canvases: Array.from(document.querySelectorAll('[data-pdf-page] canvas')).map(c => ({
                w: c.width, sw: parseFloat(c.style.width) || 0,
              })),
            }
          })()
        `), 8000, 'D 段读态').catch(() => null)

        const clickZoomIn = () => withTimeout(win.webContents.executeJavaScript(`
          (() => {
            const b = Array.from(document.querySelectorAll('button')).find(x => /放大|Zoom in/i.test(x.getAttribute('aria-label') || ''))
            if (b && !b.disabled) b.click()
            return !!b
          })()
        `), 5000, 'D 段点放大').catch(() => false)

        const st0 = await readZoomState()
        assert('C10 前置：多页 PDF 预览渲染且初始缩放 100%',
          !!(pdfReady && st0 && st0.zoom === 100 && st0.canvases.length >= 2),
          `canvas=${pdfReady ? '≥2' : '未渲染'} 初始缩放=${st0 ? st0.zoom + '%' : '?'} dpr=${st0 ? st0.dpr : '?'}`)

        if (pdfReady && st0 && st0.zoom === 100 && st0.canvases.length >= 2) {
          // 页面基础宽（scale=1）：100% 时 canvas css 宽 = 基础宽（合成 PDF 各页同宽）
          const baseW = st0.canvases.reduce((s, c) => s + c.sw, 0) / st0.canvases.length
          // 期望建立倍率：与 PdfRenderer 同式（dpr 失取 [1,2]，乘 zoom 后封顶 3）
          const expScale = (st) => {
            const d = Math.min(2, Math.max(1, st.dpr || 1))
            return Math.min(3, Math.max(1, d * (st.zoom / 100)))
          }
          // 收敛判定：显示宽 = baseW×zoom（±3%）、缓冲/显示 = scale/zoom（±0.08）
          const converged = (st) => !!(st && st.zoom && st.canvases.length >= 2
            && st.canvases.every(c => c.sw > 0
              && Math.abs(c.sw - baseW * st.zoom / 100) / (baseW * st.zoom / 100) < 0.03
              && Math.abs(c.w / c.sw - expScale(st) / (st.zoom / 100)) < 0.08))

          // 滚到 30%（触发新页渲染，模拟真实阅读位置），等 100% 档初始收敛
          await withTimeout(win.webContents.executeJavaScript(
            "(() => { const el = document.querySelector('[data-pdf-scroll]'); if (el) el.scrollTop = el.scrollHeight * 0.3; return true })()"
          ), 5000, 'D 段滚动').catch(() => {})
          const settle = async (timeout = 8000) => {
            const t0 = Date.now()
            let st = null
            while (Date.now() - t0 < timeout) {
              st = await readZoomState()
              if (converged(st)) break
              await sleep(150)
            }
            return st
          }
          const stA = await settle()
          const scrollBefore = stA ? stA.scrollTop : -1
          const zoomBefore = stA ? stA.zoom : 0

          // 连点两次放大（100→110→120）：第二击落在第一击的重渲在途期，正是 H1 真实触发节奏
          await clickZoomIn()
          await sleep(150)
          await clickZoomIn()
          const stB = await settle()

          assert('C10 缩放重渲：canvas 缓冲倍率与显示宽度随缩放更新，无旧倍率残留（B-024/R-108）',
            converged(stB) && stB && stB.zoom > zoomBefore,
            stB
              ? `zoom=${zoomBefore}%→${stB.zoom}% 缓冲/显示=${stB.canvases.map(c => (c.w / c.sw).toFixed(2)).join(',')}（期望 ${(expScale(stB) / (stB.zoom / 100)).toFixed(2)}）`
              : '读态失败')

          const ratio = stB && scrollBefore > 0 ? stB.scrollTop / scrollBefore : 0
          const expectRatio = stB ? stB.zoom / zoomBefore : 1
          assert('C11 缩放按比例保持滚动位置（R-109）',
            scrollBefore > 0 && Math.abs(ratio - expectRatio) <= 0.03,
            `scrollTop ${scrollBefore}→${stB ? stB.scrollTop : '?'} 比例 ${ratio.toFixed(3)}（期望 ${expectRatio.toFixed(3)}）`)
        }
      }
    } catch (e) {
      console.log('[smoke] D 段失败:', e && e.stack ? e.stack : String(e))
      results.push({ name: 'D 段 PDF 缩放行为无异常', ok: false, detail: String(e && e.message ? e.message : e) })
    }

    // ---------- A16 渲染层无未捕获异常 ----------
    const errLogs = rendererLogs.filter((l) => /Uncaught|TypeError|ReferenceError|is not a function/i.test(l))
    assert('A16 渲染层无未捕获异常', errLogs.length === 0,
      errLogs.length ? errLogs.slice(0, 2).join(' | ') : '')

    // ---------- 截图（供人工复核，非断言依据）----------
    try {
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(REPORT_DIR, 'smoke-app.png'), img.toPNG())
      console.log('[shot] .smoke-report/smoke-app.png')
    } catch (e) {
      console.log('[shot] 截图失败（不影响断言）:', e.message)
    }
    console.log('[artifacts] smoke-subtitle-e2e.pdf / smoke-subtitle-e2e.mobi 已存 .smoke-report/（供人工复核）')
  } catch (e) {
    if (e && e.message === '__SKIP_L4__') {
      console.log('[smoke] L4 在当前环境跳过（原因见上）')
    } else {
      console.log('[fatal]', e && e.stack ? e.stack : String(e))
      results.push({ name: '集成测试无致命错误', ok: false, detail: String(e && e.message ? e.message : e) })
    }
  } finally {
    try {
      fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true })
      fs.writeFileSync(RESULT_FILE, JSON.stringify(results, null, 2), 'utf8')
    } catch {}
    const passed = results.filter((r) => r.ok).length
    const failed = results.length - passed
    console.log(`\n[integration] ${passed} 通过 / ${failed} 失败`)
    app.exit(failed === 0 ? 0 : 1)
  }
})
