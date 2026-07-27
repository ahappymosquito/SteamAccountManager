; Refreshes only shortcuts the user already had so Windows reloads the updated application icon.
!macro RefreshExistingAppShortcut ShortcutPath
  ${If} ${FileExists} "${ShortcutPath}"
    Delete "${ShortcutPath}"
    CreateShortcut "${ShortcutPath}" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "${ShortcutPath}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $UpdateMode = 1
    !insertmacro RefreshExistingAppShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
    !insertmacro RefreshExistingAppShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    !insertmacro RefreshExistingAppShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  ${EndIf}
!macroend
