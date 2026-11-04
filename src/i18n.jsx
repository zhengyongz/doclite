// src/i18n.jsx
// 轻量 i18n：零第三方依赖。中/英两套扁平字典 + React Context。
// 用法：
//   <I18nProvider><App/></I18nProvider>
//   const { t, lang, setLang } = useI18n()
//   <span>{t('header.app')}</span>   <span>{t('sidebar.newVersion', { version })}}</span>
//
// 约定：
//   - t(key, vars)：key 优先取 dict[lang]，其次 dict.zh，再回退 key 本身
//   - 主进程经 IPC 回传的中文提示（后端错误等），可直接用其「中文原文」当 key 传入 t()，
//     由 en 字典翻译（见后段以中文原文为 key 的条目）；未收录则原样返回
//   - ts(s)：翻译一个已知「原文/字符串」，未收录则原样（用于 err.message 等动态值）
// 注意：渲染器/useCallback 里刻意不把 t 加入依赖数组（避免切语言时重解析大文档）；
//       文案应尽可能在渲染层用 t() 即时计算（详见 workbuddy 审查 M3/L8）。
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'doclite-lang'

export function detectLang() {
  try {
    const nav = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || ''
    return nav.toLowerCase().startsWith('en') ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

function loadLang() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'zh' || v === 'en') return v
  } catch { /* ignore */ }
  return detectLang()
}

const zh = {
  // Header / 通用
  'header.app': '轻快文档工具箱',
  'lang.switch': '切换语言',

  // Sidebar
  'sidebar.fileInfo': '文件信息',
  'sidebar.format': '格式',
  'sidebar.size': '大小',
  'sidebar.name': '名称',
  'sidebar.security': '安全提示',
  'sidebar.securityBody': '所有文件处理均在您的浏览器本地完成，不会上传至任何服务器，您的数据始终安全可控。',
  'sidebar.supported': '支持的格式',
  'sidebar.version': '版本信息',
  'sidebar.newVersion': '发现新版本 v{version}',
  'sidebar.checkTitle': '检查是否有新版本',
  'sidebar.checking': '检查中…',
  'sidebar.viewUpdate': '查看更新',
  'sidebar.checkUpdate': '检查更新',

  // UploadZone
  'upload.drop': '拖拽文件到此处，或',
  'upload.click': '点击上传',
  'upload.hint': '支持 .docx / .xlsx / .xls / .pptx / .pdf / .azw3 / .mobi / .md，最大 100 MB（MD 最大 5 MB）',
  'upload.selectFile': '选择文件',
  'upload.remove': '移除文件',

  // EmptyState
  'empty.title': '尚未加载文件',
  'empty.sub': '从左侧上传一份文档即可开始预览与转换',
  'empty.convert': '支持转换',
  'empty.pdfToPng': 'PDF → PNG 图片',
  'empty.note': '所有转换均在浏览器本地完成，不会上传任何数据',

  // PreviewToolbar
  'toolbar.zoomOut': '缩小',
  'toolbar.zoomIn': '放大',

  // PreviewViewport
  'viewport.unsupported': '不支持的格式',
  'viewport.supported': '仅支持 {formats} 格式',

  // ConvertPanel
  'convert.title': '格式转换',
  'convert.componentTag': '（组件 v{version}）',
  'convert.notInstalled': '文档格式转换为可选功能，当前未安装。安装后可在这里将文档导出为 PDF、Word、图片、电子书等格式。',
  'convert.installBtn': '安装转换组件（约 1MB，仅需一次）',
  'convert.installing': '正在安装，请稍候…',
  'convert.providedByComponent': '转换功能由可选组件提供',
  'convert.updateTo': '更新到 v{version}',
  'convert.reinstall': '重装组件',
  'convert.remove': '移除',
  'convert.outdated.xls': '当前组件不支持 .xls 转换，请先更新组件。',
  'convert.outdated.adv': '组件版本落后于应用（v{cur} → v{app}），建议更新。',
  'convert.hdLabel': '高清导出（打印级，体积较大）',
  'convert.hdTitle': '标准：屏幕阅读清晰，体积小速度快；高清：约 200 DPI 打印级，体积约为标准的 2.5 倍',
  'convert.blockedTitle': '当前组件不支持 .xls，请先更新组件',
  'convert.loadingTitle': '转换组件加载中…',
  'convert.progress': '正在转换中，请稍候…',
  'convert.exportPdf': '导出为 PDF',
  'convert.exportPdfDesc': '将文档转换为 PDF 格式',
  'convert.exportWord': '导出为 Word (.docx)',
  'convert.exportWordDesc': '将 PDF 转换为可编辑的 Word 文档',
  'convert.exportPng': '导出为图片 (PNG)',
  'convert.exportPngDesc': '将每页 PDF 导出为高清 PNG 图片',
  'convert.exportMobi': '导出为电子书 (MOBI)',
  'convert.exportMobiDesc': '将 PDF 转换为 Kindle 电子书格式',
  'convert.failed': '转换失败：{msg}',

  // renderers
  'renderer.azw.loading': '正在解析电子书…',
  'renderer.azw.failed': '解析失败',
  'renderer.azw.failedHint': '请检查文件是否为有效的 AZW3/MOBI 格式',
  'renderer.azw.unnamed': '未命名章节',
  'renderer.azw.toc': '目录',
  'renderer.azw.closeToc': '关闭目录',
  'renderer.azw.noToc': '无目录信息',
  'renderer.azw.chapterOf': '{cur} / {total} 章',
  'renderer.azw.prevChapter': '上一章',
  'renderer.azw.nextChapter': '下一章',
  'renderer.azw.loadingSection': '正在加载章节内容…',
  'renderer.azw.cover': '封面',
  'renderer.azw.sectionFailed': '本章节渲染失败',
  'renderer.pdf.loading': '正在加载 PDF…',
  'renderer.docx.loading': '正在解析…',
  'renderer.md.loading': '正在解析…',
  'renderer.md.noticeUtf8': '检测到疑似非 UTF-8 编码，部分内容可能显示为乱码，建议以 UTF-8 保存后重新打开',
  'renderer.md.noticeTruncate': '文档过大（超过 {limit} 字符），已截断仅预览前 {keep} 字符',
  'renderer.pptx.loading': '正在解析 PPT…',
  'renderer.pptx.empty': '未找到幻灯片内容',
  'renderer.pptx.prev': '上一页',
  'renderer.pptx.next': '下一页',
  'renderer.xlsx.loading': '正在解析…',

  // ErrorToast
  'error.close': '关闭',

  // UpdateDialog
  'update.title': '软件更新',
  'update.close': '关闭',
  'update.checking': '正在检查更新…',
  'update.error': '检查更新失败',
  'update.errorHint': '网络异常时请稍后重试，不影响软件正常使用。',
  'update.retry': '重试',
  'update.upToDate': '已是最新版本 v{version}',
  'update.ok': '好的',
  'update.current': '当前 v{version}',
  'update.package': '安装包：{name}（{size} MB）',
  'update.later': '稍后再说',
  'update.download': '下载更新',
  'update.downloading': '正在下载 v{version}…',
  'update.source': '当前源：{source}',
  'update.installed': '✓ v{version} 安装成功',
  'update.installedHint': '重启应用后新版本即可生效。',
  'update.restartLater': '稍后重启',
  'update.restartNow': '立即重启',
  'update.downloaded': 'v{version} 已下载完成',
  'update.savedTo': '文件已保存至：',
  'update.installingHint': '正在安装，请在系统弹出的密码框中输入密码…',
  'update.installNow': '立即安装（自动弹出密码框）',
  'update.manualFail': '安装失败？可改用终端命令手动安装',
  'update.copy': '复制',
  'update.openInFileManager': '在文件管理器中查看',
  'update.openInstaller': '打开安装程序',

  // useConverters / useUpdater（渲染层回退文案）
  'converters.loadFailed': '转换组件加载失败：{msg}',
  'converters.installFailed': '安装失败',
  'converters.installOk': '转换组件 v{version} 安装成功',
  'converters.uninstallFailed': '卸载失败',
  'converters.uninstallOk': '转换组件已移除（浏览功能不受影响）',
  'converters.notInstalled': '文件转换功能未安装',
  'updater.checkFailed': '检查失败',
  'updater.downloadInProgress': '下载已在进行中',
  'updater.installIncomplete': '安装未完成',

  // 错误文案（渲染层 setError 用）
  'err.file.unsupported': '不支持的文件类型：{name}',
  'err.file.openFailed': '打开文件失败：{msg}',
  'err.azw.parse': '电子书解析失败，文件可能已损坏或格式不正确',
  'err.pdf.parse': 'PDF 文件解析失败，文件可能已损坏或受密码保护',
  'err.docx.parse': 'Word 文档解析失败，文件可能已损坏或格式不正确',
  'err.pptx.parse': 'PPT 文件解析失败，文件可能已损坏或格式不正确',
  'err.xlsx.parse': 'Excel 文件解析失败，文件可能已损坏或格式不正确',
  'err.md.parse': 'Markdown 解析失败，文件可能已损坏',
}

const en = {
  'header.app': 'DocLite',
  'lang.switch': 'Switch language',

  'sidebar.fileInfo': 'File info',
  'sidebar.format': 'Format',
  'sidebar.size': 'Size',
  'sidebar.name': 'Name',
  'sidebar.security': 'Security',
  'sidebar.securityBody': 'All file processing happens locally in your browser; nothing is uploaded to any server. Your data stays private.',
  'sidebar.supported': 'Supported formats',
  'sidebar.version': 'Version',
  'sidebar.newVersion': 'New version v{version}',
  'sidebar.checkTitle': 'Check for updates',
  'sidebar.checking': 'Checking…',
  'sidebar.viewUpdate': 'View update',
  'sidebar.checkUpdate': 'Check update',

  'upload.drop': 'Drag files here, or',
  'upload.click': 'click to upload',
  'upload.hint': 'Supports .docx / .xlsx / .xls / .pptx / .pdf / .azw3 / .mobi / .md, up to 100 MB (MD up to 5 MB)',
  'upload.selectFile': 'Choose file',
  'upload.remove': 'Remove file',

  'empty.title': 'No file loaded',
  'empty.sub': 'Upload a document from the left to start previewing and converting',
  'empty.convert': 'Supported conversions',
  'empty.pdfToPng': 'PDF → PNG image',
  'empty.note': 'All conversions run locally; no data is uploaded',

  'toolbar.zoomOut': 'Zoom out',
  'toolbar.zoomIn': 'Zoom in',

  'viewport.unsupported': 'Unsupported format',
  'viewport.supported': 'Only {formats} are supported',

  'convert.title': 'Convert',
  'convert.componentTag': '(component v{version})',
  'convert.notInstalled': 'Format conversion is an optional feature and is not installed yet. Install it to export documents to PDF, Word, images, ebooks and more.',
  'convert.installBtn': 'Install converter component (~1 MB, once)',
  'convert.installing': 'Installing, please wait…',
  'convert.providedByComponent': 'Conversion is provided by the optional component',
  'convert.updateTo': 'Update to v{version}',
  'convert.reinstall': 'Reinstall component',
  'convert.remove': 'Remove',
  'convert.outdated.xls': 'The current component does not support .xls; please update it first.',
  'convert.outdated.adv': 'Component version is behind the app (v{cur} → v{app}); please update.',
  'convert.hdLabel': 'High quality (print-grade, larger)',
  'convert.hdTitle': 'Standard: crisp on screen, small and fast; High: ~200 DPI print quality, ~2.5× the size',
  'convert.blockedTitle': 'The current component does not support .xls; update it first',
  'convert.loadingTitle': 'Loading converter component…',
  'convert.progress': 'Converting, please wait…',
  'convert.exportPdf': 'Export to PDF',
  'convert.exportPdfDesc': 'Convert the document to PDF',
  'convert.exportWord': 'Export to Word (.docx)',
  'convert.exportWordDesc': 'Convert the PDF to an editable Word document',
  'convert.exportPng': 'Export as image (PNG)',
  'convert.exportPngDesc': 'Export each PDF page as a high-resolution PNG',
  'convert.exportMobi': 'Export as ebook (MOBI)',
  'convert.exportMobiDesc': 'Convert the PDF to a Kindle ebook',
  'convert.failed': 'Conversion failed: {msg}',

  'renderer.azw.loading': 'Parsing ebook…',
  'renderer.azw.failed': 'Parse failed',
  'renderer.azw.failedHint': 'Please check that the file is a valid AZW3/MOBI',
  'renderer.azw.unnamed': 'Untitled section',
  'renderer.azw.toc': 'Table of Contents',
  'renderer.azw.closeToc': 'Close table of contents',
  'renderer.azw.noToc': 'No table of contents',
  'renderer.azw.chapterOf': '{cur} / {total} chapters',
  'renderer.azw.prevChapter': 'Previous',
  'renderer.azw.nextChapter': 'Next',
  'renderer.azw.loadingSection': 'Loading section…',
  'renderer.azw.sectionFailed': 'This section failed to render',
  'renderer.azw.cover': 'Cover',
  'renderer.pdf.loading': 'Loading PDF…',
  'renderer.docx.loading': 'Parsing…',
  'renderer.md.loading': 'Parsing…',
  'renderer.md.noticeUtf8': 'Suspected non-UTF-8 encoding; some content may look garbled. Save as UTF-8 and reopen for best results.',
  'renderer.md.noticeTruncate': 'The document is too large (over {limit} characters); preview truncated to the first {keep} characters',
  'renderer.pptx.loading': 'Parsing PPT…',
  'renderer.pptx.empty': 'No slides found',
  'renderer.pptx.prev': 'Previous',
  'renderer.pptx.next': 'Next',
  'renderer.xlsx.loading': 'Parsing…',

  'error.close': 'Close',

  'update.title': 'Software Update',
  'update.close': 'Close',
  'update.checking': 'Checking for updates…',
  'update.error': 'Failed to check for updates',
  'update.errorHint': 'If the network is unstable, try again later; the app keeps working normally.',
  'update.retry': 'Retry',
  'update.upToDate': 'You are up to date (v{version})',
  'update.ok': 'OK',
  'update.current': 'current v{version}',
  'update.package': 'Package: {name} ({size} MB)',
  'update.later': 'Later',
  'update.download': 'Download update',
  'update.downloading': 'Downloading v{version}…',
  'update.source': 'Source: {source}',
  'update.installed': '✓ v{version} installed',
  'update.installedHint': 'Restart the app to use the new version.',
  'update.restartLater': 'Restart later',
  'update.restartNow': 'Restart now',
  'update.downloaded': 'v{version} downloaded',
  'update.savedTo': 'Saved to: ',
  'update.installingHint': 'Installing — enter your password in the system dialog when prompted…',
  'update.installNow': 'Install now (the password dialog will appear)',
  'update.manualFail': 'Install failed? Use the terminal command to install manually',
  'update.copy': 'Copy',
  'update.openInFileManager': 'Show in file manager',
  'update.openInstaller': 'Open installer',

  'converters.loadFailed': 'Failed to load converter component: {msg}',
  'converters.installFailed': 'Installation failed',
  'converters.installOk': 'Converter component v{version} installed',
  'converters.uninstallFailed': 'Uninstall failed',
  'converters.uninstallOk': 'Converter component removed (browsing is unaffected)',
  'converters.notInstalled': 'The file conversion feature is not installed',
  'updater.checkFailed': 'Check failed',
  'updater.downloadInProgress': 'Download already in progress',
  'updater.installIncomplete': 'Installation not completed',

  'err.file.unsupported': 'Unsupported file type: {name}',
  'err.file.openFailed': 'Failed to open file: {msg}',
  'err.azw.parse': 'Ebook parse failed; the file may be damaged or not a valid AZW3/MOBI',
  'err.pdf.parse': 'PDF parse failed; the file may be damaged or password-protected',
  'err.docx.parse': 'Word document parse failed; the file may be damaged or corrupt',
  'err.pptx.parse': 'PPT parse failed; the file may be damaged or corrupt',
  'err.xlsx.parse': 'Excel parse failed; the file may be damaged or corrupt',
  'err.md.parse': 'Markdown parse failed; the file may be damaged',

  // ------- 主进程/后端回传中文原文 → 英文（以中文原文为 key）-------
  '文件转换组件': 'File converter component',
  '转换组件脚本无法加载（缺少全局导出）': 'Converter component script failed to load (missing global export)',
  '转换组件脚本加载失败': 'Failed to load converter component script',
  '获取失败': 'Failed to fetch',
  '不支持的格式转换为 PDF': 'Unsupported format for PDF conversion',
  '未选择任何文件': 'No file selected',
  '安装失败': 'Installation failed',
  '安装失败：': 'Installation failed: ',
  '卸载失败': 'Uninstall failed',
  '安装成功': 'Installed',
  '下载产物缺失': 'Download artifact missing',
  '下载失败': 'Download failed',
  '下载已在进行中': 'Download already in progress',
  '下载文件超出预期大小': 'Download exceeded expected size',
  '下载超时（30 秒无数据）': 'Download timed out (no data for 30s)',
  '网络超时': 'Network timeout',
  '写入文件失败: ': 'Failed to write file: ',
  '未找到可用安装包，请先检查更新': 'No matching package found; check for updates first',
  '未找到已下载的安装包，请先下载更新': 'Downloaded package not found; download the update first',
  '未获取到更新信息，请稍后再试': 'No update info yet; try again later',
  'feed 无版本信息': 'Feed has no version info',
  '响应超出预期大小': 'Response exceeds expected size',
  '服务器返回大小与预期不符': 'Server returned size mismatch',
  '检查过于频繁，请稍后再试': 'Checking too frequently; try again later',
  '当前平台不支持一键安装': 'One-click install is not supported on this platform',
  '无法调用 dpkg，请改用下方命令手动安装': 'Cannot call dpkg; use the manual command below instead',
  '系统缺少 pkexec（PolicyKit），请改用下方命令手动安装': 'pkexec (PolicyKit) is missing; install manually with the command below instead',
  '已取消安装': 'Installation cancelled',
  '组件安装正在进行中，请稍候': 'Component installation in progress, please wait',
  '组件包格式无效': 'Invalid component package format',
  '组件包格式无效（无法定位中央目录）': 'Invalid component package (cannot locate central directory)',
  '组件包下载不完整': 'Component package download incomplete',
  '组件包内容为空': 'Component package is empty',
  '组件包中央目录损坏': 'Component central directory corrupt',
  '组件包中央目录越界': 'Component central directory out of bounds',
  '组件包数据区越界': 'Component data region out of bounds',
  '组件包文件名字段越界': 'Component filename field out of bounds',
  '组件包本地文件头损坏': 'Component local file header corrupt',
  '组件包条目数超出上限': 'Component entry count exceeds limit',
  '组件包校验失败（sha256 不匹配）': 'Component checksum failed (sha256 mismatch)',
  '组件包校验文件获取失败，已中止安装': 'Failed to fetch component checksum; install aborted',
  '组件包缺少 converters.js': 'Component package missing converters.js',
  '组件包缺少 manifest.json': 'Component package missing manifest.json',
  '组件包缺少校验文件（.sha256），已中止安装': 'Component missing checksum file (.sha256); install aborted',
  '组件脚本哈希校验失败（文件被篡改）': 'Component script hash mismatch (file tampered)',
  '组件解压总体积超出上限': 'Component total extracted size exceeds limit',
  '组件总体积超出上限': 'Component total size exceeds limit',
  '文件下载不完整，请重试': 'Download incomplete; please retry',
  '文件校验失败（sha256 不匹配，疑似镜像被篡改）': 'Checksum mismatch (sha256); the mirror may be tampered',
  'GitHub 返回数据异常': 'GitHub returned abnormal data',
  '官方直连': 'Official direct',
  '镜像 gh-proxy.com': 'Mirror gh-proxy.com',
  '镜像 ghfast.top': 'Mirror ghfast.top',
  '镜像 ghproxy.net': 'Mirror ghproxy.net',
  '差量更新：仅下载与上一版不同的部分': 'Incremental: only the part differing from the previous version is downloaded',
  'macOS 暂不支持自动更新：已打开下载页面，请手动下载 DMG 安装（Apple Silicon 选 -arm64，Intel 选 -x64）': 'macOS auto-update is not supported yet: the download page has been opened; install the DMG manually (Apple Silicon: -arm64, Intel: -x64)',
  '【macOS 更新说明】当前版本暂不支持自动更新，请手动下载安装：': '[macOS] This version does not support auto-update; download and install manually: ',
  'Apple Silicon（M 系列芯片）下载 -arm64.dmg；Intel 机型下载 -x64.dmg。': 'Apple Silicon: download -arm64.dmg; Intel: download -x64.dmg.',
}

const DICTS = { zh, en }

function resolve(lang, key) {
  // zh 优先取 zh，其次原样（key 本身通常已是中文）；不回退到 en（避免中文界面出现英文）
  if (lang === 'zh') return zh[key] !== undefined ? zh[key] : key
  // en 优先取 en，其次 zh，再原样；回退 zh 时在 DEV 下告警，便于发现遗漏
  if (en[key] !== undefined) return en[key]
  if (zh[key] !== undefined) {
    if (import.meta.env?.DEV) console.warn('[i18n] missing en key:', key)
    return zh[key]
  }
  return key
}

function translate(lang, key, vars) {
  let s = resolve(lang, key)
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v))
    }
  }
  return s
}

// ts：翻译一个「动态原文/后端消息」。en 下先精确匹配，再按已知正则兜底；zh 原样返回。
function ts(lang, s) {
  if (lang !== 'en') return s
  if (s == null) return s
  const exact = en[s]
  if (exact !== undefined) return exact
  let m

  // —— 文件上传校验（validateFile 动态拼接）——
  m = /^不支持的格式\s*"([^"]*)"，仅支持 ([\s\S]+)$/.exec(s)
  if (m) return `Unsupported format "${m[1]}"; only ${m[2]} are supported`
  m = /^文件大小 \(([^)]*)\) 超出限制（([^）]*) 最大 (\d+(?:\.\d+)?) MB）$/.exec(s)
  if (m) return `File size (${m[1]}) exceeds the limit (${m[3]} MB max for ${m[2]})`

  // ---- 转换组件（converters-component.cjs，含变量 detail）——
  m = /^组件包含不允许的文件：([\s\S]*)$/.exec(s)
  if (m) return `Component contains a disallowed file: ${m[1]}`
  m = /^组件文件解压失败：([\s\S]*)$/.exec(s)
  if (m) return 'Component extraction failed: ' + m[1]
  m = /^组件需要主程序\s*(\S+)\s*及以上，请先升级应用$/.exec(s)
  if (m) return `Component requires app ${m[1]} or newer; please update the app`
  m = /^当前版本（v\s*(\S+)）暂无匹配的转换组件包，请稍后再试或升级应用$/.exec(s)
  if (m) return `No matching converter package for current version (v ${m[2]}); try again later or update the app`

  // ---- 自动更新（updater.cjs）——
  m = /^安装失败：([\s\S]*)$/.exec(s)
  if (m) return 'Installation failed: ' + m[1]
  m = /^GitHub 响应异常（HTTP (\d+)）$/.exec(s)
  if (m) return `GitHub returned an error (HTTP ${m[1]})`
  m = /^下载失败（HTTP (\d+)）$/.exec(s)
  if (m) return `Download failed (HTTP ${m[1]})`
  m = /^已自动切换（上一源：([^）]*)）$/.exec(s)
  if (m) return `Switched automatically (previous source: ${m[1]})`
  m = /^feed 版本不高于当前（([\s\S]*)$/.exec(s)
  if (m) return `Feed version is not newer than current (${m[1]}`
  m = /^差量引擎全部源失败：([\s\S]*)$/.exec(s)
  if (m) return `All incremental sources failed: ${m[1]}`
  m = /^所有下载源均失败：([\s\S]*)$/.exec(s)
  if (m) return `All download sources failed: ${m[1]}`
  if (s.endsWith('·差量')) return s.slice(0, -('·差量').length) + ' (delta)'
  m = /^当前源速度过慢（([\s\S]*)$/.exec(s)
  if (m) return 'Current source is too slow (' + m[1]

  return s
}

// ---------- React Context ----------
const LangContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(loadLang)
  const value = useMemo(() => {
    const setLang = (l) => {
      setLangState(l)
      try { localStorage.setItem(STORAGE_KEY, l) } catch { /* ignore */ }
    }
    const t = (k, vars) => translate(lang, k, vars)
    const ts2 = (s) => ts(lang, s) // 翻译后端/校验原文；未收录原样
    return { lang, setLang, t, ts: ts2 }
  }, [lang])

  // 窗口标题与 <html lang> 随语言切换（覆盖 main.cjs 默认中文标题；供读屏/拼写/断词使用）
  useEffect(() => {
    document.title = translate(lang, 'header.app')
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  }, [lang])

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useI18n() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}