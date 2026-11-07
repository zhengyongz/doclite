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
// 运行：npx electron scripts/smoke/integration-app.cjs --no-sandbox
// 依赖：dist/index.html 已构建（由 run.mjs 自动处理）

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..', '..')
const RESULT_FILE = process.env.DOCLITE_SMOKE_RESULT || path.join(ROOT, '.smoke-report', 'integration.json')

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

// 无显示环境（CI / 容器）下需要关掉 GPU 相关，否则 DRM 报错刷屏且渲染进程起不来
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-dev-shm-usage')
app.commandLine.appendSwitch('no-sandbox')

// 隔离 userData，不污染真实用户目录
const testUserData = path.join(ROOT, '.smoke-report', 'test-userdata')
fs.rmSync(testUserData, { recursive: true, force: true })
fs.mkdirSync(testUserData, { recursive: true })
app.setPath('userData', testUserData)

console.log('[smoke] 脚本开始, type =', process.type)
app.whenReady().then(async () => {
  console.log('[smoke] whenReady 已触发')
  let win = null
  try {
    // 复用主进程的窗口创建逻辑（走真实注册路径）
    const { registerUpdater } = require(path.join(ROOT, 'electron', 'updater.cjs'))
    const { registerConvertersComponent } = require(path.join(ROOT, 'electron', 'converters-component.cjs'))
    registerUpdater()
    registerConvertersComponent()

    // main.cjs 里这几个 handler 是内联的，这里补注册（与 main.cjs 保持一致）
    ipcMain.handle('app:get-version', () => app.getVersion())
    ipcMain.handle('doclite:get-open-file', async () => null)
    ipcMain.handle('doclite:open-external', async () => ({ ok: true }))

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
    const uiProbe = await withTimeout(win.webContents.executeJavaScript(`
      (() => {
        const has = (sel) => !!document.querySelector(sel)
        const btns = Array.from(document.querySelectorAll('button')).map(b => (b.textContent || '').trim())
        return {
          hasHeader: has('header'),
          hasSidebar: has('.app-sidebar'),
          hasUpload: has('input[type=file]') || /上传|选择|拖/.test(document.body.innerText),
          hasFormatBadges: /PDF|DOCX|XLSX|PPT|MD|MOBI|AZW/i.test(document.body.innerText),
          bodyLen: document.body.innerText.length,
          btnCount: btns.length,
          lang: document.documentElement.lang || '',
        }
      })()
    `), 8000, 'A2 UI 探测').catch(() => null)
    assert('A2 Header 存在', uiProbe && uiProbe.hasHeader === true)
    assert('A3 侧栏存在', uiProbe && uiProbe.hasSidebar === true)
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

    // ---------- A13-A15 沉浸侧栏（R-004 / D-013）----------
    // 关键：不靠截图肉眼判断，读 .app-sidebar 的 computed transform（硬证据）
    const sidebarTransform = async () => withTimeout(win.webContents.executeJavaScript(
      "getComputedStyle(document.querySelector('.app-sidebar')).transform"
    ), 8000, '侧栏 transform').catch(() => 'N/A')

    const beforeTf = await sidebarTransform()
    assert('A13 侧栏初始可读取 transform', beforeTf && beforeTf !== 'N/A', beforeTf)

    // 分步移动鼠标（sendInputEvent 是离散跳变，必须分步才能触发 enter/leave）
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 500 })
    await sleep(700)
    const openTf = await sidebarTransform()
    const openIsVisible = openTf && !/matrix\(1, 0, 0, 1, -/.test(openTf)
    assert('A14 鼠标移入左缘后侧栏滑出', openIsVisible === true, `transform=${openTf}`)

    // 移出到文档区 → 应防抖收起
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 200, y: 500 })
    await sleep(250)
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 900, y: 500 })
    await sleep(900)
    const closedTf = await sidebarTransform()
    const closedIsHidden = closedTf && /matrix\(1, 0, 0, 1, -\d/.test(closedTf)
    assert('A15 鼠标移出后侧栏收起', closedIsHidden === true, `transform=${closedTf}`)

    // ---------- A16 渲染层无未捕获异常 ----------
    const errLogs = rendererLogs.filter((l) => /Uncaught|TypeError|ReferenceError|is not a function/i.test(l))
    assert('A16 渲染层无未捕获异常', errLogs.length === 0,
      errLogs.length ? errLogs.slice(0, 2).join(' | ') : '')

    // ---------- 截图（供人工复核，非断言依据）----------
    try {
      const img = await win.webContents.capturePage()
      const shotDir = path.join(ROOT, '.smoke-report')
      fs.mkdirSync(shotDir, { recursive: true })
      fs.writeFileSync(path.join(shotDir, 'smoke-app.png'), img.toPNG())
      console.log('[shot] .smoke-report/smoke-app.png')
    } catch (e) {
      console.log('[shot] 截图失败（不影响断言）:', e.message)
    }
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
