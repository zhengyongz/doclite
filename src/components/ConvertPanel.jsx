import { useState } from 'react'
import { useFileStore } from '../context/FileContext'
import { getExtension } from '../utils/fileHelpers'
import { convertFile } from '../utils/converters'

// Inline icons
function PdfIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}

function ImageIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  )
}

function WordIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="13" y2="17"/>
    </svg>
  )
}

function SpinnerIcon({ className }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  )
}

export default function ConvertPanel() {
  const { currentFile, setError, isConverting, setConverting, setConvertProgress, convertProgress } = useFileStore()

  if (!currentFile) return null

  const ext = getExtension(currentFile.name)

  // Determine available conversions based on file format
  const conversions = []

  if (ext === '.docx' || ext === '.xlsx' || ext === '.pptx') {
    conversions.push({
      key: 'to-pdf',
      label: '导出为 PDF',
      description: '将文档转换为 PDF 格式',
      icon: PdfIcon,
      color: 'text-red-500',
    })
  }

  if (ext === '.pdf') {
    conversions.push(
      {
        key: 'to-docx',
        label: '导出为 Word (.docx)',
        description: '将 PDF 转换为可编辑的 Word 文档',
        icon: WordIcon,
        color: 'text-blue-500',
      },
      {
        key: 'to-png',
        label: '导出为图片 (PNG)',
        description: '将每页 PDF 导出为高清 PNG 图片',
        icon: ImageIcon,
        color: 'text-green-500',
      },
    )
  }

  if (conversions.length === 0) return null

  const handleConvert = async (key) => {
    if (isConverting) return

    setConverting(true)
    setConvertProgress(null)

    try {
      await convertFile(currentFile.file, ext, key, (current, total) => {
        const percent = Math.round((current / total) * 100)
        setConvertProgress(`${percent}%`)
      })
    } catch (err) {
      console.error('[ConvertPanel] conversion error:', err)
      setError(`转换失败：${err.message || '未知错误'}`)
    } finally {
      setConverting(false)
      setConvertProgress(null)
    }
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-3 shadow-soft">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-ink-400 uppercase tracking-wider">
          格式转换
        </p>
        {isConverting && convertProgress && (
          <span className="text-xs text-accent-500 font-medium tabular-nums">
            {convertProgress}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {conversions.map(({ key, label, description, icon: Icon, color }) => {
          const isThisConverting = isConverting
          return (
            <button
              key={key}
              onClick={() => handleConvert(key)}
              disabled={isConverting}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-ink-200 bg-white hover:border-accent-300 hover:bg-accent-50/40 transition-colors focus-ring group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isThisConverting ? (
                <SpinnerIcon className="w-5 h-5 shrink-0 text-accent-400" />
              ) : (
                <Icon className={`w-5 h-5 shrink-0 ${color}`} />
              )}
              <div className="text-left">
                <p className="text-sm font-medium text-ink-700 group-hover:text-accent-700">{label}</p>
                <p className="text-[11px] text-ink-400">{description}</p>
              </div>
            </button>
          )
        })}
      </div>
      {isConverting && (
        <p className="mt-2 text-xs text-ink-400">
          正在转换中，请稍候…
        </p>
      )}
    </div>
  )
}
