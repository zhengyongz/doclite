import { useState, useEffect, useCallback, useRef } from 'react'
import { useFileStore } from '../../context/FileContext'

// Configure pdf.js worker (Vite handles the URL import)
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfRenderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const [pages, setPages] = useState([])      // array of canvasDataURLs
  const [loading, setLoading] = useState(true)
  const [pageInfos, setPageInfos] = useState([])
  const containerRef = useRef(null)

  const renderPdf = useCallback(async () => {
    if (!currentFile?.file) return
    try {
      setPreviewStatus('loading')
      setLoading(true)
      setPages([])

      const arrayBuffer = await currentFile.file.arrayBuffer()
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      const renderedPages = []
      const infos = []

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        canvas.width = viewport.width
        canvas.height = viewport.height

        await page.render({
          canvasContext: ctx,
          viewport,
        }).promise

        renderedPages.push(canvas.toDataURL('image/png'))
        infos.push({ width: viewport.width, height: viewport.height })
      }

      setPages(renderedPages)
      setPageInfos(infos)
      setLoading(false)
      setPreviewStatus('ready')
    } catch (err) {
      console.error('[PdfRenderer] render error:', err)
      setError('PDF 文件解析失败，文件可能已损坏或受密码保护')
    }
  }, [currentFile, setPreviewStatus, setError])

  useEffect(() => {
    renderPdf()
  }, [renderPdf])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-ink-400 text-sm">
        <svg className="w-6 h-6 animate-spin text-accent-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <span>正在渲染 PDF…</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto p-3 lg:p-4"
    >
      <div className="flex flex-col items-center gap-3">
        {pages.map((dataUrl, i) => (
          <img
            key={i}
            src={dataUrl}
            alt={`第 ${i + 1} 页`}
            className="shadow-soft rounded"
            style={{ width: `${zoomLevel}%`, maxWidth: 'none' }}
          />
        ))}
      </div>
    </div>
  )
}
