import { useState, useCallback } from 'react'
import { useFileStore } from '../context/FileContext'
import { validateFile, getExtension, FORMAT_META } from '../utils/fileHelpers'

// ---------- Icons (inline SVG) ----------
function UploadIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  )
}

function XIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

function FileIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}

// ---------- Component ----------
export default function UploadZone() {
  const { currentFile, setFile, setError, clearFile } = useFileStore()
  const [dragging, setDragging] = useState(false)
  const inputId = 'file-upload-input'

  // Accept string for <input>
  const acceptStr = '.docx,.xlsx,.pptx,.pdf'

  const handleFile = useCallback((file) => {
    const err = validateFile(file)
    if (err) {
      setError(err)
      return
    }
    setFile({
      name: file.name,
      size: file.size,
      type: file.type,
      file,          // keep the raw File object for later rendering
    })
  }, [setFile, setError])

  // Drag events
  const onDragOver = useCallback((e) => { e.preventDefault(); setDragging(true) }, [])
  const onDragLeave = useCallback((e) => { e.preventDefault(); setDragging(false) }, [])
  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  // Click-to-upload
  const onInputChange = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''   // allow re-uploading the same file
  }, [handleFile])

  // Format badge
  const ext = currentFile ? getExtension(currentFile.name) : ''
  const meta = FORMAT_META[ext]

  return (
    <div className="space-y-4">
      {/* Drop zone — use native <label> so the file picker opens on click in ALL browsers */}
      <label
        htmlFor={inputId}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        className={`
          focus-ring relative flex flex-col items-center justify-center gap-2
          rounded-xl border-2 border-dashed cursor-pointer transition-colors
          px-6 py-8 select-none block
          ${dragging
            ? 'border-accent-400 bg-accent-50'
            : currentFile
              ? 'border-ink-200 bg-ink-50'
              : 'border-ink-300 bg-white hover:border-accent-300 hover:bg-accent-50/30'
          }
        `}
      >
        <UploadIcon className="w-8 h-8 text-ink-400" />
        <p className="text-sm font-medium text-ink-600">
          拖拽文件到此处，或<span className="text-accent-600">点击上传</span>
        </p>
        <p className="text-xs text-ink-400">
          支持 .docx / .xlsx / .pptx / .pdf，最大 50 MB
        </p>
        <input
          id={inputId}
          type="file"
          accept={acceptStr}
          onChange={onInputChange}
          className="sr-only"
          aria-label="选择文件"
        />
      </label>

      {/* Current file card */}
      {currentFile && (
        <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-ink-200 shadow-soft">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-ink-100 shrink-0">
            <FileIcon className="w-5 h-5 text-ink-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink-800 truncate">{currentFile.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {meta && (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${meta.color}`}>
                  {meta.label}
                </span>
              )}
              <span className="text-xs text-ink-400">{(currentFile.size / 1024 / 1024).toFixed(2)} MB</span>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); clearFile() }}
            className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-ink-100 transition-colors focus-ring"
            aria-label="移除文件"
            title="移除文件"
          >
            <XIcon className="w-4 h-4 text-ink-400" />
          </button>
        </div>
      )}
    </div>
  )
}
