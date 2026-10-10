import { useState, useEffect, useCallback, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useFileStore } from '../../context/FileContext'

// 字符数硬上限（约 2M 字符）：防扩展名伪装的超大文本拖垮主线程
// 超限时仅渲染前 200K 字符并给出提示条（workbuddy M1）
const HARD_LIMIT = 2_000_000
const TRUNCATE_TO = 200_000

// marked v5 起不再自动生成 heading id，此处零依赖注入（workbuddy L4）
// id 生成规则：小写、剔除非常规字符（保留 Unicode 字母/数字/-/_）、空白折叠为 -
let headingSeq = 0
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      const plain = tokens.map((t) => t.raw || '').join('')
      let id = plain.replace(/^#+\s*/, '').trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s+/g, '-')
      if (!id) id = `heading-${++headingSeq}`
      return `<h${depth} id="${id}">${text}</h${depth}>`
    },
  },
})

export default function MdRenderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [html, setHtml] = useState('')
  const [notices, setNotices] = useState([]) // 文档顶部提示条（编码/截断）
  const seqRef = useRef(0) // 渲染竞态守卫（workbuddy M4）：仅接受最新一次请求的结果
  const bodyRef = useRef(null)

  const renderDoc = useCallback(async () => {
    if (!currentFile?.file) return
    // 每次渲染递增序号；异步过程中被更新的请求取代时，本次结果直接丢弃
    const seq = ++seqRef.current
    try {
      setPreviewStatus('loading')
      setStatus('loading')
      setNotices([])

      // 显式 UTF-8 解码：file.text() 对非法字节静默替换为 U+FFFD，永不抛错（workbuddy M2）
      const buf = await currentFile.file.arrayBuffer()
      let text = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '')

      // 编码检测：替换字符占比过高时提示疑似非 UTF-8（仍渲染，顶部提示条引导）
      const bad = (text.match(/\uFFFD/g) || []).length
      if (bad > 0 && bad / text.length > 0.001) {
        setNotices((n) => [...n, '检测到疑似非 UTF-8 编码，部分内容可能显示为乱码，建议以 UTF-8 保存后重新打开'])
      }

      // 超大文本降级：截断预览，避免主线程长时间阻塞（workbuddy M1）
      if (text.length > HARD_LIMIT) {
        text = text.slice(0, TRUNCATE_TO)
        setNotices((n) => [...n, `文档过大（超过 ${HARD_LIMIT.toLocaleString()} 字符），已截断仅预览前 ${TRUNCATE_TO.toLocaleString()} 字符`])
      }

      // marked 解析（GFM：表格/删除线/任务列表）→ DOMPurify 消毒（L6：禁内联 style 防视觉覆盖伪造 UI）
      const rawHtml = marked.parse(text, { gfm: true, breaks: false })
      const cleanHtml = DOMPurify.sanitize(rawHtml, { FORBID_ATTR: ['style'] })

      if (seq !== seqRef.current) return // 已被后续请求取代，丢弃本次结果

      setHtml(cleanHtml)
      setStatus('ready')
      setPreviewStatus('ready')
    } catch (err) {
      console.error('[MdRenderer] render error:', err)
      if (seq !== seqRef.current) return
      setStatus('error')
      setError('Markdown 解析失败，文件可能已损坏')
    }
  }, [currentFile, setPreviewStatus, setError])

  useEffect(() => {
    renderDoc()
  }, [renderDoc])

  // 链接事件代理（workbuddy M3/L4）：http(s) 交系统浏览器打开（主进程白名单校验）；
  // #锚点 在文档容器内平滑滚动。CSP 与 will-navigate 保证无其他外联途径。
  const onBodyClick = useCallback((e) => {
    const a = e.target.closest?.('a[href]')
    if (!a) return
    const href = a.getAttribute('href') || ''
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault()
      window.doclite?.openExternal?.(href)
    } else if (href.startsWith('#')) {
      e.preventDefault()
      let id = href.slice(1)
      let el = document.getElementById(id)
      if (!el) {
        try { el = document.getElementById(decodeURIComponent(id)) } catch { /* 编码不一致时忽略 */ }
      }
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  return (
    <div className="h-full overflow-auto p-4 lg:p-6" style={{ zoom: zoomLevel / 100 }}>
      <div
        className="mx-auto bg-white shadow-soft rounded-lg min-w-[200px] px-8 py-6"
        style={{ maxWidth: '820px', minHeight: '400px' }}
      >
        {status === 'ready' && notices.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {notices.map((n) => (
              <div key={n} className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs leading-relaxed">
                {n}
              </div>
            ))}
          </div>
        )}
        {status === 'ready' && (
          <div
            ref={bodyRef}
            className="md-body"
            onClick={onBodyClick}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
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
    </div>
  )
}