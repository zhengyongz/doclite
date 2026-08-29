import { useFileStore } from '../context/FileContext'
import { getExtension, SUPPORTED_EXTENSIONS } from '../utils/fileHelpers'
import XlsxRenderer from './renderers/XlsxRenderer'
import DocxRenderer from './renderers/DocxRenderer'
import PdfRenderer from './renderers/PdfRenderer'
import PptxRenderer from './renderers/PptxRenderer'

export default function PreviewViewport() {
  const { currentFile, zoomLevel } = useFileStore()

  if (!currentFile) return null

  const ext = getExtension(currentFile.name)

  // Pick the appropriate renderer
  const renderContent = () => {
    switch (ext) {
      case '.xlsx':
        return <XlsxRenderer />
      case '.docx':
        return <DocxRenderer />
      case '.pdf':
        return <PdfRenderer />
      case '.pptx':
        return <PptxRenderer />
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <p className="text-sm font-medium text-ink-500">不支持的格式</p>
            <p className="text-xs text-ink-400">
              仅支持 {SUPPORTED_EXTENSIONS.join(' / ')} 格式
            </p>
          </div>
        )
    }
  }

  return (
    <div className="preview-viewport flex-1 overflow-hidden bg-ink-50">
      {renderContent()}
    </div>
  )
}
