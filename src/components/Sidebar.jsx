import { useFileStore } from '../context/FileContext'
import { getExtension, FORMAT_META } from '../utils/fileHelpers'

export default function Sidebar() {
  const { currentFile } = useFileStore()

  // Show quick format summary when a file is loaded
  const ext = currentFile ? getExtension(currentFile.name) : ''
  const meta = FORMAT_META[ext]

  return (
    <aside className="flex flex-col gap-4 min-w-0">
      {/* Upload zone is injected by App via children or composed separately */}

      {/* Quick stats — only visible when a file is loaded */}
      {currentFile && meta && (
        <div className="p-3 rounded-lg bg-white border border-ink-200 shadow-soft">
          <p className="text-xs font-semibold text-ink-400 uppercase tracking-wider mb-2">文件信息</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink-400">格式</dt>
            <dd className="text-ink-700 font-medium">{meta.label} ({ext})</dd>
            <dt className="text-ink-400">大小</dt>
            <dd className="text-ink-700 font-medium">{(currentFile.size / 1024 / 1024).toFixed(2)} MB</dd>
            <dt className="text-ink-400">名称</dt>
            <dd className="text-ink-700 font-medium truncate" title={currentFile.name}>{currentFile.name}</dd>
          </dl>
        </div>
      )}

      {/* Usage hints */}
      <div className="p-3 rounded-lg bg-accent-50 border border-accent-200">
        <p className="text-xs font-semibold text-accent-700 mb-1">安全提示</p>
        <p className="text-xs text-accent-600 leading-relaxed break-words">
          所有文件处理均在您的浏览器本地完成，不会上传至任何服务器，您的数据始终安全可控。
        </p>
      </div>

      {/* Supported formats */}
      <div className="p-3 rounded-lg bg-white border border-ink-200 shadow-soft">
        <p className="text-xs font-semibold text-ink-400 uppercase tracking-wider mb-2">支持的格式</p>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(FORMAT_META).map(([ext, m]) => (
            <span key={ext} className={`inline-flex items-center justify-center px-2 py-1 rounded text-xs font-semibold ${m.color}`}>
              {ext} — {m.label}
            </span>
          ))}
        </div>
      </div>
    </aside>
  )
}
