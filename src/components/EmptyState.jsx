export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-4 text-center select-none">
      {/* Illustration – simple document stack */}
      <svg className="w-20 h-20 text-ink-200 mb-4" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="18" y="8" width="36" height="48" rx="3" className="opacity-40" />
        <rect x="24" y="14" width="36" height="48" rx="3" className="opacity-60" />
        <rect x="30" y="20" width="36" height="48" rx="3" />
        <line x1="38" y1="32" x2="56" y2="32" className="opacity-40" />
        <line x1="38" y1="38" x2="52" y2="38" className="opacity-40" />
        <line x1="38" y1="44" x2="48" y2="44" className="opacity-40" />
      </svg>
      <p className="text-base font-medium text-ink-400">尚未加载文件</p>
      <p className="text-sm text-ink-300 mt-1">从左侧上传一份文档即可开始预览与转换</p>

      {/* Conversion capability hint */}
      <div className="mt-6 max-w-sm">
        <p className="text-xs font-semibold text-ink-400 uppercase tracking-wider mb-2">支持转换</p>
        <div className="flex flex-wrap justify-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-full border border-ink-200 bg-white text-ink-500">
            Word / Excel / PPT → PDF
          </span>
          <span className="px-2.5 py-1 rounded-full border border-ink-200 bg-white text-ink-500">
            PDF → Word
          </span>
          <span className="px-2.5 py-1 rounded-full border border-ink-200 bg-white text-ink-500">
            PDF → PNG 图片
          </span>
        </div>
        <p className="text-xs text-ink-300 mt-3">
          所有转换均在浏览器本地完成，不会上传任何数据
        </p>
      </div>
    </div>
  )
}