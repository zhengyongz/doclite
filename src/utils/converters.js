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
import { createMobi } from './mobiWriter'
import {
  Document, Packer, Paragraph, TextRun, PageBreak, ImageRun,
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
 * 用 pdfjs 提取每页文本和图片，按位置穿插排列，用 docx 包生成 Word 文档。
 */
export async function pdfToDocx(file, filename, onProgress = null) {
  const arrayBuffer = await file.arrayBuffer()
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const paragraphs = []

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfjsLibGetPage(pdfDoc, i)
    const viewport = page.getViewport({ scale: 1.0 })

    // ---- 提取文字行 ----
    const textContent = await page.getTextContent()
    const textItems = []
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue
      const y = Math.round(item.transform[5])
      textItems.push({ type: 'text', y, str: item.str })
    }
    // 按行分组（y 坐标相近的归为同一行）
    const textLines = groupTextByLine(textItems)

    // ---- 提取图片 ----
    const imageItems = await extractPageImages(page)

    // ---- 合并文字行和图片，按 Y 坐标从上到下排列 ----
    // PDF 坐标系 y 轴向上，所以 y 值越大越靠上，需要反转
    const allItems = [
      ...textLines.map(l => ({ type: 'text', y: l.y, str: l.str })),
      ...imageItems.map(img => ({ type: 'image', y: img.y, ...img })),
    ]
    allItems.sort((a, b) => b.y - a.y) // y 大的在前（页面上方）

    // 分页符
    if (i > 1) {
      paragraphs.push(new Paragraph({
        children: [new PageBreak()],
      }))
    }

    // 页面标题
    paragraphs.push(new Paragraph({
      children: [new TextRun({
        text: `— 第 ${i} 页 —`,
        italics: true,
        color: '999999',
        size: 18,
      })],
      spacing: { after: 200 },
    }))

    // 按顺序输出文字段落和图片
    for (const item of allItems) {
      if (item.type === 'text') {
        const trimmed = item.str.trim()
        if (trimmed) {
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: trimmed, size: 22 })],
            spacing: { after: 120 },
          }))
        } else {
          paragraphs.push(new Paragraph({}))
        }
      } else if (item.type === 'image' && item.dataUrl) {
        // 将压缩后的图片插入 Word 文档
        try {
          const compressed = await compressImageDataUrl(item.dataUrl, 600)
          paragraphs.push(new Paragraph({
            children: [new ImageRun({
              data: compressed.buffer,
              transformation: { width: compressed.width, height: compressed.height },
              type: 'jpg',
            })],
            spacing: { before: 120, after: 120 },
            alignment: 'center',
          }))
        } catch (e) {
          console.warn(`[pdfToDocx] 图片插入失败 (page ${i}):`, e)
          paragraphs.push(new Paragraph({
            children: [new TextRun({ text: '[图片]', color: '999999', italics: true })],
            spacing: { after: 120 },
            alignment: 'center',
          }))
        }
      }
    }

    // 进度回调
    if (onProgress) onProgress(i, pdfDoc.numPages)
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

// ---- 辅助函数 ----

/** 包装 getPage 以保持一致的接口 */
async function pdfjsLibGetPage(pdfDoc, pageNum) {
  return pdfDoc.getPage(pageNum)
}

/** 将文字 items 按 Y 坐标分组成行 */
function groupTextByLine(textItems) {
  if (textItems.length === 0) return []
  // 按从上到下排序（y 大的在前）
  const sorted = [...textItems].sort((a, b) => b.y - a.y)
  const lines = []
  let currentLine = [sorted[0]]
  let lastY = sorted[0].y

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]
    if (Math.abs(item.y - lastY) < 3) {
      currentLine.push(item)
    } else {
      // 同一行内按 x 坐标排序
      currentLine.sort((a, b) => (a.x || 0) - (b.x || 0))
      lines.push({ y: lastY, str: currentLine.map(t => t.str).join('') })
      currentLine = [item]
      lastY = item.y
    }
  }
  if (currentLine.length > 0) {
    currentLine.sort((a, b) => (a.x || 0) - (b.x || 0))
    lines.push({ y: lastY, str: currentLine.map(t => t.str).join('') })
  }
  return lines
}

/** 从 PDF 页面提取图片对象 */
async function extractPageImages(page) {
  const images = []
  try {
    const operatorList = await page.getOperatorList()
    const OPS = pdfjsLib.OPS
    const fnArray = operatorList.fnArray
    const argsArray = operatorList.argsArray

    for (let j = 0; j < fnArray.length; j++) {
      // OPS.paintImageXObject / paintImageXObjectRepeat / paintInlineImageXObject
      if (fnArray[j] === OPS.paintImageXObject ||
          fnArray[j] === OPS.paintImageXObjectRepeat) {
        const args = argsArray[j]
        const imgName = args[0] // 图片在页面对象中的 key
        let imgObj = null

        // 尝试从 page.objs 获取图片对象
        if (page.objs && page.objs.has && page.objs.has(imgName)) {
          imgObj = await new Promise(resolve => page.objs.get(imgName, resolve))
        }

        if (imgObj && imgObj.bitmap) {
          // 图片是 ImageBitmap
          const canvas = document.createElement('canvas')
          canvas.width = imgObj.width
          canvas.height = imgObj.height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(imgObj.bitmap, 0, 0)
          images.push({
            y: args[2] || 0, // transform 的 y 坐标
            dataUrl: canvas.toDataURL('image/png'),
            width: imgObj.width,
            height: imgObj.height,
            format: 'png',
          })
        } else if (imgObj && imgObj.data) {
          // 图片是原始像素数据
          const canvas = document.createElement('canvas')
          canvas.width = imgObj.width
          canvas.height = imgObj.height
          const ctx = canvas.getContext('2d')
          const imageData = ctx.createImageData(imgObj.width, imgObj.height)

          if (imgObj.data.length === imgObj.width * imgObj.height * 4) {
            // RGBA
            imageData.data.set(imgObj.data)
          } else if (imgObj.data.length === imgObj.width * imgObj.height * 3) {
            // RGB → RGBA
            const src = imgObj.data
            const dst = imageData.data
            for (let k = 0; k < imgObj.width * imgObj.height; k++) {
              dst[k * 4] = src[k * 3]
              dst[k * 4 + 1] = src[k * 3 + 1]
              dst[k * 4 + 2] = src[k * 3 + 2]
              dst[k * 4 + 3] = 255
            }
          } else if (imgObj.data instanceof Uint8ClampedArray) {
            imageData.data.set(imgObj.data)
          }

          ctx.putImageData(imageData, 0, 0)
          images.push({
            y: args[2] || 0,
            dataUrl: canvas.toDataURL('image/png'),
            width: imgObj.width,
            height: imgObj.height,
            format: 'png',
          })
        }
      } else if (fnArray[j] === OPS.paintInlineImageXObject) {
        // 内联图片
        const args = argsArray[j]
        const imgData = args[0]
        if (imgData && imgData.data) {
          const canvas = document.createElement('canvas')
          canvas.width = imgData.width
          canvas.height = imgData.height
          const ctx = canvas.getContext('2d')
          const imageData = ctx.createImageData(imgData.width, imgData.height)

          if (imgData.data.length === imgData.width * imgData.height * 4) {
            imageData.data.set(imgData.data)
          } else if (imgData.data.length === imgData.width * imgData.height * 3) {
            const src = imgData.data
            const dst = imageData.data
            for (let k = 0; k < imgData.width * imgData.height; k++) {
              dst[k * 4] = src[k * 3]
              dst[k * 4 + 1] = src[k * 3 + 1]
              dst[k * 4 + 2] = src[k * 3 + 2]
              dst[k * 4 + 3] = 255
            }
          }
          ctx.putImageData(imageData, 0, 0)
          images.push({
            y: 0,
            dataUrl: canvas.toDataURL('image/png'),
            width: imgData.width,
            height: imgData.height,
            format: 'png',
          })
        }
      }
    }
  } catch (e) {
    console.warn(`[extractPageImages] 提取图片失败:`, e)
  }

  return images
}

/** 将 dataURL 转为 Uint8Array（docx ImageRun 需要的格式） */
function dataUrlToBuffer(dataUrl) {
  const base64 = dataUrl.split(',')[1]
  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/** 压缩图片：缩放到 maxWidth 并转为 JPEG（质量 0.7），大幅减小体积 */
async function compressImageDataUrl(dataUrl, maxWidth = 600) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.7)
      resolve({
        buffer: dataUrlToBuffer(jpegDataUrl),
        width: w,
        height: h,
      })
    }
    img.onerror = reject
    img.src = dataUrl
  })
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
//  PDF → AZW3 / MOBI（电子书）
// =========================================================================

/**
 * XML 转义（MOBI 文本是 XHTML，需转义 < > & 等）
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * PDF → AZW3 (.mobi)
 * 用 pdfjs 提取每页文本，转成 XHTML，用 mobiWriter 生成 MOBI6 格式电子书。
 * 输出 .azw3 扩展名（实际为 MOBI6 容器，Kindle 与 foliate-js 均可识别）。
 */
export async function pdfToAzw3(file, filename, onProgress = null) {
  const arrayBuffer = await file.arrayBuffer()
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  // 每页生成一段 XHTML，用 mbp:pagebreak 分页
  const chunks = []

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i)
    const textContent = await page.getTextContent()

    // 按 y 坐标分组为行，行内按 x 排序，得到有序文本
    const textItems = []
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue
      textItems.push({
        y: Math.round(item.transform[5]),
        x: item.transform[4],
        str: item.str,
      })
    }
    const lines = groupTextByLine(textItems)

    // 组装 XHTML 片段
    let html = `<h2 class="page-title">第 ${i} 页</h2>\n`
    for (const line of lines) {
      const trimmed = line.str.trim()
      if (trimmed) {
        html += `<p>${escapeXml(trimmed)}</p>\n`
      }
    }
    // 每页之间加分页符（最后一页不加）
    if (i < pdfDoc.numPages) {
      html += '<mbp:pagebreak/>\n'
    }
    chunks.push(html)

    if (onProgress) onProgress(i, pdfDoc.numPages)
  }

  const title = stripExt(file.name)
  const body = chunks.join('\n')
  const mobi = createMobi({ title, text: body })
  const blob = new Blob([mobi], { type: 'application/x-mobipocket-ebook' })
  downloadBlob(blob, `${title}.azw3`)
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
    await pdfToDocx(file, outName, onProgress)
  } else if (targetFormat === 'to-png') {
    const outName = file.name
    await pdfToPng(file, outName, onProgress)
  } else if (targetFormat === 'to-azw3') {
    const outName = `${baseName}.azw3`
    await pdfToAzw3(file, outName, onProgress)
  } else {
    throw new Error(`未知的转换目标: ${targetFormat}`)
  }
}
