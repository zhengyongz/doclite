import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { renderAsync } from 'docx-preview'
import { useFileStore } from '../../context/FileContext'

export default function DocxRenderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const [status, setStatus] = useState('loading')  // loading | ready | error
  const containerRef = useRef(null)

  const renderDoc = useCallback(async () => {
    if (!currentFile?.file) return
    if (!containerRef.current) return

    try {
      setPreviewStatus('loading')
      setStatus('loading')

      // Clear previous content
      containerRef.current.innerHTML = ''

      // docx-preview renders the .docx into the container as HTML
      await renderAsync(currentFile.file, containerRef.current, null, {
        className: 'docx-page',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        experimental: true,
      })

      setStatus('ready')
      setPreviewStatus('ready')
    } catch (err) {
      console.error('[DocxRenderer] render error:', err)
      setStatus('error')
      setError('Word 文档解析失败，文件可能已损坏或格式不正确')
    }
  }, [currentFile, setPreviewStatus, setError])

  // useLayoutEffect 确保 DOM 已挂载再渲染（替代原来的 50ms 轮询等待）
  useLayoutEffect(() => {
    renderDoc()
  }, [renderDoc])

  return (
    <div className="h-full overflow-auto p-4 lg:p-6" style={{ zoom: zoomLevel / 100 }}>
      {/* Container is always mounted so ref is available for rendering */}
      <div
        ref={containerRef}
        className="mx-auto bg-white shadow-soft rounded-lg min-w-[200px]"
        style={{ maxWidth: '820px', minHeight: '400px' }}
      />
      {status === 'loading' && (
        <div className="flex items-center justify-center py-8 text-ink-400 text-sm">
          <svg className="w-5 h-5 mr-2 animate-spin text-accent-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          正在解析…
        </div>
      )}
    </div>
  )
}
