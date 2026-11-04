import { useFileStore } from '../context/FileContext'
import { getExtension, SUPPORTED_EXTENSIONS } from '../utils/fileHelpers'
import { useI18n } from '../i18n'
import XlsxRenderer from './renderers/XlsxRenderer'
import DocxRenderer from './renderers/DocxRenderer'
import PdfRenderer from './renderers/PdfRenderer'
import PptxRenderer from './renderers/PptxRenderer'
import Azw3Renderer from './renderers/Azw3Renderer'
import MdRenderer from './renderers/MdRenderer'

export default function PreviewViewport() {
  const { currentFile, zoomLevel } = useFileStore()
  const { t } = useI18n()

  if (!currentFile) return null

  const ext = getExtension(currentFile.name)

  // Pick the appropriate renderer
  const renderContent = () => {
    switch (ext) {
      case '.xlsx':
      case '.xls':
        return <XlsxRenderer />
      case '.docx':
        return <DocxRenderer />
      case '.pdf':
        return <PdfRenderer />
      case '.pptx':
        return <PptxRenderer />
      case '.azw3':
      case '.mobi':
        return <Azw3Renderer />
      case '.md':
      case '.markdown':
        return <MdRenderer />
      default:
        return (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <p className="text-sm font-medium text-ink-500">{t('viewport.unsupported')}</p>
            <p className="text-xs text-ink-400">
              {t('viewport.supported', { formats: SUPPORTED_EXTENSIONS.join(' / ') })}
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
