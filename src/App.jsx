import { FileProvider, useFileStore } from './context/FileContext'
import Header from './components/Header'
import UploadZone from './components/UploadZone'
import Sidebar from './components/Sidebar'
import EmptyState from './components/EmptyState'
import PreviewToolbar from './components/PreviewToolbar'
import PreviewViewport from './components/PreviewViewport'
import ConvertPanel from './components/ConvertPanel'
import ErrorToast from './components/ErrorToast'
import { useEffect, useRef } from 'react'
import { getExtension } from './utils/fileHelpers'

// ---------- 文件关联：加载主进程待打开的文件 ----------
function useOpenFileFromArgs() {
  const { setFile, setError } = useFileStore()
  const setFileRef = useRef(setFile)
  const setErrorRef = useRef(setError)
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
      if (!['.pdf', '.docx', '.xlsx', '.pptx', '.mobi', '.azw3'].includes(ext)) {
        setErrorRef.current(`不支持的文件类型：${info.name}`)
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
      setErrorRef.current(`打开文件失败：${err.message || '未知错误'}`)
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
  useOpenFileFromArgs()

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-ink-50">
      <Header />

      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">
        {/* ---- Left sidebar (upload + info) ---- */}
        <div className="flex flex-col gap-4 p-4 overflow-y-auto overflow-x-hidden border-r border-ink-100 bg-ink-50 lg:w-80 shrink-0 max-w-full lg:max-w-80">
          <UploadZone />
          {currentFile && <ConvertPanel />}
          <Sidebar />
        </div>

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
