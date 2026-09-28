import { useFileStore } from '../context/FileContext'
import { getExtension, FORMAT_META } from '../utils/fileHelpers'

// Sidebar：左侧信息栏。updater 由 App 传入（与 UpdateDialog 共享同一状态实例）
export default function Sidebar({ updater }) {
  const { currentFile } = useFileStore()

  const hasUpdate = updater?.phase === 'available'
  const checking = updater?.phase === 'checking'
  const latestVersion = updater?.info?.latestVersion || ''

  // Show quick format summary when a file is loaded
  const ext = currentFile ? getExtension(currentFile.name) : ''
  const meta = FORMAT_META[ext]

  return (
    <aside className="flex flex-col gap-4 min-w-0">
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

      {/* Version & update */}
      <div className={`p-3 rounded-lg shadow-soft ${hasUpdate ? 'bg-accent-50 border border-accent-200' : 'bg-white border border-ink-200'}`}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-ink-400 uppercase tracking-wider">版本信息</p>
          {hasUpdate && (
            <span className="px-1.5 py-0.5 rounded-full bg-accent-500 text-white text-[10px] font-semibold">
              发现新版本 v{latestVersion}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink-700">
            {updater?.appVersion ? `v${updater.appVersion}` : ''}
          </span>
          <button
            onClick={updater?.openDialog}
            disabled={checking}
            className="px-2.5 py-1 rounded-lg bg-ink-900 text-white text-[11px] font-medium hover:bg-ink-700 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
            title="检查是否有新版本"
          >
            {checking ? '检查中…' : hasUpdate ? '查看更新' : '检查更新'}
          </button>
        </div>
      </div>
    </aside>
  )
}