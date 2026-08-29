/**
 * 格式转换工具集
 * 所有转换均在浏览器本地完成，不上传任何数据。
 *
 * 支持的转换路径：
 *   .docx / .xlsx / .pptx → PDF   (通过 HTML → html2canvas → jsPDF)
 *   .pdf → .docx                  (通过 pdfjs 文本提取 → docx 包生成)
 *   .pdf → PNG                    (通过 pdfjs 逐页渲染为 PNG)
 */

import * as pdfjsLib from 'pdfjs-dist'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak,
} from 'docx'

// ---------- 通用：触发浏览器下载 ----------
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 延迟释放，避免下载未完成
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// 从文件名去掉扩展名
function stripExt(name) {
  const idx = name.lastIndexOf('.')
  return idx === -1 ? name : name.slice(0, idx)
}

// =========================================================================
//  Office → PDF
// =========================================================================

/**
 * 将一个 DOM 元素渲染为 PDF 并下载。
 * 用于 Word (docx-preview 渲染的 HTML)、Excel (表格 HTML)、PPT (幻灯片 HTML)。
 *
 * @param {HTMLElement} targetEl - 要截图的 DOM 元素
 * @param {string} filename - 输出文件名
 * @param {object} opts - { orientation: 'portrait'|'landscape', multiPage: boolean, pageElements?: HTMLElement[] }
 */
async function elementToPdf(targetEl, filename, opts = {}) {
  const { orientation = 'portrait', pageElements = null } = opts

  // 如果提供了多个页面元素（如多张幻灯片），逐个截图合成
  const elements = pageElements || [targetEl]
  const canvases = []

  for (const el of elements) {
    // 确保元素可见
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    })
    canvases.push(canvas)
  }

  // 用第一页确定 PDF 尺寸
  const firstCanvas = canvases[0]
  const pdfWidth = firstCanvas.width
  const pdfHeight = firstCanvas.height

  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [pdfWidth, pdfHeight],
    hotfixes: ['px_scaling'],
  })

  // 第一页
  const imgData1 = firstCanvas.toDataURL('image/png')
  pdf.addImage(imgData1, 'PNG', 0, 0, pdfWidth, pdfHeight)

  // 后续页
  for (let i = 1; i < canvases.length; i++) {
    pdf.addPage([canvases[i].width, canvases[i].height], orientation)
    const imgData = canvases[i].toDataURL('image/png')
    pdf.addImage(imgData, 'PNG', 0, 0, canvases[i].width, canvases[i].height)
  }

  const blob = pdf.output('blob')
  downloadBlob(blob, filename)
}

/**
 * Excel → PDF
 * 解析 xlsx，将每个 sheet 渲染为 HTML 表格，再转 PDF。
 */
export async function xlsxToPdf(file, filename) {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })

  // 为每个 sheet 创建临时容器
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;left:-9999px;top:0;'
  document.body.appendChild(container)

  const pageElements = []

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const maxCols = Math.max(...rows.map(r => r.length), 1)

    const sheetDiv = document.createElement('div')
    sheetDiv.style.cssText = 'background:#fff;padding:30px;min-width:800px;'

    // Sheet 名称
    const title = document.createElement('h3')
    title.textContent = sheetName
    title.style.cssText = 'font-family:sans-serif;font-size:16px;margin-bottom:12px;color:#333;'
    sheetDiv.appendChild(title)

    // 表格
    const table = document.createElement('table')
    table.style.cssText = 'border-collapse:collapse;width:100%;font-family:sans-serif;font-size:12px;'

    rows.forEach((row, ri) => {
      const tr = document.createElement('tr')
      if (ri === 0) tr.style.cssText = 'background:#f3f4f6;font-weight:600;'

      for (let ci = 0; ci < maxCols; ci++) {
        const val = row[ci]
        const td = document.createElement('td')
        td.textContent = val === undefined || val === null ? '' : String(val)
        td.style.cssText = 'border:1px solid #e5e7eb;padding:4px 8px;white-space:pre-wrap;max-width:300px;'
        tr.appendChild(td)
      }
      table.appendChild(tr)
    })

    sheetDiv.appendChild(table)
    container.appendChild(sheetDiv)
    pageElements.push(sheetDiv)
  }

  try {
    await elementToPdf(null, filename, { orientation: 'landscape', pageElements })
  } finally {
    document.body.removeChild(container)
  }
}

/**
 * Word (.docx) → PDF
 * 用 docx-preview 渲染到隐藏容器，再 html2canvas 截图转 PDF。
 */
export async function docxToPdf(file, filename) {
  const { renderAsync } = await import('docx-preview')

  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;left:-9999px;top:0;width:820px;'
  document.body.appendChild(container)

  try {
    await renderAsync(file, container, null, {
      className: 'docx-page',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      experimental: true,
    })

    // docx-preview 渲染的每页是 .docx-page 元素
    let pageElements = container.querySelectorAll('.docx-page')
    if (pageElements.length === 0) {
      // 兜底：把整个容器作为一页
      pageElements = [container]
    }

    await elementToPdf(null, filename, {
      orientation: 'portrait',
      pageElements: Array.from(pageElements),
    })
  } finally {
    document.body.removeChild(container)
  }
}

/**
 * PPT (.pptx) → PDF
 * 用 JSZip 解析 PPTX，将每页幻灯片渲染为 HTML，再转 PDF。
 */
export async function pptxToPdf(file, filename) {
  const arrayBuffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)

  // 找到所有幻灯片
  const slideEntries = Object.keys(zip.files)
    .filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)/)[1], 10)
      const nb = parseInt(b.match(/slide(\d+)/)[1], 10)
      return na - nb
    })

  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;left:-9999px;top:0;'
  document.body.appendChild(container)

  const pageElements = []
  const objectUrls = []

  try {
    for (const slidePath of slideEntries) {
      const xmlStr = await zip.files[slidePath].async('string')

      // 提取文本
      const texts = []
      const textRegex = /<a:t>(.*?)<\/a:t>/g
      let m
      while ((m = textRegex.exec(xmlStr)) !== null) {
        if (m[1].trim()) {
          texts.push(m[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'"))
        }
      }

      // 提取图片
      const images = []
      const picRegex = /<p:pic\b[\s\S]*?<\/p:pic>/g
      const blipRegex = /r:embed="(rId\d+)"/
      const offRegex = /<p:off\s+x="(-?\d+)"\s+y="(-?\d+)"/
      const extSizeRegex = /<p:ext\s+cx="(-?\d+)"\s+cy="(-?\d+)"/
      let picMatch
      while ((picMatch = picRegex.exec(xmlStr)) !== null) {
        const block = picMatch[0]
        const blipMatch = blipRegex.exec(block)
        if (!blipMatch) continue
        const rId = blipMatch[1]
        const offMatch = offRegex.exec(block)
        const extSizeMatch = extSizeRegex.exec(block)
        const x = offMatch ? parseFloat(offMatch[1]) / 914400 * 96 : 0
        const y = offMatch ? parseFloat(offMatch[2]) / 914400 * 96 : 0
        const cx = extSizeMatch ? parseFloat(extSizeMatch[1]) / 914400 * 96 : 300
        const cy = extSizeMatch ? parseFloat(extSizeMatch[2]) / 914400 * 96 : 200
        images.push({ rId, x, y, cx, cy, url: null })
      }

      // 解析 rels 获取图片 URL
      const relsPath = slidePath
        .replace('ppt/slides/', 'ppt/slides/_rels/')
        .replace('.xml', '.xml.rels')

      if (zip.files[relsPath] && images.length > 0) {
        const relsXml = await zip.files[relsPath].async('string')
        for (const img of images) {
          const relRegex = new RegExp(`Id="${img.rId}"[^>]*Target="([^"]+)"`)
          const relMatch = relRegex.exec(relsXml)
          if (relMatch) {
            const target = relMatch[1]
            const fullPath = 'ppt/' + target.replace(/^\.\.\//, '')
            if (zip.files[fullPath]) {
              const blob = await zip.files[fullPath].async('blob')
              img.url = URL.createObjectURL(blob)
              objectUrls.push(img.url)
            }
          }
        }
      }

      // 构建 HTML 幻灯片
      const slideDiv = document.createElement('div')
      slideDiv.style.cssText = `
        width:960px;height:540px;background:#fff;position:relative;
        box-shadow:0 2px 8px rgba(0,0,0,0.1);overflow:hidden;
        font-family:sans-serif;
      `

      // 图片层
      images.forEach(img => {
        if (img.url) {
          const imgEl = document.createElement('img')
          imgEl.src = img.url
          imgEl.style.cssText = `position:absolute;left:${(img.x/960)*100}%;top:${(img.y/540)*100}%;width:${(img.cx/960)*100}%;height:${(img.cy/540)*100}%;object-fit:contain;`
          slideDiv.appendChild(imgEl)
        }
      })

      // 文本层
      const textLayer = document.createElement('div')
      textLayer.style.cssText = 'position:absolute;inset:0;padding:6%;display:flex;flex-direction:column;justify-content:center;gap:8px;'
      texts.forEach((text, i) => {
        const p = document.createElement('p')
        p.textContent = text
        if (i === 0) {
          p.style.cssText = 'font-size:24px;font-weight:bold;color:#1f2937;margin:0;'
        } else {
          p.style.cssText = 'font-size:16px;color:#4b5563;margin:0;line-height:1.5;'
        }
        textLayer.appendChild(p)
      })
      slideDiv.appendChild(textLayer)

      container.appendChild(slideDiv)
      pageElements.push(slideDiv)
    }

    await elementToPdf(null, filename, {
      orientation: 'landscape',
      pageElements,
    })
  } finally {
    // 清理 object URLs
    objectUrls.forEach(url => URL.revokeObjectURL(url))
    document.body.removeChild(container)
  }
}

// =========================================================================
//  PDF → Word (.docx)
// =========================================================================

/**
 * PDF → Word (.docx)
 * 用 pdfjs 提取每页文本，用 docx 包生成 Word 文档。
 */
export async function pdfToDocx(file, filename) {
  const arrayBuffer = await file.arrayBuffer()
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const paragraphs = []

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i)
    const textContent = await page.getTextContent()

    // 将 text items 按行分组（y 坐标相近的归为同一行）
    const lines = []
    let currentLine = []
    let lastY = null

    for (const item of textContent.items) {
      const transform = item.transform
      const y = Math.round(transform[5])
      if (lastY === null || Math.abs(y - lastY) < 3) {
        currentLine.push(item.str)
      } else {
        if (currentLine.length > 0) {
          lines.push(currentLine.join(''))
        }
        currentLine = [item.str]
      }
      lastY = y
    }
    if (currentLine.length > 0) {
      lines.push(currentLine.join(''))
    }

    // 每页之前插入分页符（第一页除外）
    if (i > 1) {
      paragraphs.push(new Paragraph({
        children: [new PageBreak()],
      }))
    }

    // 添加页面标题
    paragraphs.push(new Paragraph({
      children: [new TextRun({
        text: `— 第 ${i} 页 —`,
        italics: true,
        color: '999999',
        size: 18,
      })],
      spacing: { after: 200 },
    }))

    // 将每行文本转为段落
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: trimmed, size: 22 })],
          spacing: { after: 120 },
        }))
      } else {
        // 空行
        paragraphs.push(new Paragraph({}))
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: paragraphs,
    }],
  })

  const blob = await Packer.toBlob(doc)
  downloadBlob(blob, filename)
}

// =========================================================================
//  PDF → PNG
// =========================================================================

/**
 * PDF → PNG
 * 将每页 PDF 渲染为 PNG 图片，多页时打包为 ZIP 下载，单页直接下载。
 */
export async function pdfToPng(file, filename, onProgress = null) {
  const arrayBuffer = await file.arrayBuffer()
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const baseName = stripExt(filename)

  if (pdfDoc.numPages === 1) {
    // 单页直接下载 PNG
    const page = await pdfDoc.getPage(1)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: ctx, viewport }).promise

    canvas.toBlob((blob) => {
      downloadBlob(blob, `${baseName}.png`)
    }, 'image/png')

    if (onProgress) onProgress(1, 1)
  } else {
    // 多页打包为 ZIP
    const zip = new JSZip()

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: ctx, viewport }).promise

      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, 'image/png')
      })
      zip.file(`${baseName}_page_${i}.png`, blob)

      if (onProgress) onProgress(i, pdfDoc.numPages)
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    downloadBlob(zipBlob, `${baseName}_images.zip`)
  }
}

// =========================================================================
//  转换调度器
// =========================================================================

/**
 * 主转换入口，根据文件类型和目标格式路由到具体实现。
 *
 * @param {File} file - 原始文件
 * @param {string} ext - 文件扩展名（如 '.docx'）
 * @param {string} targetFormat - 目标格式 key（'to-pdf' | 'to-docx' | 'to-png'）
 * @param {function} onProgress - 进度回调 (current, total)
 * @returns {Promise<void>}
 */
export async function convertFile(file, ext, targetFormat, onProgress = null) {
  const baseName = stripExt(file.name)

  if (targetFormat === 'to-pdf') {
    const outName = `${baseName}.pdf`
    if (ext === '.docx') {
      await docxToPdf(file, outName)
    } else if (ext === '.xlsx') {
      await xlsxToPdf(file, outName)
    } else if (ext === '.pptx') {
      await pptxToPdf(file, outName)
    } else {
      throw new Error('不支持的格式转换为 PDF')
    }
  } else if (targetFormat === 'to-docx') {
    const outName = `${baseName}.docx`
    await pdfToDocx(file, outName)
  } else if (targetFormat === 'to-png') {
    const outName = file.name
    await pdfToPng(file, outName, onProgress)
  } else {
    throw new Error(`未知的转换目标: ${targetFormat}`)
  }
}
