export default function Header() {
  return (
    <header className="flex items-center gap-2 px-4 py-3 bg-white border-b border-ink-200 select-none lg:px-6">
      {/* Logo / icon */}
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent-500 text-white text-sm font-bold">
        Ld
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-wide text-ink-900">
          轻快文档工具箱
        </span>
        <span className="text-[11px] text-ink-400">
          LightDoc Viewer &amp; Converter
        </span>
      </div>
    </header>
  )
}
