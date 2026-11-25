; build/installer.nsh —— NSIS 自定义安装脚本（package.json → build.nsis.include 自动引入）
;
; R-130（v0.8.4 用户实测「打开方式」仍显示旧长名）：
; exe 的 FileDescription 已改为短名「轻快文档工具箱」（R-122，进 exe 版本资源），
; 但 Explorer 对「打开方式」列表的应用显示名可能取缓存的 Applications 注册表旧值
; 而不重读 exe 资源。这里在安装时显式写 Applications 键的 FriendlyAppName
; （Explorer 显示名优先级最高）并广播 SHCNE_ASSOCCHANGED 通知 Shell 立即刷新，
; 覆盖安装/升级后无需用户手动重新关联默认程序。

!macro customInstall
  ; 「打开方式」应用名钉死为短名（per-user 安装时 SHELL_CONTEXT=HKCU）
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\DocLite.exe" "" "轻快文档工具箱"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\DocLite.exe" "FriendlyAppName" "轻快文档工具箱"
  ; 广播 Shell 变更：刷新文件关联/图标缓存，立即生效（无需注销重登）
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\DocLite.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
