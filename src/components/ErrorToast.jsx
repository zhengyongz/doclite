import { useEffect, useState } from 'react'
import { useFileStore } from '../context/FileContext'

export default function ErrorToast() {
  const { errorMessage, clearError } = useFileStore()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (errorMessage) {
      setVisible(true)
      const timer = setTimeout(() => {
        setVisible(false)
        // Wait for fade-out animation before clearing
        setTimeout(clearError, 300)
      }, 5000)
      return () => clearTimeout(timer)
    } else {
      setVisible(false)
    }
  }, [errorMessage, clearError])

  if (!errorMessage) return null

  return (
    <div
      className={`
        fixed inset-x-0 bottom-6 z-50 flex justify-center px-4
        transition-all duration-300
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
      `}
    >
      <div
        className="flex items-start gap-3 max-w-lg w-full px-4 py-3 rounded-lg bg-red-50 border border-red-200 shadow-soft-lg"
        role="alert"
      >
        {/* Icon */}
        <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p className="text-sm text-red-800 leading-snug flex-1">{errorMessage}</p>
        <button
          onClick={() => { setVisible(false); setTimeout(clearError, 300) }}
          className="shrink-0 p-0.5 rounded hover:bg-red-100 transition-colors"
          aria-label="关闭"
        >
          <svg className="w-4 h-4 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
