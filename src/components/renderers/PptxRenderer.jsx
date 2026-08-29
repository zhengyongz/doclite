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

/**
 * Parse a .pptx file (which is a ZIP archive of XML files) in the browser
 * using JSZip. Extracts text runs and images for each slide and renders
 * them as simplified HTML slides.
 */
export default function PptxRenderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const [slides, setSlides] = useState([])   // [{ texts: [], images: [{url, x, y, cx, cy}] }]
  const [loading, setLoading] = useState(true)
  const [currentSlide, setCurrentSlide] = useState(0)

  const parsePptx = useCallback(async () => {
    if (!currentFile?.file) return
    try {
      setPreviewStatus('loading')
      setLoading(true)

      const arrayBuffer = await currentFile.file.arrayBuffer()
      const zip = await JSZip.loadAsync(arrayBuffer)

      // Find all slide XML files: ppt/slides/slide1.xml, slide2.xml, ...
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

        // --- Extract text ---
        // Match <a:t>...</a:t> text runs
        const textMatches = []
        const textRegex = /<a:t>(.*?)<\/a:t>/g
        let m
        while ((m = textRegex.exec(xmlStr)) !== null) {
          if (m[1].trim()) textMatches.push(decodeXml(m[1]))
        }

        // --- Extract images ---
        const images = []
        // Match <p:pic> blocks to get relationship IDs and positions
        // rId is in <a:blip r:embed="rId2"/>
        const picRegex = /<p:pic\b[\s\S]*?<\/p:pic>/g
        const blipRegex = /r:embed="(rId\d+)"/
        const extRegex = /<p:ext\b[^>]*>[\s\S]*?<\/p:ext>/  // non-greedy first match
        // Offsets: <p:off x="123" y="456"/> Extents: <p:ext cx="789" cy="012"/>
        const offRegex = /<p:off\s+x="(-?\d+)"\s+y="(-?\d+)"/
        const extSizeRegex = /<p:ext\s+cx="(-?\d+)"\s+cy="(-?\d+)"/

        let picMatch
        while ((picMatch = picRegex.exec(xmlStr)) !== null) {
          const block = picMatch[0]
          const blipMatch = blipRegex.exec(block)
          if (!blipMatch) continue
          const rId = blipMatch[1]

          // Position (EMU units, 914400 EMU = 1 inch)
          const offMatch = offRegex.exec(block)
          const extSizeMatch = extSizeRegex.exec(block)
          const x = offMatch ? parseInt(offMatch[1], 10) / 914400 * 96 : 0  // convert to px @96dpi
          const y = offMatch ? parseInt(offMatch[2], 10) / 914400 * 96 : 0
          const cx = extSizeMatch ? parseInt(extSizeMatch[1], 10) / 914400 * 96 : 300
          const cy = extSizeMatch ? parseInt(extSizeMatch[2], 10) / 914400 * 96 : 200

          images.push({ rId, x, y, cx, cy, url: null })
        }

        // Resolve image rIds to actual file paths via slide rels file
        // e.g. ppt/slides/_rels/slide1.xml.rels
        const relsPath = slidePath
          .replace('ppt/slides/', 'ppt/slides/_rels/')
          .replace('.xml', '.xml.rels')

        if (zip.files[relsPath] && images.length > 0) {
          const relsXml = await zip.files[relsPath].async('string')
          for (const img of images) {
            // Match: <Relationship Id="rId2" Type="..." Target="media/image1.png"/>
            const relRegex = new RegExp(`Id="${img.rId}"[^>]*Target="([^"]+)"`)
            const relMatch = relRegex.exec(relsXml)
            if (relMatch) {
              const target = relMatch[1]
              // Target is relative to ppt/slides/, e.g. "../media/image1.png"
              const fullPath = 'ppt/' + target.replace(/^\.\.\//, '')
              if (zip.files[fullPath]) {
                const blob = await zip.files[fullPath].async('blob')
                img.url = URL.createObjectURL(blob)
              }
            }
          }
        }

        parsedSlides.push({ texts: textMatches, images })
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
    // Cleanup object URLs on unmount
    return () => {
      slides.forEach(s => s.images.forEach(img => {
        if (img.url) URL.revokeObjectURL(img.url)
      }))
    }
  }, [parsePptx])  // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Slide area */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-ink-100" style={{ zoom: zoomLevel / 100 }}>
        <div
          className="relative bg-white shadow-soft-lg rounded-lg overflow-hidden"
          style={{
            width: 'min(960px, 100%)',
            aspectRatio: '16 / 9',
          }}
        >
          {/* Images layer */}
          {slide.images.map((img, i) => (
            <img
              key={i}
              src={img.url}
              alt=""
              className="absolute"
              style={{
                left: `${(img.x / 960) * 100}%`,
                top: `${(img.y / 540) * 100}%`,
                width: `${(img.cx / 960) * 100}%`,
                height: `${(img.cy / 540) * 100}%`,
                objectFit: 'contain',
              }}
            />
          ))}

          {/* Text layer */}
          <div className="absolute inset-0 p-[6%] flex flex-col justify-center gap-2 overflow-hidden">
            {slide.texts.map((text, i) => (
              <p
                key={i}
                className={`${
                  i === 0
                    ? 'text-lg lg:text-2xl font-bold text-ink-800'
                    : 'text-sm lg:text-base text-ink-600'
                } leading-relaxed break-words`}
              >
                {text}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation bar */}
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
