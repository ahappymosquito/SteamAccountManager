; NSIS 安装钩子：更新后刷新已有快捷方式；安装前检测 WebView2 并从 CDN 安装。
!define WEBVIEW2_CDN_URL "https://cdn.qrqto.club/webview2/MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
!define WEBVIEW2_CDN_FILE "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"

!macro RefreshExistingAppShortcut ShortcutPath
  ${If} ${FileExists} "${ShortcutPath}"
    Delete "${ShortcutPath}"
    CreateShortcut "${ShortcutPath}" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "${ShortcutPath}"
  ${EndIf}
!macroend

!macro ReadWebView2Version
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ReadWebView2Version
  ${If} $4 != ""
    Goto webview2_cdn_done
  ${EndIf}

  ${If} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONINFORMATION "本应用需要 Microsoft Edge WebView2 Runtime。未检测到，是否现在从 CDN 下载并安装？（约 210MB）" IDYES webview2_cdn_download
    Abort "没有 WebView2 Runtime，无法继续安装。"
  ${EndIf}

  webview2_cdn_download:
    DetailPrint "正在从 CDN 下载 WebView2 Runtime..."
    StrCpy $6 "$TEMP\${WEBVIEW2_CDN_FILE}"
    Delete "$6"
    FileOpen $R9 "$TEMP\sam-webview2-download.ps1" w
    FileWrite $R9 "$$ErrorActionPreference = 'Stop'$\r$\n"
    FileWrite $R9 "$$ProgressPreference = 'SilentlyContinue'$\r$\n"
    FileWrite $R9 "Invoke-WebRequest -UseBasicParsing -Uri '${WEBVIEW2_CDN_URL}' -OutFile '$6' -TimeoutSec 1800$\r$\n"
    FileClose $R9
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$TEMP\sam-webview2-download.ps1"' $0
    Delete "$TEMP\sam-webview2-download.ps1"
    ${If} $0 <> 0
    ${OrIfNot} ${FileExists} "$6"
      ExecShell "open" "${WEBVIEW2_CDN_URL}"
      MessageBox MB_OK|MB_ICONEXCLAMATION "无法从 CDN 下载 WebView2 Runtime。已尝试打开：$\r$\n${WEBVIEW2_CDN_URL}"
      Abort "WebView2 Runtime 下载失败。"
    ${EndIf}

    DetailPrint "正在安装 WebView2 Runtime..."
    ExecWait '"$6" /install' $1
    Delete "$6"
    ${If} $1 <> 0
      ExecShell "open" "${WEBVIEW2_CDN_URL}"
      MessageBox MB_OK|MB_ICONEXCLAMATION "WebView2 Runtime 安装失败（退出码 $1）。请手动安装后重试。"
      Abort "WebView2 Runtime 安装失败。"
    ${EndIf}

    !insertmacro ReadWebView2Version
    ${If} $4 == ""
      ExecShell "open" "${WEBVIEW2_CDN_URL}"
      MessageBox MB_OK|MB_ICONEXCLAMATION "安装后仍未检测到 WebView2 Runtime。请手动安装后重试。"
      Abort "WebView2 Runtime 未安装。"
    ${EndIf}

  webview2_cdn_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $UpdateMode = 1
    !insertmacro RefreshExistingAppShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
    !insertmacro RefreshExistingAppShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    !insertmacro RefreshExistingAppShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  ${EndIf}
!macroend
