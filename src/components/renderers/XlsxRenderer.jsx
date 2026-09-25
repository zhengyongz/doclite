import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { useFileStore } from '../../context/FileContext'

// ---------- Tab icon ----------
function SheetIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
      <line x1="15" y1="3" x2="15" y2="21"/>
    </svg>
  )
}

export default function XlsxRenderer() {
  const { currentFile, zoomLevel, setPreviewStatus, setError } = useFileStore()
  const [sheets, setSheets] = useState([])      // [{ name, rows[][] }]
  const [activeIdx, setActiveIdx] = useState(0)

  const parseFile = useCallback(async () => {
    if (!currentFile?.file) return
    try {
      setPreviewStatus('loading')
      const arrayBuffer = await currentFile.file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })

      const parsed = workbook.SheetNames.map((name) => {
        const ws = workbook.Sheets[name]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        return { name, rows }
      })

      setSheets(parsed)
      setActiveIdx(0)
      setPreviewStatus('ready')
    } catch (err) {
      console.error('[XlsxRenderer] parse error:', err)
      setError('Excel 文件解析失败，文件可能已损坏或格式不正确')
    }
  }, [currentFile, setPreviewStatus, setError])

  useEffect(() => {
    parseFile()
  }, [parseFile])

  if (sheets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-ink-400 text-sm">
        正在解析…
      </div>
    )
  }

  const sheet = sheets[activeIdx]
  const maxCols = sheets.reduce((mx, s) => s.rows.reduce((m, r) => Math.max(m, r.length), mx), 1)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex gap-0 overflow-x-auto border-b border-ink-200 bg-ink-50 px-2">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActiveIdx(i)}
              className={`
                flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors
                ${i === activeIdx
                  ? 'border-accent-500 text-accent-700 bg-white'
                  : 'border-transparent text-ink-400 hover:text-ink-600 hover:bg-ink-100'
                }
              `}
            >
              <SheetIcon className="w-3.5 h-3.5" />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Table area */}
      <div className="flex-1 overflow-auto p-2 lg:p-4" style={{ zoom: zoomLevel / 100 }}>
        <div className="inline-block min-w-full rounded-lg border border-ink-200 overflow-hidden shadow-soft bg-white">
          <table className="min-w-full border-collapse text-sm">
            <tbody>
              {sheet.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={ri === 0 ? 'bg-ink-50 font-semibold' : 'even:bg-ink-50/30'}
                >
                  {/* Row number */}
                  <td className="px-2 py-1.5 text-[11px] text-ink-300 text-right border-r border-ink-100 select-none w-10 shrink-0">
                    {ri + 1}
                  </td>
                  {Array.from({ length: maxCols }).map((_, ci) => {
                    const val = row[ci]
                    const display = val === undefined || val === null ? '' : String(val)
                    return (
                      <td
                        key={ci}
                        className="px-3 py-1.5 text-ink-700 border-r border-ink-100 last:border-r-0 whitespace-pre-wrap break-words max-w-[300px]"
                      >
                        {display}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
