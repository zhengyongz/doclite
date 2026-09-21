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
      lines.push({
        y: lastY,
        str: currentLine.map(t => t.str).join(''),
        size: Math.max(...currentLine.map(t => t.size || 0)),
        x: Math.min(...currentLine.map(t => t.x ?? 1e9)),
      })
      currentLine = [item]
      lastY = item.y
    }
  }
  if (currentLine.length > 0) {
    currentLine.sort((a, b) => (a.x || 0) - (b.x || 0))
    lines.push({
      y: lastY,
      str: currentLine.map(t => t.str).join(''),
      size: Math.max(...currentLine.map(t => t.size || 0)),
      x: Math.min(...currentLine.map(t => t.x ?? 1e9)),
    })
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
            y: args[1] || 0, // transform 的 y（图片左上角，PDF 坐标系 y 向上）
            x: args[0] || 0,
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
            y: args[1] || 0,
            x: args[0] || 0,
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

/** 图片对象 → JPEG Uint8Array（控制体积，maxWidth 缩放） */
async function imageToJpegBytes(dataUrl, maxWidth = 900, quality = 0.75) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = dataUrl
  })
  const scale = Math.min(1, maxWidth / img.width)
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const jpegUrl = canvas.toDataURL('image/jpeg', quality)
  return { bytes: dataUrlToBuffer(jpegUrl), width: w, height: h }
}

/**
 * 判断一行文本是否为章节标题（启发式）
 * 目标：识别"第X章""第X节""推荐序""后记"等真正的章节标题，
 *       排除正文长句、单字残句、页码等误判。
 * 规则优先级（从上到下）：
 * 1. 明确的章节/结构标题（第X章/节/卷/部，推荐序、后记等）→ 是
 * 2. 过短（<3 字，非上述模式）→ 否（避免"从""在""艾"单字误判）
 * 3. 含句末标点/句中逗号冒号等 → 否（正文句子特征）
 * 4. 超长（>30 字）→ 否
 * 5. 字号显著偏大（>18）且 ≤ 20 字 → 是（正文大标题）
 */
function looksLikeHeading(line) {
  const s = line.str.trim()
  if (!s) return false
  const len = s.length

  // 纯数字/页码/装饰符号
  if (/^[\d\s·.—-]+$/.test(s)) return false

  // 明确的章节/结构标题（无论字号）
  if (/^第[一二三四五六七八九十百千万\d]+[章节卷部篇]/.test(s)) return true
  if (/^(推荐序|自序|代序|序言|前言|写在前面|楔子|引言|导言|目录|后记|尾声|附录|跋|结语|致谢|鸣谢)$/.test(s)) return true

  // 常见"小节标题"排除词表：这类是正文内的小节/栏目名，不应进目录。
  // 观察 PDF 常见版式：章节后有「故事引申」「现实链接」等栏目块，
  // 以及「消费贷款」「应急贷款」等小节标题，字号偏大但非章节。
  if (/^(故事引申|现实链接|消费贷款|应急贷款|心灵感悟|人生启示|思维拓展|延伸阅读|知识链接|背景知识|延伸思考|课堂讨论|本章小结|本章回顾|阅读思考|互动环节|小组讨论|情景再现)$/.test(s)) return false

  // 过短：单字/双字残句排除（除上述明确标题外）
  if (len < 3) return false

  // 正文句子特征：含句号、逗号、冒号、分号、问号等标点
  if (/[。，：；、？!！?？]/.test(s)) return false

  // 超长
  if (len > 30) return false

  // 字号显著偏大（PDF 正文标题特征）
  if (line.size && line.size > 16 && len <= 20) return true

  return false
}

/**
 * 判断是否为"章节标题后的英文副标题"。
 * 典型如原书封面副标题：HOW AN ECONOMY GROWS AND WHY IT CRASHES
 * 这类行紧跟 <h3> 之后，文石阅读器会把它误识别为章节名显示在目录/页眉，
 * 故需要隐藏处理（避免文石把英文副标题当章节节点）。
 * 判定条件：无中文、含英文字母、绝大多数大写、无句末标点、长度 5..60。
 */
function looksLikeEnglishSubtitle(s) {
  if (!s || s.length < 5 || s.length > 60) return false
  if (/[\u4e00-\u9fff]/.test(s)) return false // 无中文
  if (!/[A-Za-z]/.test(s)) return false // 含英文字母
  if (/[。！？；，：!?;,:]/.test(s)) return false // 无句末/句中标点
  const upper = (s.match(/[A-Z]/g) || []).length
  const letters = (s.match(/[A-Za-z]/g) || []).length
  if (letters === 0) return false
  return upper / letters >= 0.7 // 绝大多数大写
}

/**
 * PDF → AZW3 (.mobi)
 * 用 pdfjs 提取每页文本和图片，按位置排列，转成 XHTML，
 * 用 mobiWriter 生成 MOBI6 格式电子书（含图片资源与章节目录）。
 * 输出 .azw3 扩展名（实际为 MOBI6 容器，Kindle 与 foliate-js 均可识别）。
 */
export async function pdfToAzw3(file, filename, onProgress = null) {
  const arrayBuffer = await file.arrayBuffer()
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pageChunks = []   // 每页的 XHTML 片段
  const images = []       // 资源图片 [{ data: Uint8Array, width, height }]

  // 逐页处理
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i)
    const viewport = page.getViewport({ scale: 1.0 })
    const pageWidth = viewport.width
    const pageHeight = viewport.height

    // ---- 文字行 ----
    const textContent = await page.getTextContent()
    const textItems = []
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue
      textItems.push({
        y: Math.round(item.transform[5]),
        x: item.transform[4],
        str: item.str,
        size: item.height || 0,
      })
    }
    const textLines = groupTextByLine(textItems)

    // ---- 图片 ----
    const imageItems = await extractPageImages(page)
    const imageRefs = []
    for (const img of imageItems) {
      try {
        const { bytes, width, height } = await imageToJpegBytes(img.dataUrl)
        const recindex = images.length + 1
        images.push({ data: bytes, width, height })
        imageRefs.push({
          y: img.y,
          x: img.x,
          recindex,
          width,
          height,
          pageWidth,
          pageHeight,
        })
      } catch (e) {
        console.warn(`[pdfToAzw3] 图片提取失败 (page ${i}):`, e)
      }
    }

    // ---- 合并文字与图片，按 y 从大到小排列 ----
    const allItems = [
      ...textLines.map(l => ({ type: 'text', y: l.y, x: l.x, str: l.str, size: l.size })),
      ...imageRefs.map(img => ({ type: 'image', y: img.y, x: img.x, ...img })),
    ]
    allItems.sort((a, b) => b.y - a.y)

    // ---- 组装 XHTML ----
    // 段落合并策略：连续的非标题文本行合并到同一个 <p> 内（用空格连接），
    // 使阅读器把整段当作一个段落渲染、文字自然排满行宽；
    // 标题（<h3>）与图片会断开段落。行内末尾若本身以句号结尾，
    // 说明原文该处是独立短句，保留换行语义（用 <br/> 连接）。
    let html = ''
    let para = [] // 当前段落收集的行
    let subtitleLines = null // 章节标题后连续英文副标题行的收集器
    const flushPara = () => {
      if (para.length > 0) {
        html += `<p>${para.map(t => escapeXml(t)).join(' ')}</p>\n`
        para = []
      }
    }
    const flushSubtitle = () => {
      if (subtitleLines && subtitleLines.length > 0) {
        // 章节标题后的英文副标题：直接丢弃，不输出任何 HTML。
        // 原因：display:none 只对 Web 内核生效，文石阅读器会扫描纯文本流，
        // 把大写英文行误识别为章节名显示在目录/页眉（实测复现）。
        // 彻底移除这些行，避免任何设备把副标题当章节节点。
        subtitleLines = null
      }
    }
    /** 从行内剔除尾部英文大写副标题（如"中岛帝国：远方的生命线 HOW AN ECONOMY..."），
     * 返回剔后剩余文本；若整行都是副标题返回空串 */
    const stripEnglishSubtitleTail = (s) => {
      // 匹配：行尾的大写英文短语（≥ 5 字符，且全大写字母/空格）
      const m = s.match(/\s+([A-Z][A-Z\s'&:]{4,})\s*$/)
      if (m && looksLikeEnglishSubtitle(m[1].trim())) return s.slice(0, m.index).trim()
      return s
    }
    for (const item of allItems) {
      if (item.type === 'text') {
        let trimmed = item.str.trim()
        if (!trimmed) continue
        // PDF 版式问题：个别行是「中文章节名 + 英文副标题」写在同一物理行
        // （如"中岛帝国：远方的生命线 HOW AN ECONOMY..."），副标题独立行方案
        // （looksLikeEnglishSubtitle）不匹配含中文的行，需先剔除尾部英文尾巴
        trimmed = stripEnglishSubtitleTail(trimmed)
        if (!trimmed) continue
        if (looksLikeHeading(item)) {
          flushPara()
          flushSubtitle()
          html += `<h3>${escapeXml(trimmed)}</h3>\n`
          subtitleLines = [] // 开始收集可能的英文副标题
        } else if (subtitleLines !== null && looksLikeEnglishSubtitle(trimmed)) {
          // 标题后连续的大写英文行：并入副标题收集器（整组丢弃）
          subtitleLines.push(trimmed)
        } else {
          flushSubtitle()
          subtitleLines = null
          para.push(trimmed)
        }
      } else if (item.type === 'image') {
        flushPara()
        flushSubtitle()
        subtitleLines = null
        // 图片按页面宽度比例缩放到 100%
        html += `<p class="ebook-img"><img recindex="${item.recindex}" width="100%" alt=""/></p>\n`
      }
    }
    flushPara()
    flushSubtitle()

    // 检测是否为目录页（包含"目录""目  录"等关键词，且文本较短）
    const pageText = textLines.map(l => l.str).join('').trim()
    // 目录页判定：
    // 1. 起始页：以"目录"开头且总字符 < 200
    // 2. 后续页：若上一页是目录页，且本页所有行都是短行（≤ 25 字符，无长句正文）
    //    —— 因为目录经常跨多页，后续页以章节标题行开头，不以"目录"开头
    const isTocStart = /^(目\s*录|Table\s*of\s*Contents|Contents)/i.test(pageText)
      && pageText.length < 200
    const prevIsToc = pageChunks.length > 0 && pageChunks[pageChunks.length - 1].isTocPage
    const isTocContinuation = prevIsToc
      && textLines.length > 0
      && textLines.every(l => l.str.trim().length > 0 && l.str.trim().length <= 25)
      && textLines.every(l => !/[。！？；]$/.test(l.str.trim()))
      && !/^(目\s*录)$/i.test(pageText.trim())
    const isTocPage = isTocStart || isTocContinuation
    pageChunks.push({ pageIndex: i, html, isTocPage, textLines: textLines.map(l => l.str.trim()) })

    if (onProgress) onProgress(i, pdfDoc.numPages)
  }

  // ---------- 构建正文（跳过原始目录页，保留位置标记） ----------
  // 每页之间用 <mbp:pagebreak/> 分隔
  const enc2 = new TextEncoder()
  const pageBreakTag = '<mbp:pagebreak/>\n'

  // 找到所有原始目录页位置（目录可能跨多页）
  const tocPageIndices = pageChunks
    .map((c, i) => c.isTocPage ? i : -1)
    .filter(i => i >= 0)
  const tocPageIndex = tocPageIndices.length > 0 ? tocPageIndices[0] : -1

  // 构建各页的字节范围映射（不含目录页内容，但保留占位）
  const pageByteRanges = []  // {pageIndex, start, end, isTocSlot}
  const TOC_PLACEHOLDER = '__TOC_PLACEHOLDER__'
  const PLACEHOLDER_LEN = enc2.encode(TOC_PLACEHOLDER).length
  let acc = 0
  const parts = []  // 临时片段数组
  for (let pi = 0; pi < pageChunks.length; pi++) {
    const crop = pageChunks[pi]
    if (tocPageIndices.includes(pi)) {
      // 原始目录页：仅第一个占位符保留（用于插入完整目录页），
      // 后续目录续页直接置空，避免电子书中出现重复目录
      pageByteRanges.push({ pageIndex: pi, start: acc, isTocSlot: true })
      if (pi === tocPageIndices[0]) {
        parts.push(TOC_PLACEHOLDER)
        acc += PLACEHOLDER_LEN
      }
    } else {
      pageByteRanges.push({ pageIndex: pi, start: acc, isTocSlot: false })
      parts.push(crop.html)
      acc += enc2.encode(crop.html).length
    }
    // 目录续页（非首个）后面不插 pagebreak，避免产生空页
    const skipBreak = tocPageIndices.includes(pi) && pi !== tocPageIndices[0]
    if (pi < pageChunks.length - 1 && !skipBreak) {
      parts.push(pageBreakTag)
      acc += enc2.encode(pageBreakTag).length
    }
  }
  let bodyText = parts.join('')

  // ---------- 识别标题并计算 filepos ----------
  // filepos 是相对「第一条文本记录起点」的字节偏移。
  // 重要：filepos 必须基于「最终拼接文本」的真实字节偏移计算。
  // 旧方案在替换前的 bodyText 上计算，再叠加占位符增量与 GUIDE_LEN 修正，
  // 但目录页替换会使偏移推算与实际文本偏差，导致 filepos 错位，
  // foliate 插入锚点时会切断 <img>、</p> 等标签，破坏 HTML 结构
  // （表现为标签脚本泄露、文字折行、排版混乱）。
  // 新方案：先用与真实目录页等长的「占位目录页」替换占位符，得到最终形态的
  // 临时正文，直接在临时正文上扫描 <h3> 的真实字节偏移，保证精确。

  // 1. 先扫描标题名（不依赖偏移），用于构建等长的占位目录页
  const scanHeadingTitles = (text) => {
    const result = []
    const re = /<h3>([^<]+)<\/h3>/g
    let mm
    while ((mm = re.exec(text)) !== null) result.push(mm[1])
    return result
  }
  let headingTitles = scanHeadingTitles(bodyText)

  // 如果正文没有标题，用「第 N 页」作为回退目录标题
  if (headingTitles.length === 0) {
    headingTitles = []
    for (let pi = 0; pi < pageChunks.length; pi++) {
      if (tocPageIndices.includes(pi)) continue // 跳过原始目录页
      headingTitles.push(`第 ${pi + 1} 页`)
    }
  }

  // 2. 构建占位目录页（filepos 全部为 0，与真实目录页结构/长度完全一致）
  //    用它替换占位符，得到与最终形态等长的临时正文，用于精确测量偏移
  const buildTocPage = (list) => {
    const items = list
      .map(h => `<a filepos="${String(h.filepos).padStart(10, '0')}">${escapeXml(h.title)}</a>`)
      .join('<br/>\n')
    // 目录页是正文 <body> 内的一段，不能包含 <html>/<head>/<body> 包裹，
    // 否则会形成嵌套 HTML 导致 Kindle/文石解析器出错
    return `<h1>目录</h1>\n${items}\n<mbp:pagebreak/>\n`
  }

  const placeholderToc = buildTocPage(headingTitles.map(t => ({ title: t, filepos: 0 })))
  const tocLen = enc2.encode(placeholderToc).length
  const tmpBody = bodyText.replaceAll(TOC_PLACEHOLDER, placeholderToc)

  // 3. 在临时正文上扫描 <h3> 的真实字节偏移（目录页用 <h1>，不会被匹配）
  const scanHeadings = (text) => {
    const result = []
    const re = /<h3>([^<]+)<\/h3>/g
    let mm
    while ((mm = re.exec(text)) !== null) {
      result.push({
        title: mm[1],
        filepos: enc2.encode(text.slice(0, mm.index)).length,
      })
    }
    return result
  }

  let headings = scanHeadings(tmpBody)

  // 回退目录：基于临时正文逐页计算偏移（跳过原始目录页）
  if (headings.length === 0) {
    headings = []
    for (let pi = 0; pi < pageChunks.length; pi++) {
      if (tocPageIndices.includes(pi)) continue
      const range = pageByteRanges[pi]
      const beforeCount = tocPageIndices.filter(idx => pageByteRanges[idx].start <= range.start).length
      headings.push({
        title: `第 ${pi + 1} 页`,
        filepos: range.start + beforeCount * (tocLen - PLACEHOLDER_LEN),
      })
    }
  }

  // 4. 所有正文偏移 + GUIDE_LEN（最终文本头部有 guide 前缀），构建真实目录页
  // 注意：<guide> 不能放在目录页内！foliate-js 的 getGuide() 只从
  // sections[0]（第一条文本记录，即第一个 <mbp:pagebreak/> 之前）读取 <reference>。
  // 因此 <guide> 需注入到正文最前（与封面同处 section 0），
  // filepos 指向目录页在拼接文本中的真实字节偏移。
  // guide 前缀作为 HTML 文档开头：<html><head><guide>...</head><body> 包裹正文，
  // 使第一条文本记录成为完整 HTML 文档（Kindle 解析器要求），
  // 正文末尾由 mobiWriter 统一补 </body></html>。
  // reference 闭合斜杠前必须有空格（calibre serializer 原注释：
  // "Space required or won't work, I kid you not"），Kindle 对 <reference .../> 
  // 无空格闭合解析可能失败。
  const buildGuidePrefix = (filepos) =>
    `<html><head><guide><reference type="toc" title="目录" filepos="${String(filepos).padStart(10, '0')}" /></guide></head><body>\n`
  const GUIDE_LEN = enc2.encode(buildGuidePrefix(0)).length

  const finalHeadings = headings.map(h => ({ ...h, filepos: h.filepos + GUIDE_LEN }))
  const tocPage = buildTocPage(finalHeadings)

  // 目录页在最终文本中的真实偏移：临时正文中第一个 <h1>目录</h1> 的字节偏移 + GUIDE_LEN
  const firstTocOffsetInBody = tmpBody.indexOf('<h1>目录</h1>')
  const tocFilepos = (firstTocOffsetInBody >= 0
    ? enc2.encode(tmpBody.slice(0, firstTocOffsetInBody)).length
    : 0) + GUIDE_LEN

  // 用实际目录页替换所有目录占位符，并注入 guide 前缀（与封面同 section 0）
  let finalText = bodyText.replaceAll(TOC_PLACEHOLDER, tocPage)
  if (tocPageIndex >= 0) {
    finalText = buildGuidePrefix(tocFilepos) + finalText
  }
  const title = stripExt(file.name)
  // NCX 目录：与目录页 filepos 一致（finalHeadings 已含 GUIDE_LEN 偏移），
  // 供 Kindle/文石解析器读取章节目录（避免文石把英文副标题当章节节点）。
  const ncx = finalHeadings.map(h => ({ title: h.title, offset: h.filepos }))
  const mobi = createMobi({ title, text: finalText, images, metadata: { creator: 'DocLite 生成' }, ncx })
  const blob = new Blob([mobi], { type: 'application/x-mobipocket-ebook' })
  // 方案A：内容为 MOBI6，扩展名用 .mobi（文石/Kindle 识别 MOBI6 需 .mobi 扩展名）
  downloadBlob(blob, `${title}.mobi`)
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
    const outName = `${baseName}.mobi`
    await pdfToAzw3(file, outName, onProgress)
  } else {
    throw new Error(`未知的转换目标: ${targetFormat}`)
  }
}
