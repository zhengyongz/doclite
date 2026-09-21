import { useState, useEffect, useCallback } from 'react'
import JSZip from 'jszip'
import { useFileStore } from '../../context/FileContext'

// ---------- Slide nav icons ----------
function ChevronLeft({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  )
}

function ChevronRight({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

// EMU to pixel conversion (914400 EMU = 1 inch, 96 dpi)
const EMU = 914400
const emuToPx = (emu) => emu / EMU * 96

/**
 * Parse a .pptx file (ZIP archive of XML) in the browser using JSZip.
 * Extracts shapes with position/size/background/text and images,
 * renders them as absolutely-positioned elements on a 16:9 canvas.
 */
export default function PptxRenderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const [slides, setSlides] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentSlide, setCurrentSlide] = useState(0)

  const parsePptx = useCallback(async () => {
    if (!currentFile?.file) return
    try {
      setPreviewStatus('loading')
      setLoading(true)

      const arrayBuffer = await currentFile.file.arrayBuffer()
      const zip = await JSZip.loadAsync(arrayBuffer)

      // Get presentation dimensions from ppt/presentation.xml
      let slideWidth = 960  // default px (10in @ 96dpi)
      let slideHeight = 540  // default px (7.5in @ 96dpi)
      const presXml = await zip.file('ppt/presentation.xml')?.async('string')
      if (presXml) {
        const sizeMatch = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(presXml)
        if (sizeMatch) {
          slideWidth = emuToPx(parseInt(sizeMatch[1], 10))
          slideHeight = emuToPx(parseInt(sizeMatch[2], 10))
        }
      }

      const slideEntries = Object.keys(zip.files)
        .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((a, b) => {
          const na = parseInt(a.match(/slide(\d+)/)[1], 10)
          const nb = parseInt(b.match(/slide(\d+)/)[1], 10)
          return na - nb
        })

      const parsedSlides = []

      for (const slidePath of slideEntries) {
        const xmlStr = await zip.files[slidePath].async('string')

        // --- Parse shapes and pictures ---
        const shapes = []
        const allRIds = new Set()

        // Match <p:sp> (shapes) and <p:pic> (pictures)
        // Both have <p:spPr> with <p:off> and <p:ext> for position/size

        // Parse <p:pic> blocks (images)
        const picRegex = /<p:pic\b[\s\S]*?<\/p:pic>/g
        let picMatch
        while ((picMatch = picRegex.exec(xmlStr)) !== null) {
          const block = picMatch[0]
          const blipMatch = /r:embed="(rId\d+)"/.exec(block)
          const svgBlipMatch = /<a:svgBlip\s+r:embed="(rId\d+)"/.exec(block)
          const offMatch = /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/.exec(block)
          const extMatch = /<a:ext\s+cx="(-?\d+)"\s+cy="(-?\d+)"/.exec(block)

          const rId = blipMatch ? blipMatch[1] : (svgBlipMatch ? svgBlipMatch[1] : null)
          if (!rId) continue

          const x = offMatch ? emuToPx(parseInt(offMatch[1], 10)) : 0
          const y = offMatch ? emuToPx(parseInt(offMatch[2], 10)) : 0
          const cx = extMatch ? emuToPx(parseInt(extMatch[1], 10)) : 300
          const cy = extMatch ? emuToPx(parseInt(extMatch[2], 10)) : 200

          allRIds.add(rId)
          shapes.push({ type: 'image', rId, x, y, cx, cy, url: null })
        }

        // Parse <p:sp> blocks (text shapes with position/size/background)
        const spRegex = /<p:sp\b[\s\S]*?<\/p:sp>/g
        let spMatch
        while ((spMatch = spRegex.exec(xmlStr)) !== null) {
          const block = spMatch[0]
          const offMatch = /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/.exec(block)
          const extMatch = /<a:ext\s+cx="(-?\d+)"\s+cy="(-?\d+)"/.exec(block)

          // Skip if no position info (likely a group/note shape)
          if (!offMatch || !extMatch) continue

          const x = emuToPx(parseInt(offMatch[1], 10))
          const y = emuToPx(parseInt(offMatch[2], 10))
          const cx = emuToPx(parseInt(extMatch[1], 10))
          const cy = emuToPx(parseInt(extMatch[2], 10))

          // Extract text runs within this shape
          const texts = []
          const textRegex = /<a:t>(.*?)<\/a:t>/g
          let tm
          while ((tm = textRegex.exec(block)) !== null) {
            if (tm[1].trim()) texts.push(decodeXml(tm[1]))
          }

          // Extract background fill color from <p:spPr> only (not text fill)
          let bgFill = null
          const spPrMatch = /<p:spPr>([\s\S]*?)<\/p:spPr>/.exec(block)
          if (spPrMatch) {
            const fillMatch = /<a:solidFill>\s*<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(spPrMatch[1])
            if (fillMatch) bgFill = '#' + fillMatch[1]
          }

          // Extract text color from <a:rPr> → <a:solidFill> → <a:srgbClr>
          let textColor = null
          const textColorMatch = /<a:rPr[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(block)
          if (textColorMatch) textColor = '#' + textColorMatch[1]

          // Extract font size (in hundredths of a point)
          let fontSize = null
          const fontSizeMatch = /<a:rPr[^>]*sz="(\d+)"/.exec(block)
          if (fontSizeMatch) fontSize = parseInt(fontSizeMatch[1], 10) / 100

          // Detect if this is a title/placeholder (via <p:nvSpPr>/<p:nvPr>/<p:ph type="title"/>)
          const isTitle = /<p:ph\s+type="title"/.test(block)
          const isBody = /<p:ph\s+type="body"/.test(block) || (!isTitle && texts.length > 0)

          if (texts.length > 0 || bgFill) {
            shapes.push({ type: 'text', texts, x, y, cx, cy, bgFill, textColor, fontSize, isTitle, isBody })
          }
        }

        // Sort shapes by y position (top to bottom, then left to right)
        shapes.sort((a, b) => a.y - b.y || a.x - b.x)

        // Resolve image rIds via slide rels
        const relsPath = slidePath
          .replace('ppt/slides/', 'ppt/slides/_rels/')
          .replace('.xml', '.xml.rels')

        if (zip.files[relsPath]) {
          const relsXml = await zip.files[relsPath].async('string')
          for (const shape of shapes) {
            if (shape.type !== 'image' || !shape.rId) continue
            const relRegex = new RegExp(`Id="${shape.rId}"[^>]*Target="([^"]+)"`)
            const relMatch = relRegex.exec(relsXml)
            if (relMatch) {
              const target = relMatch[1]
              // Target is relative to ppt/slides/, e.g. "../media/image1.png"
              const fullPath = 'ppt/' + target.replace(/^\.\.\//, '')
              if (zip.files[fullPath]) {
                const blob = await zip.files[fullPath].async('blob')
                shape.url = URL.createObjectURL(blob)
              }
            }
          }
        }

        parsedSlides.push({ shapes, width: slideWidth, height: slideHeight })
      }

      setSlides(parsedSlides)
      setCurrentSlide(0)
      setLoading(false)
      setPreviewStatus('ready')
    } catch (err) {
      console.error('[PptxRenderer] parse error:', err)
      setError('PPT 文件解析失败，文件可能已损坏或格式不正确')
    }
  }, [currentFile, setPreviewStatus, setError])

  useEffect(() => {
    parsePptx()
    return () => {
      slides.forEach(s => s.shapes.forEach(sh => {
        if (sh.url) URL.revokeObjectURL(sh.url)
      }))
    }
  }, [parsePptx])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (slides.length === 0) return
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') setCurrentSlide(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setCurrentSlide(i => Math.min(slides.length - 1, i + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slides.length])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-ink-400 text-sm">
        <svg className="w-6 h-6 animate-spin text-accent-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        <span>正在解析 PPT…</span>
      </div>
    )
  }

  if (slides.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-ink-400 text-sm">
        未找到幻灯片内容
      </div>
    )
  }

  const slide = slides[currentSlide]
  const slideW = slide.width || 960
  const slideH = slide.height || 540

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-ink-100" style={{ zoom: zoomLevel / 100 }}>
        <div
          className="relative bg-white shadow-soft-lg rounded-lg overflow-hidden"
          style={{
            width: `min(${slideW}px, 100%)`,
            aspectRatio: `${slideW} / ${slideH}`,
          }}
        >
          {slide.shapes.map((shape, i) => {
            if (shape.type === 'image' && shape.url) {
              return (
                <img
                  key={i}
                  src={shape.url}
                  alt=""
                  className="absolute"
                  style={{
                    left: `${(shape.x / slideW) * 100}%`,
                    top: `${(shape.y / slideH) * 100}%`,
                    width: `${(shape.cx / slideW) * 100}%`,
                    height: `${(shape.cy / slideH) * 100}%`,
                    objectFit: 'contain',
                  }}
                />
              )
            }
            if (shape.type === 'text' && shape.texts.length > 0) {
              const fontSizePx = shape.fontSize
                ? `${Math.max(10, shape.fontSize * slideW / 960)}px`
                : shape.isTitle
                  ? `${24 * slideW / 960}px`
                  : `${16 * slideW / 960}px`
              return (
                <div
                  key={i}
                  className="absolute flex flex-col justify-center overflow-hidden"
                  style={{
                    left: `${(shape.x / slideW) * 100}%`,
                    top: `${(shape.y / slideH) * 100}%`,
                    width: `${(shape.cx / slideW) * 100}%`,
                    height: `${(shape.cy / slideH) * 100}%`,
                    background: shape.bgFill || 'transparent',
                    padding: '4px 8px',
                  }}
                >
                  {shape.texts.map((text, j) => (
                    <p
                      key={j}
                      className="leading-snug break-words m-0"
                      style={{
                        fontSize: fontSizePx,
                        fontWeight: shape.isTitle ? '700' : '400',
                        color: shape.textColor || (shape.isTitle ? '#1a1a1a' : '#333'),
                      }}
                    >
                      {text}
                    </p>
                  ))}
                </div>
              )
            }
            return null
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white border-t border-ink-100">
        <button
          onClick={() => setCurrentSlide(i => Math.max(0, i - 1))}
          disabled={currentSlide === 0}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-ink-600 hover:bg-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-ring"
        >
          <ChevronLeft className="w-4 h-4" />
          上一页
        </button>

        <span className="text-sm text-ink-500 font-mono tabular-nums">
          {currentSlide + 1} / {slides.length}
        </span>

        <button
          onClick={() => setCurrentSlide(i => Math.min(slides.length - 1, i + 1))}
          disabled={currentSlide === slides.length - 1}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-ink-600 hover:bg-ink-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-ring"
        >
          下一页
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ---------- Helpers ----------
function decodeXml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}
