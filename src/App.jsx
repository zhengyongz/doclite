import { FileProvider, useFileStore } from './context/FileContext'
import Header from './components/Header'
import UploadZone from './components/UploadZone'
import Sidebar from './components/Sidebar'
import EmptyState from './components/EmptyState'
import PreviewToolbar from './components/PreviewToolbar'
import PreviewViewport from './components/PreviewViewport'
import ConvertPanel from './components/ConvertPanel'
import ErrorToast from './components/ErrorToast'
import UpdateDialog from './components/UpdateDialog'
import { useUpdater } from './useUpdater'
import { useI18n } from './i18n'
import { useEffect, useRef, useState, useCallback } from 'react'
import { getExtension } from './utils/fileHelpers'

// ---------- 文件关联：加载主进程待打开的文件 ----------
function useOpenFileFromArgs() {
  const { setFile, setError } = useFileStore()
  const { t } = useI18n()
  const setFileRef = useRef(setFile)
  const setErrorRef = useRef(setError)
  // 用 ref 跟随最新 t：该 useEffect 只在首帧注册，切语言后需用最新文案（workbuddy M3）
  const tRef = useRef(t)
  tRef.current = t
  setFileRef.current = setFile
  setErrorRef.current = setError

  const loadOpenFile = async () => {
    const bridge = window.doclite
    if (!bridge?.getOpenFile) return
    try {
      const info = await bridge.getOpenFile()
      if (!info || !info.data) return
      const file = new File([info.data], info.name, { type: 'application/octet-stream' })
      // 校验扩展名（与上传入口一致）
      const ext = getExtension(info.name)
      if (!['.pdf', '.docx', '.xlsx', '.xls', '.pptx', '.mobi', '.azw3', '.md', '.markdown'].includes(ext)) {
        setErrorRef.current(tRef.current('err.file.unsupported', { name: info.name }))
        return
      }
      setFileRef.current({
        name: info.name,
        size: info.size,
        type: file.type,
        file,
      })
    } catch (err) {
      console.error('[App] 打开外部文件失败:', err)
      setErrorRef.current(tRef.current('err.file.openFailed', { msg: (err && err.message) || '' }))
    }
  }

  useEffect(() => {
    // 启动时拉取一次（双击文件启动场景）
    loadOpenFile()
    // 主进程推送新文件（单实例二次打开场景）
    const off = window.doclite?.onOpenFileChanged?.(() => loadOpenFile())
    return () => { if (off) off() }
  }, [])
}

// ---------- Main layout (needs context) ----------
function AppBody() {
  const { currentFile } = useFileStore()
  const updater = useUpdater()
  useOpenFileFromArgs()

  // ---------- 沉浸式预览（v0.7.0+）：打开文件时左侧栏自动收起 ----------
  // 预览区占满全宽；鼠标移到屏幕左缘热区时工具栏浮层滑出（不挤压文档），
  // 鼠标移开 300ms 后再收起。空态（无文件）侧栏常驻，交互与旧版一致。
  const immersive = !!currentFile
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const hideTimerRef = useRef(null)
  const cancelHide = useCallback(() => clearTimeout(hideTimerRef.current), [])
  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setSidebarOpen(false), 300)
  }, [])

  // 文件打开/切换 → 立即收起（让新文档占满预览区）
  useEffect(() => {
    setSidebarOpen(false)
    cancelHide()
  }, [currentFile, cancelHide])

  // 卸载清理
  useEffect(() => () => clearTimeout(hideTimerRef.current), [])

  return (
    <div className="app-root flex flex-col h-screen overflow-hidden bg-ink-50">
      <Header />

      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">
        {/* ---- Left sidebar: 空态常驻；预览态自动隐藏浮层 ----
            收起时 aria-hidden + inert：阻止 Tab 聚焦与读屏读到视口外的侧栏（workbuddy L1） */}
        <div
          onMouseEnter={immersive ? cancelHide : undefined}
          onMouseLeave={immersive ? scheduleHide : undefined}
          aria-hidden={immersive && !sidebarOpen ? 'true' : undefined}
          inert={immersive && !sidebarOpen ? '' : undefined}
          className={
            immersive
              ? `app-sidebar fixed top-[var(--header-h)] bottom-0 left-0 z-40 flex flex-col gap-4 p-4 overflow-y-auto overflow-x-hidden border-r border-ink-100 bg-[#f8fafb] w-80 max-w-[80vw] shadow-lg transition-transform duration-300 ease-out will-change-transform ${
                  sidebarOpen ? 'translate-x-0' : '-translate-x-[calc(100%+16px)]'
                }`
              : 'flex flex-col gap-4 p-4 overflow-y-auto overflow-x-hidden border-r border-ink-100 bg-ink-50 lg:w-80 shrink-0 max-w-full lg:max-w-80'
          }
        >
          <UploadZone />
          {currentFile && <ConvertPanel />}
          <Sidebar updater={updater} />
        </div>

        {/* 沉浸模式：屏幕左缘热区（鼠标移入滑出工具栏；z 低于侧栏，展开时被覆盖） */}
        {immersive && (
          <div
            className="immersion-hotzone fixed top-[var(--header-h)] bottom-0 left-0 z-30 w-2"
            onMouseEnter={() => {
              cancelHide()
              setSidebarOpen(true)
            }}
          />
        )}

        {/* ---- Right panel (preview + convert) ---- */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden w-full lg:w-auto">
          {currentFile ? (
            <>
              <PreviewToolbar />
              <PreviewViewport />
            </>
          ) : (
            <EmptyState />
          )}
        </div>
      </div>

      {/* Global error toast */}
      <ErrorToast />

      {/* 自动更新弹窗 */}
      <UpdateDialog updater={updater} />
    </div>
  )
}

// ---------- Root with providers ----------
export default function App() {
  return (
    <FileProvider>
      <AppBody />
    </FileProvider>
  )
}
