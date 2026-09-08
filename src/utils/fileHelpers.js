// ---------- Supported formats ----------
export const SUPPORTED_EXTENSIONS = ['.docx', '.xlsx', '.pptx', '.pdf', '.azw3', '.mobi']

export const MIME_MAP = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/pdf': '.pdf',
  'application/x-mobipocket-ebook': '.azw3',
  'application/vnd.amazon.ebook': '.azw3',
}

export const MAX_FILE_SIZE_MB = 100
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

// Format display metadata
export const FORMAT_META = {
  '.docx': { label: 'Word', color: 'bg-blue-100 text-blue-700' },
  '.xlsx': { label: 'Excel', color: 'bg-green-100 text-green-700' },
  '.pptx': { label: 'PPT',   color: 'bg-orange-100 text-orange-700' },
  '.pdf':  { label: 'PDF',   color: 'bg-red-100 text-red-700' },
  '.azw3': { label: 'AZW3',  color: 'bg-purple-100 text-purple-700' },
  '.mobi': { label: 'MOBI',  color: 'bg-amber-100 text-amber-700' },
}

// ---------- Helpers ----------
/**
 * Extract extension from filename, lowercased with dot.
 * e.g. "report.DOCX" → ".docx"
 */
export function getExtension(filename) {
  const idx = filename.lastIndexOf('.')
  if (idx === -1) return ''
  return filename.slice(idx).toLowerCase()
}

/**
 * Validate a File object against our constraints.
 * Returns null if valid, or an error message string.
 */
export function validateFile(file) {
  if (!file) return '未选择任何文件'

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `文件大小 (${(file.size / 1024 / 1024).toFixed(1)} MB) 超出限制（最大 ${MAX_FILE_SIZE_MB} MB）`
  }

  const ext = getExtension(file.name)
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return `不支持的格式 "${ext || '未知'}"，仅支持 ${SUPPORTED_EXTENSIONS.join(' / ')}`
  }

  return null
}

/**
 * Format byte size to human-readable string.
 */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
