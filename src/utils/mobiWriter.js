/**
 * MOBI/AZW3 生成器（纯浏览器端，零依赖）
 *
 * 生成 MOBI6 格式的电子书（PDB 容器 + PalmDOC 头 + MOBI 头 + 文本记录）。
 * Kindle 及 foliate-js 均可识别此格式。
 *
 * 结构参考：
 *   Record 0:   PalmDOC 头(16B) + MOBI 头 + 标题文本
 *   Record 1..N: 文本记录（UTF-8 XHTML，无压缩）
 *   Record N+1..: 资源记录（本生成器不产生）
 */

// ---------- 编码工具 ----------
const enc = new TextEncoder()

function writeUint16(buf, offset, value) {
  buf[offset] = (value >> 8) & 0xff
  buf[offset + 1] = value & 0xff
}

function writeUint32(buf, offset, value) {
  buf[offset] = (value >>> 24) & 0xff
  buf[offset + 1] = (value >>> 16) & 0xff
  buf[offset + 2] = (value >>> 8) & 0xff
  buf[offset + 3] = value & 0xff
}

function writeString(buf, offset, str, length) {
  const bytes = enc.encode(str)
  for (let i = 0; i < length; i++) {
    buf[offset + i] = i < bytes.length ? bytes[i] : 0x20 // 空格填充
  }
}

/**
 * 将文本按指定大小切分为记录数组（UTF-8 字节）
 * @param {string} text
 * @param {number} recordSize
 * @returns {Uint8Array[]}
 */
function splitRecords(text, recordSize) {
  const bytes = enc.encode(text)
  const records = []
  for (let i = 0; i < bytes.length; i += recordSize) {
    records.push(bytes.slice(i, i + recordSize))
  }
  // 至少要有一条记录
  if (records.length === 0) records.push(new Uint8Array(0))
  return records
}

/**
 * 生成 MOBI6 电子书二进制
 *
 * @param {Object} opts
 * @param {string} opts.title - 书名
 * @param {string} opts.text - XHTML 正文（含 <mbp:pagebreak/> 分页标记）
 * @returns {Uint8Array} 完整 .azw3/.mobi 二进制
 */
export function createMobi(opts) {
  const { title = 'Untitled', text = '' } = opts

  // ---------- 1. 准备文本记录 ----------
  const RECORD_SIZE = 4096
  const records = splitRecords(text, RECORD_SIZE)
  const numTextRecords = records.length

  // ---------- 2. 计算 MOBI 头尺寸 ----------
  const titleBytes = enc.encode(title)
  const MOBI_HEADER_SIZE = 232 // MOBI 头长度（不含 PalmDOC 头）
  // titleOffset 是相对 record 0 起点的偏移 = 16(PalmDOC) + 232(MOBI头)
  const titleOffset = 16 + MOBI_HEADER_SIZE
  const titleLength = titleBytes.length
  const record0Size = 16 + MOBI_HEADER_SIZE + titleLength // 对齐 4 字节
  const record0SizeAligned = Math.ceil(record0Size / 4) * 4

  // ---------- 3. 计算 PDB 布局 ----------
  // 记录偏移表
  const numRecords = 1 + numTextRecords
  const pdbHeaderSize = 78 + numRecords * 8
  const recordOffsets = []
  let currentOffset = pdbHeaderSize

  recordOffsets.push(currentOffset)
  currentOffset += record0SizeAligned

  for (let i = 0; i < numTextRecords; i++) {
    recordOffsets.push(currentOffset)
    currentOffset += records[i].length
  }

  // ---------- 4. 组装二进制 ----------
  const totalSize = currentOffset
  const buf = new Uint8Array(totalSize)

  // ---- PDB 头 ----
  writeString(buf, 0, title.slice(0, 31), 32) // name
  writeUint32(buf, 60, 0x424f4f4b) // type = 'BOOK'
  writeUint32(buf, 64, 0x4d4f4249) // creator = 'MOBI'
  writeUint16(buf, 76, numRecords)

  // 记录偏移表
  for (let i = 0; i < numRecords; i++) {
    writeUint32(buf, 78 + i * 8, recordOffsets[i])
    // 属性字节在 +4，置 0
  }

  // ---- Record 0: PalmDOC + MOBI 头 ----
  const r0 = recordOffsets[0]
  // PalmDOC 头 (16 字节)
  writeUint16(buf, r0 + 0, 1) // compression = 1 (无压缩)
  writeUint32(buf, r0 + 4, text.length) // textLength (原始字符数)
  writeUint16(buf, r0 + 8, numTextRecords) // numTextRecords
  writeUint16(buf, r0 + 10, RECORD_SIZE) // recordSize
  writeUint16(buf, r0 + 12, 0) // encryption = 0
  writeUint16(buf, r0 + 14, 0) // 未知/保留

  // MOBI 头 (从 r0+16 开始)
  const m = r0 + 16
  writeString(buf, m + 0, 'MOBI', 4) // magic
  writeUint32(buf, m + 4, MOBI_HEADER_SIZE) // length
  writeUint32(buf, m + 8, 2) // type = 2 (BOOKMARK)
  writeUint32(buf, m + 12, 65001) // encoding = UTF-8
  writeUint32(buf, m + 16, 0x12345678) // uid (随机即可)
  writeUint32(buf, m + 20, 6) // version = 6 (MOBI6)
  writeUint32(buf, m + 24, 0) // ortho 索引
  writeUint32(buf, m + 28, 0) // infl 标志
  writeUint32(buf, m + 32, 0) // title 为空（标题在 EXTH）
  writeUint32(buf, m + 68, 0) // 未知
  // 实际 titleOffset 字段在偏移 84 处（MOBI 头内），foliate-js 从 84 读取

  // MOBI 头字段（相对 record 0 起点的偏移）
  writeUint32(buf, r0 + 84, titleOffset) // titleOffset
  writeUint32(buf, r0 + 88, titleLength) // titleLength

  // 语言字段（相对 record 0 起点）
  buf[r0 + 94] = 0 // localeRegion
  buf[r0 + 95] = 4 // localeLanguage = zh

  // 其他字段保持 0（如 resourceStart, huffcdic 等）

  // ---- 标题文本（写在 record 0 的 MOBI 头之后） ----
  for (let i = 0; i < titleBytes.length; i++) {
    buf[r0 + 16 + MOBI_HEADER_SIZE + i] = titleBytes[i]
  }

  // ---- 文本记录 ----
  for (let i = 0; i < numTextRecords; i++) {
    buf.set(records[i], recordOffsets[1 + i])
  }

  return buf
}

/**
 * 便捷函数：直接下载生成的电子书
 * @param {string} title
 * @param {string} text
 * @param {string} filename
 */
export function downloadMobi(title, text, filename) {
  const buf = createMobi({ title, text })
  const blob = new Blob([buf], { type: 'application/x-mobipocket-ebook' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}