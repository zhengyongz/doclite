// build/afterPack.cjs
// electron-builder afterPack 钩子：
//   1) 裁剪 Chromium 语言包，只保留 简中/繁中/英文（deb 体积 94M → ~60M）
//      - Windows/Linux：<appOutDir>/locales/*.pak
//      - macOS：Electron Framework.framework/Resources/*.lproj（约 55 个，~57M）
//   2) macOS：ad-hoc 重签（codesign --sign -）
//      原因：CI 无 Developer ID 时 electron-builder 直接跳过签名（不会自动 ad-hoc），
//      而它改写了 Info.plist / 主可执行文件并塞入 app.asar，Electron 原始
//      _CodeSignature 封条失效 → 下载后首启被 Gatekeeper 判“已损坏”。
//      ad-hoc 重签解决不了“未公证”，但能把“已损坏”降级为“无法验证开发者”（右键打开可过）。
//      注意：本钩子在 electron-builder 的签名步骤之前执行，真机有证书时后续正式签名会覆盖本签名。
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

// Chromium pak 命名（Windows/Linux）
const KEEP = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak'])
// macOS .lproj 命名
const KEEP_LPROJ = new Set(['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj'])

function prunePakLocales(appOutDir) {
  const localesDir = path.join(appOutDir, 'locales')
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

function pruneLproj(dir, label) {
  if (!fs.existsSync(dir)) return
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.lproj')) continue
    if (KEEP_LPROJ.has(name)) continue
    fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    removed++
  }
  console.log(`[afterPack] ${label} .lproj 裁剪完成：删除 ${removed} 个语言目录`)
}

function pruneMacLocales(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  pruneLproj(path.join(app, 'Contents', 'Resources'), 'App Resources')
  pruneLproj(
    path.join(app, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources'),
    'Electron Framework'
  )
}

function adhocSign(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!fs.existsSync(app)) {
    throw new Error(`[afterPack] 找不到 .app：${app}`)
  }
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
    console.log('[afterPack] macOS ad-hoc 重签完成（codesign --sign -）')
  } catch (e) {
    // 不静默放过：未重签的包在用户侧大概率“已损坏”，宁可让 CI 失败
    throw new Error(`[afterPack] macOS ad-hoc 重签失败：${e.message}`)
  }
}

exports.default = async function (context) {
  if (context.electronPlatformName === 'darwin') {
    // 先裁剪再签名：改动资源后签名封条必须重算
    pruneMacLocales(context)
    adhocSign(context)
    return
  }
  prunePakLocales(context.appOutDir)
}
