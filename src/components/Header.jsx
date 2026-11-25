import { useI18n } from '../i18n'

export default function Header() {
  const { t, lang, setLang } = useI18n()
  return (
    <header className="app-header flex items-center gap-2 px-4 py-2 bg-white border-b border-ink-200 select-none lg:px-6">
      {/* Logo / icon（无交互，macOS 下随整条 header 成为拖动区的一部分） */}
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-500 text-white text-sm font-bold">
        Ld
      </div>
      {/* R-129：副标题与主名同行（小屏 768 高下顶部横条占比过高，两行变一行省 ~16px） */}
      <div className="flex items-baseline gap-2 leading-tight">
        <span className="text-sm font-semibold tracking-wide text-ink-900">
          {t('header.app')}
        </span>
        <span className="text-[11px] text-ink-400 hidden md:inline">
          LightDoc Viewer &amp; Converter
        </span>
      </div>

      {/* 语言切换（中/英） */}
      <button
        onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
        className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-ink-200 text-ink-500 text-xs font-medium hover:bg-ink-50 hover:text-ink-700 transition-colors focus-ring no-drag"
        title={t('lang.switch')}
        aria-label={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>
        </svg>
        {lang === 'zh' ? 'EN' : '中文'}
      </button>
    </header>
  )
}