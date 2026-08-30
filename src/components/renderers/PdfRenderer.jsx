import { useState, useEffect, useCallback, useRef } from 'react'
import { useFileStore } from '../../context/FileContext'

// Configure pdf.js worker (Vite handles the URL import)
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// 渲染比例：首次打开用 1.0（而非原来的 1.5），减少约 55% 像素量
const RENDER_SCALE = 1.0
// 虚拟滚动：视口外上下各多渲染几页作为缓冲
const BUFFER_PAGES = 1

export default function PdfRenderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const [numPages, setNumPages] = useState(0)
  const [pageHeights, setPageHeights] = useState([]) // 每页高度(px)用于占位
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 })
  const [renderedPages, setRenderedPages] = useState({}) // { pageNum: canvas }
  const [loading, setLoading] = useState(true)

  const pdfDocRef = useRef(null)
  const containerRef = useRef(null)
  const renderingRef = useRef(new Set())  // 正在渲染中的页码，防止重复
  const pageWidthRef = useRef(0)

  // 1. 加载 PDF 文档，获取页数和每页尺寸（不做渲染）
  const loadPdf = useCallback(async () => {
    if (!currentFile?.file) return
    try {
      setPreviewStatus('loading')
      setLoading(true)
      setRenderedPages({})
      renderingRef.current.clear()

      const arrayBuffer = await currentFile.file.arrayBuffer()
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      pdfDocRef.current = pdfDoc
      setNumPages(pdfDoc.numPages)

      // 获取每页高度（只用第 1 页确定宽度，各页高度可能不同）
      const heights = []
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i)
        const viewport = page.getViewport({ scale: RENDER_SCALE })
        heights.push(viewport.height)
        if (i === 1) pageWidthRef.current = viewport.width
      }
      setPageHeights(heights)
      setLoading(false)
      setPreviewStatus('ready')
    } catch (err) {
      console.error('[PdfRenderer] load error:', err)
      setError('PDF 文件解析失败，文件可能已损坏或受密码保护')
    }
  }, [currentFile, setPreviewStatus, setError])

  // 2. 滚动时计算可见区域，只渲染可见页 ± 缓冲页
  const handleScroll = useCallback(() => {
    if (!containerRef.current || pageHeights.length === 0) return

    const container = containerRef.current
    const scrollTop = container.scrollTop
    const viewportHeight = container.clientHeight

    // 根据累计高度定位当前可视页面范围
    let cumulative = 0
    let startPage = 0
    let endPage = 0

    for (let i = 0; i < pageHeights.length; i++) {
      const pageH = pageHeights[i] + 12 // 12px gap
      if (cumulative + pageH < scrollTop) {
        startPage = i + 1
      }
      if (cumulative < scrollTop + viewportHeight) {
        endPage = i
      }
      cumulative += pageH
    }

    // 加上缓冲页
    const start = Math.max(0, startPage - BUFFER_PAGES)
    const end = Math.min(pageHeights.length - 1, endPage + BUFFER_PAGES)

    if (start !== visibleRange.start || end !== visibleRange.end) {
      setVisibleRange({ start, end })
    }
  }, [pageHeights, visibleRange])

  // 3. 渲染单页到 canvas（直接用 canvas 元素，不转 base64）
  const renderPage = useCallback(async (pageNum) => {
    const pdfDoc = pdfDocRef.current
    if (!pdfDoc || renderingRef.current.has(pageNum)) return
    renderingRef.current.add(pageNum)

    try {
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { alpha: false })
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = '100%'
      canvas.style.height = 'auto'

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise

      setRenderedPages(prev => ({ ...prev, [pageNum]: canvas }))
    } catch (err) {
      console.error(`[PdfRenderer] page ${pageNum} render error:`, err)
    } finally {
      renderingRef.current.delete(pageNum)
    }
  }, [])

  // 4. visibleRange 变化时触发渲染
  useEffect(() => {
    if (loading || numPages === 0) return
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      const pageNum = i + 1 // pdfjs 页码从 1 开始
      if (!renderedPages[pageNum]) {
        renderPage(pageNum)
      }
    }
  }, [visibleRange, loading, numPages, renderedPages, renderPage])

  // 5. 初始加载
  useEffect(() => {
    loadPdf()
  }, [loadPdf])

  // 6. 加载完成后初始化可见范围（触发首屏渲染）
  useEffect(() => {
    if (!loading && numPages > 0 && visibleRange.end === 0) {
      handleScroll()
    }
  }, [loading, numPages, visibleRange, handleScroll])

  // 清理
  useEffect(() => {
    return () => {
      pdfDocRef.current = null
      renderingRef.current.clear()
    }
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-ink-400 text-sm">
        <svg className="w-6 h-6 animate-spin text-accent-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <span>正在加载 PDF…</span>
      </div>
    )
  }

  // 计算总高度用于占位（虚拟滚动）
  const totalHeight = pageHeights.reduce((sum, h) => sum + h + 12, 0)
  // CSS transform 缩放（不重新渲染 canvas）
  const scale = zoomLevel / 100

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-auto p-3 lg:p-4"
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="flex flex-col items-center gap-3" style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          {Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1
            const inVisibleRange = i >= visibleRange.start && i <= visibleRange.end
            const canvas = renderedPages[pageNum]
            const pageH = pageHeights[i] || 0

            return (
              <div
                key={i}
                style={{
                  height: pageH,
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'center',
                  transform: `scale(${scale})`,
                  transformOrigin: 'top center',
                }}
              >
                {inVisibleRange && canvas ? (
                  <div
                    ref={el => {
                      if (el && canvas && !el.firstChild) {
                        el.appendChild(canvas)
                      }
                    }}
                    className="shadow-soft rounded"
                    style={{ width: pageWidthRef.current, maxWidth: '100%' }}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}