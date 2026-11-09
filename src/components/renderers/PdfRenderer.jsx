import { useState, useEffect, useCallback, useRef } from 'react'
import { useFileStore } from '../../context/FileContext'
import { useI18n } from '../../i18n'

// Configure pdf.js worker (Vite handles the URL import)
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// 设备像素比（Retina / 系统缩放）：决定渲染缓冲的最小物理分辨率。
// 实测 Linux 系统缩放 200% 时 devicePixelRatio=2，若按 1.0 渲染再被屏幕放大
// 必然发虚（B-024，2026-11-09 补充：Linux/macOS 同现，Windows 亦然——与 dpr 无关，
// 只要"缩放用 CSS transform 拉伸固定 canvas"就会糊，必须按缩放重新渲染）。
const DPR = Math.min(2, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1))
// 渲染倍率上限：canvas 缓冲像素 = 页面基础尺寸 × renderScale。
// renderScale = min(MAX, max(1, DPR × 当前缩放))——保证任意缩放下缓冲≥显示像素（不糊），
// 上限封顶避免极端缩放（200%×dpr2=4）把内存打爆（本机 7.6G）。
const MAX_RENDER_SCALE = 3
// 虚拟滚动：视口外上下各多渲染几页作为缓冲
const BUFFER_PAGES = 1
// 页面上下间距
const GAP = 12

export default function PdfRenderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const { t } = useI18n()
  const [numPages, setNumPages] = useState(0)
  const [pageHeights, setPageHeights] = useState([]) // 每页基础高度(scale=1)，占位/滚动用
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 })
  const [renderedPages, setRenderedPages] = useState({}) // { pageNum: canvas }
  const [loading, setLoading] = useState(true)

  const pdfDocRef = useRef(null)
  const containerRef = useRef(null)
  const renderingRef = useRef(new Set()) // 正在渲染中的页码，防止重复
  const pageWidthRef = useRef(0) // 页面基础宽(scale=1, CSS px)
  const renderedRef = useRef({}) // 镜像 renderedPages，供 zoom 清理时拿全部 canvas
  renderedRef.current = renderedPages
  // 当前缩放与对应渲染倍率（供渲染/滚动/清理读取，避免把 zoom 加进每个 useCallback 依赖）
  const zoomRef = useRef(1)
  const scaleRef = useRef(DPR)
  zoomRef.current = Math.max(0.5, Math.min(2, zoomLevel / 100))
  scaleRef.current = Math.min(MAX_RENDER_SCALE, Math.max(1, DPR * zoomRef.current))

  // 1. 加载 PDF，取每页基础尺寸（scale=1，不渲染）
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

      // 布局基准（CSS 像素）用 scale=1 的 viewport，与 canvas 缓冲分辨率解耦：
      // 显示宽度 = baseW × 缩放，缓冲 = baseW × scaleRef（≈ baseW×dpr×缩放）
      const firstPage = await pdfDoc.getPage(1)
      const firstViewport = firstPage.getViewport({ scale: 1 })
      pageWidthRef.current = firstViewport.width
      const heights = new Array(pdfDoc.numPages).fill(firstViewport.height)
      setPageHeights(heights)
      setLoading(false)
      setPreviewStatus('ready')
    } catch (err) {
      console.error('[PdfRenderer] load error:', err)
      setError(t('err.pdf.parse'))
    }
  }, [currentFile, setPreviewStatus, setError])

  // 2. 滚动时计算可见页范围（占位高度 = 基础高 × 缩放）
  const handleScroll = useCallback(() => {
    if (!containerRef.current || pageHeights.length === 0) return
    const container = containerRef.current
    const scrollTop = container.scrollTop
    const viewportHeight = container.clientHeight
    const z = zoomRef.current

    let cumulative = 0
    let startPage = 0
    let endPage = 0
    for (let i = 0; i < pageHeights.length; i++) {
      const pageH = pageHeights[i] * z + GAP
      if (cumulative + pageH < scrollTop) startPage = i + 1
      if (cumulative < scrollTop + viewportHeight) endPage = i
      cumulative += pageH
    }
    const start = Math.max(0, startPage - BUFFER_PAGES)
    const end = Math.min(pageHeights.length - 1, endPage + BUFFER_PAGES)
    if (start !== visibleRange.start || end !== visibleRange.end) {
      setVisibleRange({ start, end })
    }
  }, [pageHeights, visibleRange])

  // 3. 渲染单页到 canvas（按当前缩放的缓冲分辨率，不转 base64）
  const renderPage = useCallback(async (pageNum) => {
    const pdfDoc = pdfDocRef.current
    if (!pdfDoc || renderingRef.current.has(pageNum)) return
    renderingRef.current.add(pageNum)
    try {
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale: scaleRef.current })
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { alpha: false })
      canvas.width = viewport.width
      canvas.height = viewport.height
      // 显示宽度 = 基础宽 × 缩放；缓冲 = 基础宽 × scaleRef（≈ 显示×dpr）→ 不糊
      canvas.style.width = `${pageWidthRef.current * zoomRef.current}px`
      canvas.style.height = 'auto'
      await page.render({ canvasContext: ctx, viewport }).promise
      setRenderedPages(prev => ({ ...prev, [pageNum]: canvas }))
    } catch (err) {
      console.error(`[PdfRenderer] page ${pageNum} render error:`, err)
    } finally {
      renderingRef.current.delete(pageNum)
    }
  }, [])

  // 4. visibleRange 变化时渲染可见页 + 清理超上限 canvas
  useEffect(() => {
    if (loading || numPages === 0) return
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      const pageNum = i + 1
      if (!renderedPages[pageNum]) renderPage(pageNum)
    }
    const maxPages = scaleRef.current > 1.5 ? 8 : scaleRef.current > 1 ? 12 : 20
    setRenderedPages(prev => {
      const keys = Object.keys(prev).map(Number).sort((a, b) => a - b)
      if (keys.length <= maxPages) return prev
      const toRemove = keys.slice(0, keys.length - maxPages)
      const next = { ...prev }
      for (const k of toRemove) {
        const canvas = next[k]
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
        delete next[k]
      }
      return next
    })
  }, [visibleRange, loading, numPages, renderedPages, renderPage])

  // 5. 初始加载
  useEffect(() => {
    loadPdf()
  }, [loadPdf])

  // 6. 加载完成 → 初始可见范围
  useEffect(() => {
    if (!loading && numPages > 0 && visibleRange.end === 0) handleScroll()
  }, [loading, numPages, visibleRange, handleScroll])

  // 7. 缩放变化：按比例保持滚动位置 → 清空缓存 → 用新缓冲分辨率重渲可见页。
  //    关键：不能像旧版用 CSS transform 拉伸固定 canvas（>100% 必糊，Linux/macOS/Windows
  //    全平台同现），必须按缩放重新渲染，见 B-024/STATE D-039。
  useEffect(() => {
    if (loading || numPages === 0) return
    const el = containerRef.current
    if (el) {
      const oldZ = zoomRef.current
      zoomRef.current = Math.max(0.5, Math.min(2, zoomLevel / 100))
      scaleRef.current = Math.min(MAX_RENDER_SCALE, Math.max(1, DPR * zoomRef.current))
      if (el.scrollTop > 0) el.scrollTop = el.scrollTop * (zoomRef.current / oldZ)
    }
    // 从 DOM 移除旧 canvas，并清空缓存强制以新 scale 重渲染
    for (const c of Object.values(renderedRef.current)) {
      if (c && c.parentNode) c.parentNode.removeChild(c)
    }
    setRenderedPages({})
  }, [zoomLevel, loading, numPages])

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
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>{t('renderer.pdf.loading')}</span>
      </div>
    )
  }

  const z = zoomRef.current
  const totalHeight = pageHeights.reduce((s, h) => s + h * z + GAP, 0)

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
            return (
              <div
                key={i}
                style={{ height: pageHeights[i] * z, width: '100%', display: 'flex', justifyContent: 'center' }}
              >
                {inVisibleRange && canvas ? (
                  <div
                    ref={el => {
                      if (el && canvas && !el.firstChild) el.appendChild(canvas)
                    }}
                    className="shadow-soft rounded"
                    style={{ width: pageWidthRef.current * z, maxWidth: '100%' }}
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