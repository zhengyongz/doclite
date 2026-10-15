// build/afterPack.cjs
// electron-builder afterPack 钩子：裁剪 Chromium 语言包，只保留 简中/繁中/英文
// 目标：deb 体积 94M → ~60M（Chromium 默认带 50+ 语言，DocLite 仅需 3 种）
const fs = require('fs')
const path = require('path')

// 需要保留的语言资源（Chromium pak 命名）
const KEEP = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak'])

exports.default = async function (context) {
  const localesDir = path.join(context.appOutDir, 'locales')
  if (!fs.existsSync(localesDir)) return

  let removed = 0
  for (const file of fs.readdirSync(localesDir)) {
    if (!KEEP.has(file)) {
      fs.unlinkSync(path.join(localesDir, file))
      removed++
    }
  }
  console.log(`[afterPack] locales 裁剪完成：保留 ${KEEP.size} 种语言（简中/繁中/英文），删除 ${removed} 个语言包`)
}