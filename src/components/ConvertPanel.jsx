import { useState } from 'react'
import { useFileStore } from '../context/FileContext'
import { getExtension } from '../utils/fileHelpers'
import { useConverters } from '../useConverters'
import { useI18n } from '../i18n'
// 注意：不再直接 import converters.js —— 转换库已拆为独立可选组件（安装时不存在于主包），
// 运行时经 useConverters().convert() 从 window.DocLiteConverters 懒加载。

// Inline icons
function PdfIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  )
}

function ImageIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  )
}

function WordIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="13" y2="17"/>
    </svg>
  )
}

function BookIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  )
}

function SpinnerIcon({ className }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  )
}

export default function ConvertPanel() {
  const { currentFile, setError, isConverting, setConverting, setConvertProgress, convertProgress } = useFileStore()
  const { t, ts } = useI18n()
  const [highQuality, setHighQuality] = useState(false)
  const { status, api, busy, error: compError, notice, outdated, appVersion, install, uninstall, convert } = useConverters()

  if (!currentFile) return null

  const ext = getExtension(currentFile.name)

  // Determine available conversions based on file format
  const conversions = []

  if (ext === '.docx' || ext === '.xlsx' || ext === '.xls' || ext === '.pptx') {
    conversions.push({
      key: 'to-pdf',
      label: t('convert.exportPdf'),
      description: t('convert.exportPdfDesc'),
      icon: PdfIcon,
      color: 'text-red-500',
    })
  }

  if (ext === '.pdf') {
    conversions.push(
      {
        key: 'to-docx',
        label: t('convert.exportWord'),
        description: t('convert.exportWordDesc'),
        icon: WordIcon,
        color: 'text-blue-500',
      },
      {
        key: 'to-png',
        label: t('convert.exportPng'),
        description: t('convert.exportPngDesc'),
        icon: ImageIcon,
        color: 'text-green-500',
      },
      {
        key: 'to-azw3',
        label: t('convert.exportMobi'),
        description: t('convert.exportMobiDesc'),
        icon: BookIcon,
        color: 'text-purple-500',
      },
    )
  }

  if (conversions.length === 0) return null

  // .xls 为 v0.7.0 新增能力：旧版组件（<0.7.0）的 convertFile 只认 .xlsx，
  // 直接放行会出现“能看到按钮但点了必报错”，故按版本门槛禁用（workbuddy M2）
  const xlsNeedsUpdate = !!outdated && ext === '.xls'

  const handleConvert = async (key) => {
    if (isConverting) return

    setConverting(true)
    setConvertProgress(null)

    try {
      await convert(currentFile.file, ext, key, (current, total) => {
        const percent = Math.round((current / total) * 100)
        setConvertProgress(`${percent}%`)
      }, { highQuality })
    } catch (err) {
      console.error('[ConvertPanel] conversion error:', err)
      setError(t('convert.failed', { msg: ts(err.message) }))
    } finally {
      setConverting(false)
      setConvertProgress(null)
    }
  }

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-3 shadow-soft">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-ink-400 uppercase tracking-wider">
          {t('convert.title')}{status?.installed ? (
            <span className="ml-1.5 text-[10px] text-ink-300 normal-case">{t('convert.componentTag', { version: status.version })}</span>
          ) : null}
        </p>
        {isConverting && convertProgress && (
          <span className="text-xs text-accent-500 font-medium tabular-nums">
            {convertProgress}
          </span>
        )}
      </div>

      {/* —— 转换组件未安装：安装引导（可选功能，不装不影响浏览） —— */}
      {!status?.installed && (
        <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/50 px-3 py-3">
          <p className="text-xs text-ink-500 leading-relaxed">
            {t('convert.notInstalled')}
          </p>
          <button
            disabled={busy}
            onClick={install}
            className="mt-2.5 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-accent-300 bg-accent-50 text-accent-700 text-xs font-medium hover:bg-accent-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? t('convert.installing') : t('convert.installBtn')}
          </button>
          {compError && (
            <p className="mt-2 text-[11px] text-red-500 break-all">{ts(compError)}</p>
          )}
        </div>
      )}

      {status?.installed && (
        <div className="mb-2 flex items-center justify-between text-[10px] text-ink-300">
          <span>{t('convert.providedByComponent')}</span>
          <span className="flex items-center gap-2 shrink-0">
            <button className="underline hover:text-ink-500" disabled={busy} onClick={install}>
              {busy ? t('convert.installing') : outdated ? t('convert.updateTo', { version: appVersion }) : t('convert.reinstall')}
            </button>
            {status.source === 'user' && (
              <button className="underline hover:text-red-400" disabled={busy} onClick={uninstall}>
                {t('convert.remove')}
              </button>
            )}
          </span>
        </div>
      )}
      {outdated && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
          <p className="flex-1 text-[11px] leading-relaxed text-amber-700">
            {xlsNeedsUpdate
              ? t('convert.outdated.xls')
              : t('convert.outdated.adv', { cur: status.version, app: appVersion })}
          </p>
          <button
            disabled={busy}
            onClick={install}
            className="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? t('convert.installing') : t('convert.updateTo', { version: appVersion })}
          </button>
        </div>
      )}
      {notice && (
        <p className="mb-2 text-[11px] text-green-600 break-all">{notice}</p>
      )}
      {conversions.some((c) => c.key === 'to-pdf') && !isConverting && status?.installed && (
        <label
          className="flex items-center gap-1.5 mb-2 cursor-pointer select-none"
          title={t('convert.hdTitle')}
        >
          <input
            type="checkbox"
            checked={highQuality}
            onChange={(e) => setHighQuality(e.target.checked)}
            className="accent-blue-500 w-3 h-3"
          />
          <span className="text-[11px] text-ink-500">{t('convert.hdLabel')}</span>
        </label>
      )}
      <div className="flex flex-col gap-2">
        {status?.installed && conversions.map(({ key, label, description, icon: Icon, color }) => {
          const isThisConverting = isConverting
          const blocked = xlsNeedsUpdate && key === 'to-pdf'
          return (
            <button
              key={key}
              onClick={() => handleConvert(key)}
              disabled={isConverting || !api || blocked}
              title={blocked ? t('convert.blockedTitle') : (!api ? t('convert.loadingTitle') : undefined)}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-ink-200 bg-white hover:border-accent-300 hover:bg-accent-50/40 transition-colors focus-ring group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isThisConverting ? (
                <SpinnerIcon className="w-5 h-5 shrink-0 text-accent-400" />
              ) : (
                <Icon className={`w-5 h-5 shrink-0 ${color}`} />
              )}
              <div className="text-left">
                <p className="text-sm font-medium text-ink-700 group-hover:text-accent-700">{label}</p>
                <p className="text-[11px] text-ink-400">{description}</p>
              </div>
            </button>
          )
        })}
      </div>
      {isConverting && (
        <p className="mt-2 text-xs text-ink-400">
          {t('convert.progress')}
        </p>
      )}
      {status?.installed && compError && (
        <p className="mt-2 text-[11px] text-red-500 break-all">{ts(compError)}</p>
      )}
    </div>
  )
}
