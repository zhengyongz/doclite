import { useState, useEffect, useCallback, useRef } from 'react'
import { useFileStore } from '../../context/FileContext'
import { useI18n } from '../../i18n'

// Configure pdf.js worker (Vite handles the URL import)
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// 渲染倍率上限：canvas 缓冲像素 = 页面基础尺寸 × renderScale，
// renderScale = min(MAX, max(1, dpr × 当前缩放))。
// 关键背景（B-024）：实测 Linux 系统缩放 200% 时 devicePixelRatio=2——任何平台只要
// 「缩放 >100% 用 CSS transform 拉伸固定 canvas」就必糊，必须按缩放重采样。
// 封顶 3 是内存取舍（本机 7.6G）：dpr=2 时 ≤150% 保证「缓冲 = 物理像素」完全不糊；
// 更高倍率（dpr2×200%=4 → 压到 3）缓冲回落至显示像素的 0.75——不封顶则 8 页 × 32MB
// ≈ 256MB 峰值内存 + 更慢的纹理上传。取舍记录见 STATE D-039 / R-110。
const MAX_RENDER_SCALE = 3
// 虚拟滚动：视口外上下各多渲染几页作为缓冲
const BUFFER_PAGES = 1
// 页面上下间距（与 flex gap-3 = 12px 一致）
const GAP = 12

// dpr 夹取：系统缩放 <100% 按 1 处理，>2 封顶（更高收益递减、内存翻倍）
const clampDpr = (v) => Math.min(2, Math.max(1, v || 1))

export default function PdfRenderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const { t } = useI18n()
  const [numPages, setNumPages] = useState(0)
  const [pageHeights, setPageHeights] = useState([]) // 每页基础高度(scale=1)，占位/滚动用
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 })
  const [renderedPages, setRenderedPages] = useState({}) // { pageNum: canvas }
  const [loading, setLoading] = useState(true)
  // dpr 响应换屏/系统缩放变更（R-111）：旧实现模块加载时读一次，Retina↔外接屏切换后
  // 清晰度修复失效；改用 state + matchMedia 监听
  const [dpr, setDpr] = useState(() => clampDpr(typeof window !== 'undefined' ? window.devicePixelRatio : 1))

  // 渲染期只做纯派生（R-109 教训：渲染期写 ref 会让「按真实旧值补偿滚动」拿到新值，
  // oldZ === newZ、补偿恒为空操作）。ref 统一在下方 applyRef effect 里写。
  const z = Math.min(2, Math.max(0.5, zoomLevel / 100))
  const targetScale = Math.min(MAX_RENDER_SCALE, Math.max(1, dpr * z))

  const pdfDocRef = useRef(null)
  const containerRef = useRef(null)
  const renderingRef = useRef(new Set()) // 正在渲染中的页码，防止重复
  const pageWidthRef = useRef(0) // 页面基础宽(scale=1, CSS px)
  const renderedRef = useRef({}) // 镜像 renderedPages，供缩放清理时拿全部 canvas
  renderedRef.current = renderedPages
  // 渲染代际（R-108）：缩放/换文件换代。在途的旧渲染完成后提交时会核对代际，过期即丢弃——
  // 否则旧倍率 canvas 会回填缓存，该页永远不再重渲（用户侧表现为那一页又小又糊且不自愈）
  const genRef = useRef(0)
  const zoomRef = useRef(1)
  const scaleRef = useRef(1)
  const appliedRef = useRef(null) // 上次已应用的 { z, scale }

  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    const onChange = () => setDpr(clampDpr(window.devicePixelRatio))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dpr])

  // 1. 加载 PDF，取每页基础尺寸（scale=1，不渲染）
  const loadPdf = useCallback(async () => {
    if (!currentFile?.file) return
    const gen = ++genRef.current // 换文件即换代：旧文档的在途渲染全部作废
    try {
      setPreviewStatus('loading')
      setLoading(true)
      renderingRef.current.clear()
      pdfDocRef.current?.destroy?.() // R-116：换文件销毁旧文档（释放 worker 与内存）
      pdfDocRef.current = null
      setRenderedPages({})
      setVisibleRange({ start: 0, end: 0 })

      const arrayBuffer = await currentFile.file.arrayBuffer()
      if (gen !== genRef.current) return // 期间又切换了文件（连续快速切换）
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      if (gen !== genRef.current) {
        pdfDoc.destroy()
        return
      }
      pdfDocRef.current = pdfDoc
      setNumPages(pdfDoc.numPages)

      // 布局基准（CSS 像素）用 scale=1 的 viewport，与 canvas 缓冲分辨率解耦：
      // 显示宽度 = baseW × 缩放，缓冲 = baseW × scale（≈ baseW × dpr × 缩放）
      const firstPage = await pdfDoc.getPage(1)
      if (gen !== genRef.current) return
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

  // 3. 渲染单页到 canvas（发起时锁定量，提交前核对代际——R-108）
  const renderPage = useCallback(async (pageNum) => {
    const pdfDoc = pdfDocRef.current
    if (!pdfDoc || renderingRef.current.has(pageNum)) return
    const gen = genRef.current
    const scale = scaleRef.current
    const zoom = zoomRef.current
    const baseW = pageWidthRef.current
    if (!baseW) return
    renderingRef.current.add(pageNum)
    try {
      const page = await pdfDoc.getPage(pageNum)
      if (gen !== genRef.current) return // 已换代（缩放/换文件）：结果过期，丢弃
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { alpha: false })
      canvas.width = viewport.width
      canvas.height = viewport.height
      // renderKey 兜底：visibleRange effect 据此识别混入缓存的旧倍率画布并强制重渲
      canvas.dataset.renderKey = `${scale}|${zoom}`
      // 显示宽度 = 基础宽 × 缩放；maxWidth 兜底窄窗收缩（R-114），不横向溢出
      canvas.style.width = `${baseW * zoom}px`
      canvas.style.maxWidth = '100%'
      canvas.style.height = 'auto'
      await page.render({ canvasContext: ctx, viewport }).promise
      if (gen !== genRef.current) return // 渲染期间换代：丢弃
      setRenderedPages(prev => (gen !== genRef.current ? prev : { ...prev, [pageNum]: canvas }))
    } catch (err) {
      // 换代后的 destroy/中断属主动作废，不计错误日志
      if (gen === genRef.current) console.error(`[PdfRenderer] page ${pageNum} render error:`, err)
    } finally {
      renderingRef.current.delete(pageNum)
    }
  }, [])

  // 4. visibleRange 变化时渲染可见页 + 清理超上限 canvas
  useEffect(() => {
    if (loading || numPages === 0) return
    const wantKey = `${scaleRef.current}|${zoomRef.current}`
    for (let i = visibleRange.start; i <= visibleRange.end; i++) {
      const pageNum = i + 1
      const c = renderedPages[pageNum]
      // renderKey 兜底（R-108 防御纵深）：旧倍率 canvas 一律重渲
      if (!c || (c.dataset ? c.dataset.renderKey : null) !== wantKey) renderPage(pageNum)
    }
    // 驻留上限按倍率递减；驱逐「离可见范围最远」优先（R-117：按页号最小优先会在
    // 向上滚动时恰好先删即将进入视口的页，小驻留上限下来回重渲）
    const maxPages = scaleRef.current > 1.5 ? 8 : scaleRef.current > 1 ? 12 : 20
    setRenderedPages(prev => {
      const keys = Object.keys(prev).map(Number)
      if (keys.length <= maxPages) return prev
      const mid = (visibleRange.start + visibleRange.end) / 2 // 0-based 页索引中心
      keys.sort((a, b) => Math.abs((a - 1) - mid) - Math.abs((b - 1) - mid))
      const toRemove = keys.slice(maxPages) // 排序尾部 = 距可见区最远
      const next = { ...prev }
      for (const k of toRemove) {
        const canvas = next[k]
        if (canvas) {
          canvas.width = 0 // 立即释放画布后端内存
          canvas.height = 0
          if (canvas.parentNode) canvas.parentNode.removeChild(canvas)
        }
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

  // 7. 缩放/dpr 变化：先按真实旧值补偿滚动位置（R-109），再换代作废在途渲染（R-108），
  //    清缓存并用新缓冲分辨率重渲可见页。不能用 CSS transform 拉伸固定 canvas（B-024）。
  useEffect(() => {
    const prev = appliedRef.current
    if (!prev) {
      // 首次：只初始化，无旧画布可清
      appliedRef.current = { z, scale: targetScale }
      zoomRef.current = z
      scaleRef.current = targetScale
      return
    }
    if (prev.z === z && prev.scale === targetScale) return
    const el = containerRef.current
    if (el && el.scrollTop > 0 && prev.z !== z) {
      el.scrollTop = el.scrollTop * (z / prev.z) // 用 appliedRef 里的真实旧值
    }
    zoomRef.current = z
    scaleRef.current = targetScale
    appliedRef.current = { z, scale: targetScale }
    genRef.current++ // 旧代渲染全部作废：在途结果提交时一律丢弃（R-108）
    renderingRef.current.clear()
    for (const c of Object.values(renderedRef.current)) {
      if (!c) continue
      c.width = 0
      c.height = 0
      if (c.parentNode) c.parentNode.removeChild(c)
    }
    setRenderedPages({})
  }, [z, targetScale])

  // 清理：销毁 pdf.js 文档（释放 worker 与内存，R-116）
  useEffect(() => {
    return () => {
      pdfDocRef.current?.destroy?.()
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

  const totalHeight = pageHeights.reduce((s, h) => s + h * z + GAP, 0)

  return (
    <div
      ref={containerRef}
      data-pdf-scroll
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
                    data-pdf-page={pageNum}
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
