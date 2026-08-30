#!/bin/bash
# electron-builder afterInstall 脚本
# 确保 chrome-sandbox 有 SUID 权限
CHROME_SANDBOX="${APPDIR}/chrome-sandbox"
if [ -f "$CHROME_SANDBOX" ]; then
    chmod 4755 "$CHROME_SANDBOX" || true
fi

# 确保 doclite 可执行
chmod 755 "${APPDIR}/doclite" || true

exit 0