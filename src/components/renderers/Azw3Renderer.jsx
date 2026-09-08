import { useState, useEffect, useCallback, useRef } from 'react'
import { useFileStore } from '../../context/FileContext'

/**
 * Azw3Renderer — AZW3 / MOBI 电子书预览渲染器
 *
 * 使用 foliate-js 的 MOBI 类解析 PDB/MOBI/KF8 格式，
 * 逐 section 提取 HTML 内容，渲染到滚动容器中。
 * 支持目录跳转、封面显示、元数据展示。
 */
export default function Azw3Renderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [bookData, setBookData] = useState(null) // { sections, toc, metadata, coverUrl }
  const [currentSection, setCurrentSection] = useState(0)
  const [sectionContents, setSectionContents] = useState({}) // { index: HTML string }
  const [showToc, setShowToc] = useState(false)

  const containerRef = useRef(null)
  const bookRef = useRef(null)

  // 加载并解析电子书
  const loadBook = useCallback(async () => {
    if (!currentFile?.file) return
    try {
      setPreviewStatus('loading')
      setStatus('loading')
      setSectionContents({})

      // 动态导入 foliate-js
      const { MOBI } = await import('foliate-js/mobi.js')
      const fflate = await import('foliate-js/vendor/fflate.js')

      const file = currentFile.file
      const book = await new MOBI({ unzlib: fflate.unzlibSync }).open(file)
      bookRef.current = book

      // 获取封面
      let coverUrl = null
      try {
        const coverBlob = await book.getCover()
        if (coverBlob) coverUrl = URL.createObjectURL(coverBlob)
      } catch (e) {
        console.warn('[Azw3Renderer] getCover failed:', e)
      }

      setBookData({
        sections: book.sections || [],
        toc: book.toc || [],
        metadata: book.metadata || {},
        coverUrl,
      })
      setStatus('ready')
      setPreviewStatus('ready')
    } catch (err) {
      console.error('[Azw3Renderer] load error:', err)
      setStatus('error')
      setError('电子书解析失败，文件可能已损坏或格式不正确')
    }
  }, [currentFile, setPreviewStatus, setError])

  // 渲染指定 section 的 HTML 内容
  const renderSection = useCallback(async (index) => {
    if (sectionContents[index] !== undefined) return

    const book = bookRef.current
    if (!book || !book.sections[index]) return

    try {
      const section = book.sections[index]
      if (!section.load && !section.createDocument) return

      let html
      // 优先使用 load()：它会替换 kindle:flow 等内部资源链接为 blob URL
      if (section.load) {
        const url = await section.load()
        const res = await fetch(url)
        html = await res.text()
        URL.revokeObjectURL(url)
      } else if (section.createDocument) {
        const doc = await section.createDocument()
        const serializer = new XMLSerializer()
        html = serializer.serializeToString(doc)
      }

      setSectionContents(prev => ({ ...prev, [index]: html }))
    } catch (err) {
      console.error(`[Azw3Renderer] section ${index} render error:`, err)
      setSectionContents(prev => ({ ...prev, [index]: '<p style="color:#999;text-align:center;padding:20px;">本章节渲染失败</p>' }))
    }
  }, [sectionContents])

  // 初始加载
  useEffect(() => {
    loadBook()
  }, [loadBook])

  // 当前 section 变化时渲染
  useEffect(() => {
    if (status === 'ready' && bookData && bookData.sections[currentSection]) {
      renderSection(currentSection)
    }
  }, [status, bookData, currentSection, renderSection])

  // 预渲染前后章节
  useEffect(() => {
    if (status !== 'ready' || !bookData) return
    // 预渲染下一章节
    if (currentSection + 1 < bookData.sections.length) {
      renderSection(currentSection + 1)
    }
  }, [status, bookData, currentSection, renderSection])

  // 清理
  useEffect(() => {
    return () => {
      if (bookData?.coverUrl) URL.revokeObjectURL(bookData.coverUrl)
      bookRef.current = null
    }
  }, [])

  // ---- 加载中 ----
  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-ink-400 text-sm">
        <svg className="w-6 h-6 animate-spin text-accent-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <span>正在解析电子书…</span>
      </div>
    )
  }

  // ---- 加载失败 ----
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
        <p className="text-sm font-medium text-red-500">解析失败</p>
        <p className="text-xs text-ink-400">请检查文件是否为有效的 AZW3/MOBI 格式</p>
      </div>
    )
  }

  if (!bookData) return null

  const { sections, toc, metadata, coverUrl } = bookData
  const scale = zoomLevel / 100
  const totalSections = sections.length
  const linearSections = sections.filter(s => s.linear !== 'no')

  // TOC 递归渲染
  const renderTocItem = (item, depth = 0) => {
    if (!item) return null
    return (
      <div key={item.href}>
        <button
          onClick={() => {
            if (item.href) {
              // href 格式: "kindle:pos:fid:xxx:off:yyy" 或 index
              // 找到对应的 section index
              const sectionIdx = sections.findIndex((s, i) => {
                if (s.id !== undefined) return false // 需要更精确的匹配
                return false
              })
              // 简化处理：TOC href 中可能包含 section index
              // 对 KF8，href 是 pos URI，需要 resolveHref
              // 这里先尝试解析为数字
              const idx = parseInt(item.href, 10)
              if (!isNaN(idx) && idx >= 0 && idx < totalSections) {
                setCurrentSection(idx)
                setShowToc(false)
                if (containerRef.current) containerRef.current.scrollTop = 0
              } else {
                // 尝试用 book.resolveHref
                bookRef.current?.resolveHref?.(item.href).then(result => {
                  if (result && result.index >= 0) {
                    setCurrentSection(result.index)
                    setShowToc(false)
                    if (containerRef.current) containerRef.current.scrollTop = 0
                  }
                }).catch(() => {})
              }
            }
          }}
          className="block w-full text-left px-3 py-1.5 text-sm text-ink-600 hover:bg-accent-50 hover:text-accent-700 rounded-md transition-colors truncate"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          {item.label || '未命名章节'}
        </button>
        {item.subitems?.map(child => renderTocItem(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* 侧边目录栏 */}
      {showToc && (
        <div className="w-64 shrink-0 border-r border-ink-200 bg-white overflow-y-auto p-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-ink-400 uppercase tracking-wider">目录</p>
            <button
              onClick={() => setShowToc(false)}
              className="text-ink-400 hover:text-ink-600"
              aria-label="关闭目录"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          {toc.length > 0 ? (
            <div className="space-y-0.5">
              {toc.map(item => renderTocItem(item))}
            </div>
          ) : (
            <p className="text-xs text-ink-400 text-center py-4">无目录信息</p>
          )}
        </div>
      )}

      {/* 主阅读区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部工具栏 */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-ink-200 bg-white shrink-0">
          <button
            onClick={() => setShowToc(!showToc)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 rounded-md transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            目录
          </button>
          <div className="flex-1 text-center">
            <span className="text-xs text-ink-400">
              {currentSection + 1} / {totalSections} 章
            </span>
          </div>
          <button
            onClick={() => {
              if (currentSection > 0) {
                setCurrentSection(currentSection - 1)
                if (containerRef.current) containerRef.current.scrollTop = 0
              }
            }}
            disabled={currentSection === 0}
            className="px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            上一章
          </button>
          <button
            onClick={() => {
              if (currentSection < totalSections - 1) {
                setCurrentSection(currentSection + 1)
                if (containerRef.current) containerRef.current.scrollTop = 0
              }
            }}
            disabled={currentSection >= totalSections - 1}
            className="px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            下一章
          </button>
        </div>

        {/* 内容区域 */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-ink-50"
        >
          <div
            className="mx-auto bg-white shadow-soft rounded-lg min-h-full"
            style={{
              maxWidth: '820px',
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
              padding: '40px 60px',
              minHeight: '500px',
            }}
          >
            {/* 封面 + 元数据（仅在第一章时显示） */}
            {currentSection === 0 && (coverUrl || metadata?.title) && (
              <div className="mb-8 text-center">
                {coverUrl && (
                  <img
                    src={coverUrl}
                    alt="封面"
                    className="mx-auto rounded-lg shadow-soft mb-4"
                    style={{ maxHeight: '400px', maxWidth: '100%', objectFit: 'contain' }}
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                )}
                {metadata?.title && (
                  <h1 className="text-xl font-bold text-ink-800 mb-2">{metadata.title}</h1>
                )}
                {metadata?.author && (
                  <p className="text-sm text-ink-400 mb-1">{metadata.author}</p>
                )}
                {metadata?.description && (
                  <p className="text-xs text-ink-400 mt-2 leading-relaxed max-w-md mx-auto">{metadata.description}</p>
                )}
              </div>
            )}

            {/* Section HTML 内容 */}
            {sectionContents[currentSection] !== undefined ? (
              <div
                className="ebook-content"
                dangerouslySetInnerHTML={{ __html: sectionContents[currentSection] }}
              />
            ) : (
              <div className="flex items-center justify-center py-12 text-ink-400 text-sm">
                <svg className="w-5 h-5 mr-2 animate-spin text-accent-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                正在加载章节内容…
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
