/**
 * MOBI/AZW3 生成器（纯浏览器端，零依赖）
 *
 * 生成 MOBI6 格式的电子书（PDB 容器 + PalmDOC 头 + MOBI 头 + EXTH + 文本记录 + 图片资源）。
 * Kindle 及 foliate-js 均可识别此格式。
 *
 * 结构参考（对齐 calibre 输出）：
 *   Record 0:     PalmDOC 头(16B) + MOBI 头(232B) + EXTH 块 + 标题文本
 *   Record 1..N:  文本记录（PalmDOC LZ77 压缩 + multibyte overlap + TBS trailing）
 *   Record N+1:   NCX 索引记录（INDX/IDXT/CNCX，若有 ncx）
 *   之后:         资源记录（图片，正文通过 <img recindex="i"> 引用）
 *   末尾:         FLIS + FCIS + end-of-file 三条固定记录
 */

// ---------- 编码工具 ----------
const enc = new TextEncoder()

/** 生成随机 uuid v4 字符串（EXTH 113 ASIN / 112 source 用，无 crypto 环境也可用） */
function generateUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try { return crypto.randomUUID() } catch { /* fallthrough */ }
  }
  // 手写 v4：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx（y ∈ 8/9/a/b）
  const h = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-'
    else if (i === 14) out += '4'
    else if (i === 19) out += h[(Math.random() * 4 | 0) + 8]
    else out += h[Math.random() * 16 | 0]
  }
  return out
}

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
 * 将文本按 4096 字节精确切分为记录数组（对齐 calibre create_text_record）。
 *
 * calibre 策略：每条记录严格 4096 字节（最后一条可能更短），
 * 不回退到字符边界——若切分点落在多字节 UTF-8 字符中间，
 * 被截断的尾部字节作为 overlap 返回，追加到本条记录尾部（不压缩），
 * 同时在下一条记录开头重复出现（参与压缩）。
 *
 * trailing bytes 结构（每条记录末尾）：
 *   1. overlap_bytes + 1字节 count（multibyte trailing，extra_data_flags bit 0）
 *   2. TBS 数据 + backward-varint size（索引 trailing，extra_data_flags bit 1）
 *
 * @param {string} text
 * @param {number} recordSize (4096)
 * @returns {{ records: Uint8Array[], overlaps: number[] }}
 *          records[i] = 精确 4096 的未压缩文本切片（不含 trailing）
 *          overlaps[i] = 第 i 条记录末尾被截断的多字节字符的额外字节数
 */
function splitRecords(text, recordSize) {
  const bytes = enc.encode(text)
  const records = []
  const overlaps = []
  let start = 0
  while (start < bytes.length) {
    let end = Math.min(start + recordSize, bytes.length)
    // 检查 end 位置是否落在多字节字符中间
    // UTF-8 续字节：10xxxxxx (0x80-0xBF)
    // 如果 bytes[end] 是续字节，说明前一个字符的首字节在 end 之前
    let overlap = 0
    if (end < bytes.length) {
      // 向前查找：找到当前截断处所属字符的首字节
      // 续字节范围 0x80-0xBF
      let checkPos = end - 1
      while (checkPos >= start && (bytes[checkPos] & 0xC0) === 0x80) {
        checkPos--
      }
      // 现在 bytes[checkPos] 是字符首字节
      if (checkPos >= start) {
        const lead = bytes[checkPos]
        // 计算字符完整长度：
        // 11110xxx -> 4 bytes, 1110xxxx -> 3 bytes, 110xxxxx -> 2 bytes
        let charLen = 1
        if ((lead & 0xF8) === 0xF0) charLen = 4
        else if ((lead & 0xF0) === 0xE0) charLen = 3
        else if ((lead & 0xE0) === 0xC0) charLen = 2

        // 如果这个字符跨越了 end，overlap = 从 end 到字符末尾的字节数
        if (checkPos + charLen > end) {
          overlap = (checkPos + charLen) - end
        }
      }
    }
    // overlap 字节来自下一条记录开头（它们在下条记录中重复出现）
    // 本记录的数据是 bytes[start..end]，overlap 字节 bytes[end..end+overlap]
    // 但 overlap 字节不参与压缩——它们作为 trailing bytes 追加到压缩后的数据末尾
    records.push(bytes.slice(start, end))
    overlaps.push(overlap)
    start = end
  }
  if (records.length === 0) {
    records.push(new Uint8Array(0))
    overlaps.push(0)
  }
  return { records, overlaps }
}

// ---------- NCX / INDX 索引生成 ----------
// 参考 kindlegen 输出的 INDX/IDXT/CNCX 记录布局。
// 结构（foliate-js getIndexData/getNCX 可解析）：
//   主 INDX 记录: 192B INDX 头 + TAGX(32B) + IDXT 指针块(16B)
//   IDXT 记录:    192B INDX 头 + 条目数据 + 'IDXT' + 2B*N 偏移表
//   CNCX 记录:    [varint 长度 + UTF-8 标题]* 连续拼接
// 条目 tag: tag1=offset(文件字节偏移) tag2=size tag3=CNCX索引 tag4=headingLevel

/** 编码 varint（大端 7bit 组，最后一个字节 bit7 置位，与 foliate getVarLen 互逆） */
function encodeVarint(value) {
  const groups = []
  let v = Math.floor(value)
  do {
    groups.push(v & 0x7f)
    v = Math.floor(v / 128)
  } while (v > 0)
  const bytes = []
  for (let i = groups.length - 1; i >= 0; i--) {
    bytes.push(i === 0 ? (groups[i] | 0x80) : groups[i])
  }
  return bytes
}

/**
 * PalmDOC LZ77 压缩（compression=2，与 calibre/MobiPocket Creator 一致）
 *
 * 编码规则（与 foliate-js decompressPalmDOC 互逆）：
 *   0x00           -> 字面量 0
 *   0x01..0x08     -> 后随 1..8 个字节原样复制
 *   0x09..0x7f     -> 字面量（本身即字节值）
 *   0x80..0xbf     -> 长度-距离对：低 14 位中，高 11 位为距离(0..2047，实际距离=值+1)，低 3 位+3 为长度(3..10)
 *   0xc0..0xff     -> 空格 + (byte & 0x7f)
 *
 * 压缩策略：每条文本记录独立压缩（与 kindlegen 一致，记录间无跨窗口匹配）。
 * 滑动窗口 2048，贪心最长匹配；匹配长度 ≥3 才回引。
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
function lz77Compress(input) {
  const out = []
  const n = input.length
  const MIN_MATCH = 3
  const MAX_MATCH = 10
  // 距离编码上限：foliate 解码 distance = (bytes & 0x3fff) >>> 3，11 位，最大 2047
  const WINDOW = 2047
  const hash3 = (i) => ((input[i] << 16) | (input[i + 1] << 8) | input[i + 2]) >>> 0
  const hashTable = new Map()

  // 字面量输出（对齐 calibre py_compress_doc 的二进制 run + 空格码策略）。
  // 旧实现（v5）对每个 >0x7f 字节（CJK UTF-8 全是）逐字节发 0x01+byte（永不批量），
  // 80824 个 count=1 批量码 vs calibre 仅 21005 个，导致个别记录压缩后超过 4096
  // （v5 记录 #60 达 4135），Kindle 按 4096 输入缓冲截断读取致解压损坏，
  // 恰好 3 个 <mbp:pagebreak/> 变 "eak/>" 碎片。故：
  //  1) 二进制字节（1..8 与 0x80..0xff）连续收集，最多 8 个一批发 [count][bytes]；
  //  2) 空格后跟 0x40..0x7f 时发 0xc0|byte 空格码；
  //  3) 0x09..0x7f 单字节直写；0x00 单独直写。
  const isPlainLiteral = (b) => b === 0 || (b > 8 && b < 0x80)
  // 返回本次消费的输入字节数（1 = 单字节直写；run = 批量二进制）
  const emitLiterals = (start) => {
    const b = input[start]
    if (isPlainLiteral(b)) {
      out.push(b)
      return 1
    }
    // 连续收集二进制字节（非 plain literal），最多 8 个一批（对齐 calibre binseq 逻辑）
    let run = 1
    while (start + run < n && run < 8 && !isPlainLiteral(input[start + run])) run++
    out.push(run)
    for (let r = 0; r < run; r++) out.push(input[start + r])
    return run
  }
  // 记录位置到哈希表（仅保留窗口内的最近位置）
  const addHash = (pos) => {
    if (pos + MIN_MATCH > n) return
    const key = hash3(pos)
    let arr = hashTable.get(key)
    if (!arr) { arr = []; hashTable.set(key, arr) }
    arr.push(pos)
    // 修剪过期位置（保持窗口上限）
    if (arr.length > 64) {
      const cutoff = pos - WINDOW
      while (arr.length && arr[0] <= cutoff) arr.shift()
    }
  }

  let i = 0
  while (i < n) {
    let bestLen = 0
    let bestDist = 0
    if (i + MIN_MATCH <= n) {
      const candidates = hashTable.get(hash3(i))
      if (candidates) {
        // 从后往前（最近优先）
        for (let ci = candidates.length - 1; ci >= 0; ci--) {
          const pos = candidates[ci]
          const dist = i - pos
          if (dist > WINDOW) break // 位置升序，更早的会更远
          if (dist < 2) continue // 距离编码最小 1（编码值 0 无效）
          const maxLen = Math.min(MAX_MATCH, n - i)
          let len = 0
          while (len < maxLen && input[pos + len] === input[i + len]) len++
          if (len > bestLen) { bestLen = len; bestDist = dist }
          if (bestLen >= MAX_MATCH) break
        }
      }
    }
    if (bestLen >= MIN_MATCH) {
      // 距离对：distance 编码值 = bestDist（解码端 distance = (bytes&0x3fff)>>>3 直接用，不 +1）
      // 编码：bytes = (dist << 3) | lenCode；b1 = 0x80 | (bytes >> 8)；b2 = bytes & 0xff
      const lenCode = bestLen - 3
      const bytes = (bestDist << 3) | lenCode
      const b1 = 0x80 | ((bytes >> 8) & 0x3f)
      const b2 = bytes & 0xff
      out.push(b1, b2)
      for (let j = i; j < i + bestLen; j++) addHash(j)
      i += bestLen
    } else {
      // 无匹配：先看空格码（0x20 后跟 0x40..0x7f 时发 0xc0|byte，解码端还原 ' '+byte）
      if (input[i] === 0x20 && i + 1 < n && input[i + 1] >= 0x40 && input[i + 1] < 0x80) {
        out.push(0xc0 | input[i + 1])
        addHash(i)
        addHash(i + 1)
        i += 2
        continue
      }
      const consumed = emitLiterals(i)
      for (let j = i; j < i + consumed; j++) addHash(j)
      i += consumed
    }
  }
  return Uint8Array.from(out)
}

/** 拼接多个 Uint8Array */
function concatBytes(arrays) {
  let total = 0
  for (const a of arrays) total += a.length
  const out = new Uint8Array(total)
  let p = 0
  for (const a of arrays) {
    out.set(a, p)
    p += a.length
  }
  return out
}

/**
 * 编码 trailing data entry：<data><backward-varint size>
 * size = 整个 trailing entry 的长度（包括 size 本身的字节数）
 * backward-encoded varint：最高有效字节的 bit7 置位（不是最低有效字节）
 * 参考 calibre encode_trailing_data / mobileread wiki
 * @param {number[]|Uint8Array} data - trailing data 的原始字节
 * @returns {number[]}
 */
function encodeTrailingData(data) {
  const dataArr = Array.from(data)
  let lsize = 1
  while (true) {
    // 计算总长度 = data 长度 + lsize
    const total = dataArr.length + lsize
    // 将 total 编码为 backward varint
    const groups = []
    let v = total
    do {
      groups.push(v & 0x7f)
      v = Math.floor(v / 128)
    } while (v > 0)
    // backward: MSB 的 bit7 置位
    const encoded = []
    for (let i = 0; i < groups.length; i++) {
      encoded.push(i === 0 ? (groups[i] | 0x80) : groups[i])
    }
    if (encoded.length === lsize) {
      return dataArr.concat(encoded)
    }
    lsize++
  }
}

/**
 * 计算 NCX 条目在文本记录中的分布，生成每条记录的 TBS（Trailing Byte Sequence）。
 *
 * TBS 告诉 Kindle 每条文本记录包含哪些 NCX 目录条目。
 * 这是 Kindle 目录功能正常工作的关键——没有 TBS，
 * Kindle 固件无法把记录映射到目录条目。
 *
 * 简化版 TBS（对齐 calibre book_tbs 的 "单条目跨度" 模式）：
 *   当某条记录完全被一个 NCX 条目覆盖时：
 *   encode_tbs(entry_index, {0b010: 0, 0b001: 0}, flag_size=3)
 *   当某条记录包含条目边界时：encode_tbs(first_index, {0b010: 0}, flag_size=3)
 *
 * @param {Array<{title, offset, size, headingLevel}>} ncxItems - NCX 条目
 * @param {number} numTextRecords - 文本记录总数
 * @param {number} recordSize - 记录大小 (4096)
 * @returns {number[][]} 每条记录的 TBS 原始字节（不含 trailing size 编码）
 */
function buildTBSForRecords(ncxItems, numTextRecords, recordSize) {
  if (!ncxItems || ncxItems.length === 0) {
    return new Array(numTextRecords).fill(null).map(() => [])
  }

  // 为每个 NCX 条目计算它覆盖的记录范围
  // offset 是相对第一条文本记录起点的字节偏移
  // 每条记录覆盖 [recStart, recStart+recordSize) 的字节范围
  // （最后一条可能更短）
  const tbsList = new Array(numTextRecords).fill(null).map(() => [])

  // encode_fvwi: val << flag_size | flags，然后 forward varint
  // 对齐 calibre encode_fvwi → encint(ans, forward=True)：高位在最后一字节
  function encodeFvwi(val, flags, flagSize) {
    const combined = (val << flagSize) | flags
    const groups = []
    let v = combined
    do {
      groups.push(v & 0x7f)
      v = Math.floor(v / 128)
    } while (v > 0)
    // forward varint：groups 按 LSB-first 构建，输出时反转，高位标记最后一字节
    const out = []
    for (let i = groups.length - 1; i >= 0; i--) {
      out.push(i === 0 ? (groups[i] | 0x80) : groups[i])
    }
    return out
  }

  function encodeTbs(val, extra, flagSize = 3) {
    let flags = 0
    for (const f in extra) flags |= parseInt(f)
    let ans = encodeFvwi(val, flags, flagSize)
    // bit 0b0010 -> 紧跟一个 encint
    if (extra['2'] != null) {
      ans = ans.concat(encodeVarint(extra['2']))
    }
    // bit 0b0100 -> 紧跟一个原始字节
    if (extra['4'] != null) {
      ans.push(extra['4'])
    }
    // bit 0b0001 -> 紧跟一个 encint
    if (extra['1'] != null) {
      ans = ans.concat(encodeVarint(extra['1']))
    }
    return ans
  }

  // 对齐 calibre book_tbs 逻辑（indexer.py L407-426）
  for (let rec = 0; rec < numTextRecords; rec++) {
    const recStart = rec * recordSize
    const recEnd = recStart + recordSize

    const starts = []
    const ends = []
    const completes = []
    let spanner = null

    for (let ni = 0; ni < ncxItems.length; ni++) {
      const item = ncxItems[ni]
      const itemStart = item.offset
      const itemEnd = item.offset + (item.size || 0)

      // 条目在记录之后开始 → 后续条目更远，跳出
      if (itemStart >= recEnd) break
      // 条目在记录之前结束 → 跳过
      if (itemEnd <= recStart) continue

      if (itemStart >= recStart) {
        // 条目在当前记录中开始
        if (itemEnd <= recEnd) {
          completes.push({ index: ni, offset: itemStart })
        } else {
          starts.push({ index: ni, offset: itemStart })
        }
      } else {
        // 条目在当前记录之前开始
        if (itemEnd <= recEnd) {
          ends.push({ index: ni, offset: itemStart })
        } else {
          // 条目跨越整个记录（spanner）
          spanner = { index: ni, offset: itemStart }
        }
      }
    }

    if (spanner) {
      tbsList[rec] = encodeTbs(spanner.index, { 0b010: 0, 0b001: 0 }, 3)
    } else if (completes.length === 0 && (
      (starts.length === 1 && ends.length === 0) ||
      (ends.length === 1 && starts.length === 0)
    )) {
      const node = starts.length > 0 ? starts[0] : ends[0]
      tbsList[rec] = encodeTbs(node.index, { 0b010: 0 }, 3)
    } else if (starts.length > 0 || ends.length > 0 || completes.length > 0) {
      const nodes = [...starts, ...completes, ...ends]
      nodes.sort((a, b) => a.index - b.index)
      tbsList[rec] = encodeTbs(nodes[0].index, { 0b010: 0, 0b100: nodes.length }, 3)
    } else {
      tbsList[rec] = []
    }
  }

  return tbsList
}

/** 生成 TAGX 段（固定 32 字节，5 个 tag：1/2/3/4 + end） */
function buildTAGX() {
  const buf = new Uint8Array(32)
  writeString(buf, 0, 'TAGX', 4)
  writeUint32(buf, 4, 32)
  writeUint32(buf, 8, 1) // numControlBytes
  // tag 条目: [tagID, numValues, mask, endFlag]
  buf[12] = 1; buf[13] = 1; buf[14] = 0x01; buf[15] = 0
  buf[16] = 2; buf[17] = 1; buf[18] = 0x02; buf[19] = 0
  buf[20] = 3; buf[21] = 1; buf[22] = 0x04; buf[23] = 0
  buf[24] = 4; buf[25] = 1; buf[26] = 0x08; buf[27] = 0
  buf[28] = 0; buf[29] = 0; buf[30] = 0x00; buf[31] = 1 // end flag
  return buf
}

/**
 * 生成 NCX 索引三记录（INDX / IDXT / CNCX）
 * @param {Array<{title: string, offset: number, size?: number, headingLevel?: number}>} items
 * @returns {Uint8Array[]} [indxRecord, idxtRecord, cncxRecord]
 */
function buildNcxRecords(items) {
  const count = items.length
  if (count === 0) return null

  // ---- CNCX 数据：varint 长度 + UTF-8 文本 ----
  // 注意：CNCX 记录不 pad，精确长度即可（pad 0x00 会被 foliate/设备解析为多余空条目）
  const cncxChunks = []
  const cncxOffsets = []
  let cncxPos = 0
  for (const item of items) {
    const titleBytes = enc.encode(item.title)
    cncxOffsets.push(cncxPos)
    cncxChunks.push(Uint8Array.from(encodeVarint(titleBytes.length)), titleBytes)
    cncxPos += encodeVarint(titleBytes.length).length + titleBytes.length
  }
  const cncxData = concatBytes(cncxChunks)

  // ---- IDXT 条目数据（从 192 开始） ----
  const entryArrays = []
  const entryOffsets = [] // 相对 IDXT 记录起点
  let entryPos = 192
  for (let i = 0; i < count; i++) {
    const item = items[i]
    const name = i.toString(16).toUpperCase().padStart(2, '0')
    const nameBytes = enc.encode(name)
    const tags = [
      Uint8Array.from(encodeVarint(item.offset)),
      Uint8Array.from(encodeVarint(item.size ?? 0)),
      Uint8Array.from(encodeVarint(cncxOffsets[i])),
      Uint8Array.from(encodeVarint(item.headingLevel ?? 0)),
    ]
    const entry = concatBytes([
      Uint8Array.from([nameBytes.length]),
      nameBytes,
      Uint8Array.from([0x0f]), // controlByte：4 个 tag 全部 inline 值
      ...tags,
    ])
    entryOffsets.push(entryPos)
    entryArrays.push(entry)
    entryPos += entry.length
  }
  const entryTotal = entryPos - 192
  // 'IDXT' 字符串位置（4 字节对齐）
  const idxtPos = Math.ceil((192 + entryTotal) / 4) * 4
  const idxtTotalLen = idxtPos + 4 + 2 * count
  const idxt = new Uint8Array(idxtTotalLen)
  writeString(idxt, 0, 'INDX', 4)
  writeUint32(idxt, 4, 192) // length
  writeUint32(idxt, 8, 0) // type
  writeUint32(idxt, 12, 1) // header type（calibre/kindlegen 双黄金均为 1；此前为 0，Kindle 目录不显示的高置信度原因）
  writeUint32(idxt, 16, 0) // 参考文件 IDXT[16]=0
  writeUint32(idxt, 20, idxtPos) // idxt → 'IDXT' 字符串
  writeUint32(idxt, 24, count) // numRecords（条目数）
  writeUint32(idxt, 28, 0xffffffff) // encoding（IDXT 记录无文本）
  writeUint32(idxt, 32, 0xffffffff) // language
  writeUint32(idxt, 36, 0) // total
  writeUint32(idxt, 40, 0) // ordt
  writeUint32(idxt, 44, 0) // ligt
  writeUint32(idxt, 48, 0) // numLigt
  writeUint32(idxt, 52, 0) // numCncx
  let p = 192
  for (const e of entryArrays) {
    idxt.set(e, p)
    p += e.length
  }
  writeString(idxt, idxtPos, 'IDXT', 4)
  for (let i = 0; i < count; i++) {
    writeUint16(idxt, idxtPos + 4 + i * 2, entryOffsets[i])
  }

  // ---- 主 INDX 记录（固定 240 字节） ----
  const indx = new Uint8Array(240)
  writeString(indx, 0, 'INDX', 4)
  writeUint32(indx, 4, 192) // length
  writeUint32(indx, 8, 0) // type
  writeUint32(indx, 16, 2) // 参考文件主 INDX[16]=2
  writeUint32(indx, 20, 232) // idxt → 记录内 'IDXT' 标记
  writeUint32(indx, 24, 1) // numRecords（子 IDXT 记录数）
  writeUint32(indx, 28, 65001) // encoding UTF-8
  writeUint32(indx, 32, 0xffffffff) // language
  writeUint32(indx, 36, count) // total
  writeUint32(indx, 40, 0) // ordt
  writeUint32(indx, 44, 0) // ligt
  writeUint32(indx, 48, 0) // numLigt
  writeUint32(indx, 52, 1) // numCncx
  // offset 180: TAGX offset = header_length = 192
  // calibre/kindlegen 黄金均在 offset 180 写 0x000000C0（=192），
  // 文石阅读器依赖此字段定位 TAGX，缺失则目录不显示
  writeUint32(indx, 180, 192)
  indx.set(buildTAGX(), 192)
  // 尾部 IDXT 指针块（参考 kindlegen 输出）
  const lastEntryName = (count - 1).toString(16).toUpperCase().padStart(2, '0')
  const tail = new Uint8Array(16)
  tail[0] = 2 // nameLen
  tail[1] = lastEntryName.charCodeAt(0)
  tail[2] = lastEntryName.charCodeAt(1)
  tail[3] = 0
  tail[4] = count & 0xff
  writeString(tail, 8, 'IDXT', 4)
  tail[13] = 0xe0 // 参考文件固定值
  indx.set(tail, 224)

  return [indx, idxt, cncxData]
}

/**
 * 生成 EXTH 块（二进制）
 * EXTH 结构：magic(4) 'EXTH' + length(4) + count(4) + [type(4)+len(4)+data(N)]* + padding
 *
 * 常用记录类型：
 *   100 body text, 101 publisher, 103 description, 104 isbn, 105 subject,
 *   106 date, 108 contributor, 109 rights, 503 title, 524 language
 *   201 coverOffset（uint，相对 resourceStart）+ 203 hasFakeCover（成对，calibre 有封面时必写）
 *   112 source（"calibre:<uuid>"）, 113 ASIN（uuid），116 startreading（<body> 后字节偏移），
 *   204/205/206/207 伪装 kindlegen 1.2（201/1/2/33307），131=0，
 *   501 cdeType（"EBOK"），528 override fonts（"true"）
 *
 * 对齐 calibre 黄金实测 18 条：无 121（KF8 boundary）/125（资源数）——
 * 纯 MOBI6 不应写（v5 多写了，已删）。
 *
 * @param {Object} meta - { title, creator, publisher, date, language, description, rights }
 * @param {number|null} coverOffset - 封面图相对 resourceStart 的偏移（0 = 第一张资源图）
 * @param {Object} opts - { startOffset: <body> 后字节偏移（EXTH 116），uuid: ASIN 字符串 }
 * @returns {Uint8Array}
 */
function buildEXTH(meta, coverOffset, opts = {}) {
  const records = []
  // type 524: language
  if (meta.language) {
    const d = enc.encode(meta.language)
    records.push([524, d])
  }
  // type 503: title
  if (meta.title) {
    const d = enc.encode(meta.title)
    records.push([503, d])
  }
  // type 100: creator (author)
  if (meta.creator) {
    const d = enc.encode(meta.creator)
    records.push([100, d])
  }
  // type 101: publisher
  if (meta.publisher) {
    const d = enc.encode(meta.publisher)
    records.push([101, d])
  }
  // type 109: rights
  if (meta.rights) {
    const d = enc.encode(meta.rights)
    records.push([109, d])
  }
  // type 106: date
  if (meta.date) {
    const d = enc.encode(meta.date)
    records.push([106, d])
  }
  // type 103: description
  if (meta.description) {
    const d = enc.encode(meta.description)
    records.push([103, d])
  }
  // type 113: ASIN（uuid 字符串）—— Kindle 同步/收藏标识，calibre 黄金必写
  if (opts.uuid) {
    records.push([113, enc.encode(opts.uuid)])
  }
  // type 112: source（"calibre:<uuid>"）—— 黄金必写
  if (opts.uuid) {
    records.push([112, enc.encode(`calibre:${opts.uuid}`)])
  }
  // type 501: cdeType（"EBOK" 电子书，Kindle 识别为正式电子书而非个人文档）
  records.push([501, enc.encode('EBOK')])
  // type 204-207: 伪装 kindlegen 1.2（calibre 黄金：204=201, 205=1, 206=2, 207=33307）
  for (const [type, val] of [[204, 201], [205, 1], [206, 2], [207, 33307]]) {
    const d = new Uint8Array(4)
    writeUint32(d, 0, val)
    records.push([type, d])
  }
  // type 201/203: coverOffset + hasFakeCover（calibre 有封面时成对写：201=offset, 203=0）
  if (coverOffset != null && coverOffset >= 0) {
    const d201 = new Uint8Array(4)
    writeUint32(d201, 0, coverOffset)
    records.push([201, d201])
    const d203 = new Uint8Array(4)
    writeUint32(d203, 0, 0)
    records.push([203, d203])
  }
  // type 116: startreading（<body> 起始字节偏移）。
  // 不写则 Kindle 可能打开时跳到第一个索引条目（calibre serializer 注释原话）。
  if (opts.startOffset != null && opts.startOffset >= 0) {
    const d = new Uint8Array(4)
    writeUint32(d, 0, opts.startOffset)
    records.push([116, d])
  }
  // type 131: kf8 unknown count（calibre 黄金 = 0）
  const d131 = new Uint8Array(4)
  writeUint32(d131, 0, 0)
  records.push([131, d131])
  // type 528: override kindle fonts（"true"，calibre 黄金必写）
  records.push([528, enc.encode('true')])

  // 计算 EXTH 块总长度
  // 12 (header) + sum(8 + data.length) + padding to 4 bytes
  let dataLen = 0
  for (const [, d] of records) dataLen += 8 + d.length
  let contentLen = 12 + dataLen
  // pad to multiple of 4
  const padLen = (4 - (contentLen % 4)) % 4
  const totalLen = contentLen + padLen

  const buf = new Uint8Array(totalLen)
  writeString(buf, 0, 'EXTH', 4)
  writeUint32(buf, 4, totalLen)
  writeUint32(buf, 8, records.length)
  let p = 12
  for (const [type, data] of records) {
    writeUint32(buf, p, type)
    writeUint32(buf, p + 4, 8 + data.length)
    buf.set(data, p + 8)
    p += 8 + data.length
  }
  return buf
}

/**
 * 生成 FLIS 记录（固定 36 字节，MobiPocket 尾部三记录之一）
 * 值参考 calibre/MobiPocket Creator 输出（wiki 有完整表格）
 * @returns {Uint8Array}
 */
function buildFLIS() {
  const buf = new Uint8Array(36)
  writeString(buf, 0, 'FLIS', 4)
  writeUint32(buf, 4, 8)
  writeUint16(buf, 8, 65)
  writeUint16(buf, 10, 0)
  writeUint32(buf, 12, 0)
  writeUint32(buf, 16, 0xffffffff)
  writeUint16(buf, 20, 1)
  writeUint16(buf, 22, 3)
  writeUint32(buf, 24, 3)
  writeUint32(buf, 28, 1)
  writeUint32(buf, 32, 0xffffffff)
  return buf
}

/**
 * 生成 FCIS 记录（52 字节，值参考 calibre 输出）
 * @param {number} textLength - PalmDOC 头的文本长度（未压缩字节数）
 * @returns {Uint8Array}
 */
function buildFCIS(textLength) {
  const buf = new Uint8Array(52)
  writeString(buf, 0, 'FCIS', 4)
  writeUint32(buf, 4, 20)
  writeUint32(buf, 8, 16)
  writeUint32(buf, 12, 2)
  writeUint32(buf, 16, 0)
  writeUint32(buf, 20, textLength)
  writeUint32(buf, 24, 0)
  writeUint32(buf, 28, 40)
  writeUint32(buf, 32, 40)
  writeUint32(buf, 36, 8)
  writeUint16(buf, 40, 1)
  writeUint16(buf, 42, 1)
  writeUint32(buf, 44, 0)
  return buf
}

/**
 * 生成 end-of-file 记录（固定 4 字节，wiki：可能必需）
 * @returns {Uint8Array}
 */
function buildEndOfFile() {
  return Uint8Array.from([0xe9, 0x8e, 0x0d, 0x0a])
}

/**
 * 生成 MOBI6 电子书二进制
 *
 * @param {Object} opts
 * @param {string} opts.title - 书名
 * @param {string} opts.text - XHTML 正文（含 <mbp:pagebreak/> 分页标记，正文可含 <a filepos> 目录链接）
 * @param {Array}  opts.images - 可选，资源图片数组 [{ data: Uint8Array, mime: string }]
 *                               正文中通过 <img recindex="i">（i 从 1 开始）引用
 * @param {Object} opts.metadata - 可选，{ creator, publisher, date, language, description, rights }
 * @param {Array}  opts.ncx - 可选，NCX 目录条目 [{ title, offset, size?, headingLevel? }]
 *                            offset 为相对第一条文本记录起点的文件字节偏移
 * @returns {Uint8Array} 完整 .mobi 二进制
 */
export function createMobi(opts) {
  const { title = 'Untitled', text = '', images = [], metadata = {}, ncx = null } = opts

  // ---------- 1. 准备文本记录 ----------
  const RECORD_SIZE = 4096
  // 若传入文本未以 </html> 结尾，补全为完整 HTML 文档。
  let fullText = text
  if (!/<\/html>\s*$/i.test(fullText)) {
    fullText += '\n</body></html>'
  }
  // calibre 式精确 4096 切分 + multibyte overlap 检测
  const { records: rawRecords, overlaps } = splitRecords(fullText, RECORD_SIZE)
  const numTextRecords = rawRecords.length
  const fullTextLength = enc.encode(fullText).length

  // 为每条记录生成 TBS（Trailing Byte Sequence，索引数据）
  // TBS 告诉 Kindle 每条记录包含哪些 NCX 条目，是目录功能的关键
  const hasTbs = ncx && ncx.length > 0
  const tbsList = hasTbs
    ? buildTBSForRecords(ncx, numTextRecords, RECORD_SIZE)
    : new Array(numTextRecords).fill(null).map(() => [])

  // 每条记录 = 压缩(4096字节文本) + overlap_bytes + 1字节count + TBS_data + TBS_size
  // 对齐 calibre generate_text 逻辑：
  //   data = compress(text_record)
  //   data += overlap_bytes  (不压缩)
  //   data += pack('>B', len(overlap))  (multibyte trailing)
  //   data += encode_trailing_data(tbs)  (TBS trailing)
  const textRecords = []
  for (let i = 0; i < numTextRecords; i++) {
    const compressed = lz77Compress(rawRecords[i])
    let recordBytes = Array.from(compressed)
    // multibyte overlap trailing (extra_data_flags bit 0)
    if (overlaps[i] > 0) {
      // overlap 字节 = 下一条记录开头的 overlap[i] 个字节
      // 这些字节在下一条记录中作为正常文本参与压缩
      // 在本条记录中作为不压缩的 trailing bytes 追加
      const nextRec = rawRecords[i + 1]
      if (nextRec) {
        for (let j = 0; j < overlaps[i]; j++) {
          recordBytes.push(nextRec[j])
        }
      }
      // overlap count byte
      recordBytes.push(overlaps[i])
    } else {
      // 无 overlap 也需要 count=0
      recordBytes.push(0)
    }
    // TBS trailing (extra_data_flags bit 1)
    if (hasTbs) {
      const tbsEncoded = encodeTrailingData(tbsList[i])
      recordBytes = recordBytes.concat(tbsEncoded)
    }
    textRecords.push(Uint8Array.from(recordBytes))
  }

  // ---------- 2. 计算 MOBI 头尺寸 + EXTH ----------
  const titleBytes = enc.encode(title)
  const MOBI_HEADER_SIZE = 232 // MOBI 头长度（不含 PalmDOC 头）

  // 构建 EXTH 块（含 title、creator 等元数据 + coverOffset 指向第一张图片）
  // coverOffset 是相对 resourceStart 的 0-based 偏移（foliate loadResource 会 + resourceStart）
  const coverOffset = images.length > 0 ? 0 : null
  // EXTH 116 startreading：<body> 起始字节偏移。
  // calibre serializer：不写则 Kindle 打开时可能跳到第一个索引条目。
  // converters.js/gen_azw3.mjs 的文本以 "<html><head><guide>...</head><body>\n" 开头，
  // <body> 后即正文起点，此偏移 = 文本中 '<body>' 标签结束后的字节位置。
  // 与 filepos 同基准（相对第一条文本记录起点），无 <body> 时回退 0。
  const bodyTagMatch = /^.*?<body[^>]*>/i.exec(fullText)
  const startOffset = bodyTagMatch ? enc.encode(bodyTagMatch[0]).length : 0
  // EXTH 113/112：uuid 字符串（Kindle ASIN/收藏标识），无传入则随机生成一次
  const uuid = metadata.uuid || generateUuid()
  const exthMeta = {
    title,
    creator: metadata.creator || 'DocLite',
    publisher: metadata.publisher || 'DocLite',
    date: metadata.date || new Date().toISOString().slice(0, 10),
    language: metadata.language || 'zh-cn',
    description: metadata.description || '',
    rights: metadata.rights || '',
  }
  const exthBuf = buildEXTH(exthMeta, coverOffset, { startOffset, uuid })
  // exthFlags: bit 6 (0x40) = EXTH 存在；bit 4 (0x10) = 文本记录有 trailing bytes
  // 对齐 calibre: 0x50 = 0b1010000 (EXTH + trailing bytes)
  const EXTH_FLAG = 0x50

  // titleOffset 是相对 record 0 起点的偏移 = 16(PalmDOC) + 232(MOBI头) + EXTH长度
  const titleOffset = 16 + MOBI_HEADER_SIZE + exthBuf.length
  const titleLength = titleBytes.length
  const record0Size = 16 + MOBI_HEADER_SIZE + exthBuf.length + titleLength
  const record0SizeAligned = Math.ceil(record0Size / 4) * 4

  // ---------- 3. 计算 PDB 布局 ----------
  // 记录偏移表（对齐 calibre 输出）：
  // Record 0:                PalmDOC+MOBI头+EXTH+标题
  // Record 1..numText:       文本记录（压缩+trailing bytes）
  // Record numText+1:        2 字节零记录（MobiPocket Creator 在文本后添加）
  // Record numText+1..:     NCX 索引记录（INDX/IDXT/CNCX），若有
  // 之后:                    资源记录（图片）
  // 末尾:                    FLIS + FCIS + end-of-file 三记录
  const ncxRecords = buildNcxRecords(ncx)
  const numNcxRecords = ncxRecords ? ncxRecords.length : 0
  const flisRecord = buildFLIS()
  const fcisRecord = buildFCIS(fullTextLength)
  const eofRecord = buildEndOfFile()
  // 无零记录：对齐 calibre 黄金（numText+1=firstNonBook=indx）
  // 文石阅读器用 numText+1 而非 indx 字段定位 INDX 记录，
  // 零记录导致 numText+1 指向空记录而非 INDX，目录不显示
  const numRecords = 1 + numTextRecords + numNcxRecords + images.length + 3
  const resourceStart = 1 + numTextRecords + numNcxRecords
  const ncxStart = 1 + numTextRecords
  const firstNonBookIndex = numTextRecords + 1
  // 最后一个资源（图片）记录号（供 lastContent 使用）
  const lastContent = images.length > 0 ? resourceStart + images.length - 1 : 1 + numTextRecords
  const pdbHeaderSize = 78 + numRecords * 8
  const recordOffsets = []
  let currentOffset = pdbHeaderSize

  recordOffsets.push(currentOffset)
  currentOffset += record0SizeAligned

  for (let i = 0; i < numTextRecords; i++) {
    recordOffsets.push(currentOffset)
    currentOffset += textRecords[i].length
  }

  // 2 字节零记录（已移除）

  // NCX 索引记录（在资源之前）
  for (let i = 0; i < numNcxRecords; i++) {
    recordOffsets.push(currentOffset)
    currentOffset += ncxRecords[i].length
  }

  // 图片资源记录
  for (let i = 0; i < images.length; i++) {
    recordOffsets.push(currentOffset)
    currentOffset += images[i].data.length
  }

  // 尾部 FLIS / FCIS / EOF
  recordOffsets.push(currentOffset)
  currentOffset += flisRecord.length
  recordOffsets.push(currentOffset)
  currentOffset += fcisRecord.length
  recordOffsets.push(currentOffset)
  currentOffset += eofRecord.length

  // ---------- 4. 组装二进制 ----------
  const totalSize = currentOffset
  const buf = new Uint8Array(totalSize)

  // ---- PDB 头 ----
  writeString(buf, 0, title.slice(0, 31), 32) // name
  writeUint32(buf, 60, 0x424f4f4b) // type = 'BOOK'
  writeUint32(buf, 64, 0x4d4f4249) // creator = 'MOBI'
  writeUint16(buf, 76, numRecords)

  // 记录偏移表 + 属性
  // 对齐 calibre/kindlegen 黄金：所有记录 uniqueID = i * 2（attr byte=0, uniqueID=24bit）
  for (let i = 0; i < numRecords; i++) {
    writeUint32(buf, 78 + i * 8, recordOffsets[i])
    writeUint32(buf, 78 + i * 8 + 4, i * 2)
  }

  // ---- Record 0: PalmDOC + MOBI 头 ----
  const r0 = recordOffsets[0]
  // PalmDOC 头 (16 字节)
  writeUint16(buf, r0 + 0, 2) // compression = 2 (PalmDOC LZ77 压缩)
  writeUint32(buf, r0 + 4, fullTextLength) // textLength (未压缩 UTF-8 字节数)
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

  // 未用索引字段（MOBI 头内偏移 24-79 = 相对 record0 偏移 40-79）：
  // 对齐 calibre：偏移 40-47 = ff*8，48 = secondary index record（无则 0xffffffff），
  // 49-79 = ff*28。即 r0+40..r0+79 除 r0+52 起 7 个 DWORD 外全部 0xffffffff。
  // 此前循环只覆盖到 r0+72，漏写 r0+76（=0）——实测文石 TAB10C v3 可开（此值为 ff）、
  // v5 闪退（此值为 0），calibre/kindlegen 黄金均为 ff，故补齐到 r0+76。
  for (let i = 0; i < 10; i++) writeUint32(buf, r0 + 40 + i * 4, 0xffffffff)
  // firstNonBookIndex（相对 record0 偏移 80 = MOBI 头内偏移 64）：第一个非文本记录号
  // 这是 Kindle 解析器定位非文本记录区的关键字段，此前写错到 r0+96 导致 Kindle 读到 0
  writeUint32(buf, r0 + 80, firstNonBookIndex)

  // 标题字段（相对 record 0 起点偏移，foliate-js MOBI_HEADER 定义）
  writeUint32(buf, r0 + 84, titleOffset) // titleOffset
  writeUint32(buf, r0 + 88, titleLength) // titleLength

  // 语言字段（相对 record 0 起点偏移 94/95）
  buf[r0 + 94] = 0 // localeRegion
  buf[r0 + 95] = 4 // localeLanguage = zh

  // resourceStart（相对 record 0 的记录号），foliate-js 从偏移 108 读取
  writeUint32(buf, r0 + 108, resourceStart)

  // exthFlags: 0x50 = bit 6 (EXTH) + bit 4 (trailing bytes 在文本记录尾部)
  // 对齐 calibre: 0b1010000 = 0x50
  writeUint32(buf, r0 + 128, EXTH_FLAG)

  // minVersion（相对 record0 偏移 104）：设 6
  writeUint32(buf, r0 + 104, 6)

  // DRM 相关（相对 record0 偏移 152-164）：无 DRM（对齐 calibre 输出：drmOffset=0, drmCount=0, drmSize=0, drmFlags=0xffffffff）
  writeUint32(buf, r0 + 152, 0) // drmOffset（无）
  writeUint32(buf, r0 + 156, 0) // drmCount
  writeUint32(buf, r0 + 160, 0) // drmSize
  writeUint32(buf, r0 + 164, 0xffffffff) // drmFlags（参考 calibre）

  // 未用索引字段（相对 record0 偏移 168-191）：对齐 calibre 输出（仅 r0+168=0xffffffff，其余 0）
  writeUint32(buf, r0 + 168, 0xffffffff)
  for (let i = 1; i < 6; i++) writeUint32(buf, r0 + 168 + i * 4, 0)

  // 内容记录范围（相对 record0 偏移 192-248）：
  // 对齐 calibre 黄金实测 r0[192:248] dump
  const flisRecNum = numRecords - 3
  const fcisRecNum = numRecords - 2
  writeUint16(buf, r0 + 192, 1) // firstContent
  writeUint16(buf, r0 + 194, lastContent) // lastContent
  writeUint32(buf, r0 + 196, 1) // r0+196=1
  writeUint32(buf, r0 + 200, fcisRecNum) // FCIS record number
  writeUint32(buf, r0 + 204, 1) // r0+204=1
  writeUint32(buf, r0 + 208, flisRecNum) // FLIS record number
  writeUint32(buf, r0 + 212, 1) // r0+212=1
  writeUint32(buf, r0 + 216, 0) // r0+216=0
  writeUint32(buf, r0 + 220, 0) // r0+220=0
  writeUint32(buf, r0 + 224, 0xffffffff) // r0+224
  writeUint32(buf, r0 + 228, 0) // r0+228
  writeUint32(buf, r0 + 232, 0xffffffff) // r0+232
  writeUint32(buf, r0 + 236, 0xffffffff) // r0+236

  // extra_data_flags（相对 record0 偏移 240，UInt32）
  // bit 0 (0x1): multibyte overlap trailing bytes
  // bit 1 (0x2): TBS indexing trailing data
  // 对齐 calibre: 0b11 = 3
  const extraDataFlags = 0x01 | (hasTbs ? 0x02 : 0)
  writeUint32(buf, r0 + 240, extraDataFlags)
  // indx（相对 record0 偏移 244）：NCX 索引主记录号
  writeUint32(buf, r0 + 244, numNcxRecords > 0 ? ncxStart : 0xffffffff)

  // ---- EXTH 块（紧跟 MOBI 头之后） ----
  buf.set(exthBuf, r0 + 16 + MOBI_HEADER_SIZE)

  // ---- 标题文本（写在 record 0 的 MOBI 头 + EXTH 之后） ----
  const titleStart = r0 + 16 + MOBI_HEADER_SIZE + exthBuf.length
  for (let i = 0; i < titleBytes.length; i++) {
    buf[titleStart + i] = titleBytes[i]
  }

  // ---- 文本记录（压缩后写入） ----
  for (let i = 0; i < numTextRecords; i++) {
    buf.set(textRecords[i], recordOffsets[1 + i])
  }

  // ---- NCX 索引记录（在资源之前） ----
  for (let i = 0; i < numNcxRecords; i++) {
    buf.set(ncxRecords[i], recordOffsets[ncxStart + i])
  }

  // ---- 资源记录（图片） ----
  for (let i = 0; i < images.length; i++) {
    buf.set(images[i].data, recordOffsets[resourceStart + i])
  }

  // ---- 尾部 FLIS / FCIS / EOF ----
  buf.set(flisRecord, recordOffsets[flisRecNum])
  buf.set(fcisRecord, recordOffsets[fcisRecNum])
  buf.set(eofRecord, recordOffsets[numRecords - 1])

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
  URL.revokeObjectURL(url)
}