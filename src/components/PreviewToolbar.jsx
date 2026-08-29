import { useFileStore } from '../context/FileContext'
import { getExtension, FORMAT_META } from '../utils/fileHelpers'

// Zoom icons
function ZoomOutIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  )
}

function ZoomInIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  )
}

export default function PreviewToolbar() {
  const { currentFile, zoomLevel, setZoom } = useFileStore()

  if (!currentFile) return null

  const ext = getExtension(currentFile.name)
  const meta = FORMAT_META[ext]

  const zoomStep = 10
  const minZoom = 50
  const maxZoom = 200

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-white border-b border-ink-100 select-none">
      {/* Left: file badge */}
      <div className="flex items-center gap-2 min-w-0">
        {meta && (
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${meta.color}`}>
            {meta.label}
          </span>
        )}
        <span className="text-sm text-ink-600 truncate max-w-[180px] lg:max-w-[320px]">
          {currentFile.name}
        </span>
      </div>

      {/* Right: zoom controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setZoom(Math.max(minZoom, zoomLevel - zoomStep))}
          disabled={zoomLevel <= minZoom}
          className="p-1.5 rounded-md hover:bg-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-ring"
          aria-label="缩小"
        >
          <ZoomOutIcon className="w-4 h-4" />
        </button>
        <span className="text-xs font-mono text-ink-500 w-10 text-center tabular-nums">
          {zoomLevel}%
        </span>
        <button
          onClick={() => setZoom(Math.min(maxZoom, zoomLevel + zoomStep))}
          disabled={zoomLevel >= maxZoom}
          className="p-1.5 rounded-md hover:bg-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-ring"
          aria-label="放大"
        >
          <ZoomInIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
