import { FileProvider, useFileStore } from './context/FileContext'
import Header from './components/Header'
import UploadZone from './components/UploadZone'
import Sidebar from './components/Sidebar'
import EmptyState from './components/EmptyState'
import PreviewToolbar from './components/PreviewToolbar'
import PreviewViewport from './components/PreviewViewport'
import ConvertPanel from './components/ConvertPanel'
import ErrorToast from './components/ErrorToast'

// ---------- Main layout (needs context) ----------
function AppBody() {
  const { currentFile } = useFileStore()

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
