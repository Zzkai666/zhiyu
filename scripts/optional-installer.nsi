Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"
!include "x64.nsh"
Name "知屿"
OutFile "${OUTPUT}"
InstallDir ""
RequestExecutionLevel user
SetCompressor /SOLID zlib
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "知屿"
VIAddVersionKey /LANG=2052 "FileDescription" "知屿工作台与可选桌面小岛"
VIAddVersionKey /LANG=2052 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "ResearchDesk Contributors"
Var RegKey
Var TestMode
Var NoShortcuts
Var Params
Var Choice
Var QuietCheck
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_TEXT_TOP "工作台可以独立使用。需要在桌面查看待办、重要日期等功能时，请勾选桌面小岛；以后也可以重新运行安装包补装。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Function ValidateTarget
 ${GetRoot} "$INSTDIR" $0
 StrCmp "$INSTDIR" "$0" invalid
 StrCmp "$INSTDIR" "$0\" invalid
 StrCmp "$INSTDIR" "" invalid
 ClearErrors
 FindFirst $2 $3 "$INSTDIR\*"
 IfErrors valid
loop:
 StrCmp $3 "." next
 StrCmp $3 ".." next
 FindClose $2
 ReadINIStr $0 "$INSTDIR\.researchdesk-next.ini" "Product" "ID"
 StrCmp $0 "ResearchDesk-Next-Components-v1" valid invalid
next:
 FindNext $2 $3
 IfErrors empty
 Goto loop
empty:
 FindClose $2
valid:
 Return
invalid:
 ${If} $QuietCheck != 1
  MessageBox MB_ICONSTOP "请选择空目录，或原有的知屿 / ResearchDesk Next 安装目录。不能覆盖其他软件和资料目录。" /SD IDOK
 ${EndIf}
 SetErrorLevel 2
 Abort
FunctionEnd
Function .onVerifyInstDir
 StrCpy $QuietCheck 1
 Call ValidateTarget
 StrCpy $QuietCheck 0
FunctionEnd
Section "知屿工作台（必选）" Core
 SectionIn RO
 StrCpy $QuietCheck 0
 Call ValidateTarget
 IfFileExists "$INSTDIR\ResearchDesk Next.exe" 0 checkCore
 ClearErrors
 FileOpen $0 "$INSTDIR\ResearchDesk Next.exe" a
 IfErrors busy
 FileClose $0
checkCore:
 IfFileExists "$INSTDIR\resources\bin\researchdesk-core.exe" 0 checkIsland
 ClearErrors
 FileOpen $0 "$INSTDIR\resources\bin\researchdesk-core.exe" a
 IfErrors busy
 FileClose $0
checkIsland:
 IfFileExists "$INSTDIR\resources\bin\researchdesk-island.exe" 0 copy
 ClearErrors
 FileOpen $0 "$INSTDIR\resources\bin\researchdesk-island.exe" a
 IfErrors busy
 FileClose $0
copy:
 !include "${CORE_FILES}"
 Goto end
busy:
 MessageBox MB_ICONSTOP "请先从托盘完整退出知屿 / ResearchDesk Next，再继续安装。" /SD IDOK
 SetErrorLevel 2
 Abort
end:
SectionEnd
Section /o "桌面小岛（可选）" Island
 SetOutPath "$INSTDIR\resources\bin"
 File "${ISLAND_FILE}"
SectionEnd
Section -Finish
 SectionGetFlags ${Island} $0
 IntOp $Choice $0 & ${SF_SELECTED}
 ${If} $Choice == 0
  Delete "$INSTDIR\resources\bin\researchdesk-island.exe"
 ${EndIf}
 WriteINIStr "$INSTDIR\.researchdesk-next.ini" "Product" "ID" "ResearchDesk-Next-Components-v1"
 WriteINIStr "$INSTDIR\.researchdesk-next.ini" "Product" "Island" "$Choice"
 WriteINIStr "$INSTDIR\.researchdesk-next.ini" "Product" "TestMode" "$TestMode"
 WriteINIStr "$INSTDIR\.researchdesk-next.ini" "Product" "NoShortcuts" "$NoShortcuts"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 ${If} $NoShortcuts != 1
  Delete "$DESKTOP\ResearchDesk Next.lnk"
  Delete "$SMPROGRAMS\ResearchDesk Next\ResearchDesk Next.lnk"
  Delete "$SMPROGRAMS\ResearchDesk Next\卸载.lnk"
  RMDir "$SMPROGRAMS\ResearchDesk Next"
  CreateShortcut "$DESKTOP\知屿.lnk" "$INSTDIR\ResearchDesk Next.exe"
  CreateDirectory "$SMPROGRAMS\知屿"
  CreateShortcut "$SMPROGRAMS\知屿\知屿.lnk" "$INSTDIR\ResearchDesk Next.exe"
  CreateShortcut "$SMPROGRAMS\知屿\卸载.lnk" "$INSTDIR\Uninstall.exe"
 ${EndIf}
 WriteRegStr HKCU "$RegKey" "DisplayName" "知屿"
 WriteRegStr HKCU "$RegKey" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "$RegKey" "InstallLocation" "$INSTDIR"
 WriteRegDWORD HKCU "$RegKey" "Island" $Choice
 WriteRegStr HKCU "$RegKey" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegStr HKCU "$RegKey" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
 WriteRegDWORD HKCU "$RegKey" "NoModify" 1
 WriteRegDWORD HKCU "$RegKey" "NoRepair" 1
SectionEnd
Function .onInit
 SetShellVarContext current
 SetRegView 64
 ${IfNot} ${RunningX64}
  MessageBox MB_ICONSTOP "此版本需要64位Windows。" /SD IDOK
  Abort
 ${EndIf}
 StrCpy $RegKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResearchDeskNext"
 StrCpy $NoShortcuts 0
 StrCpy $TestMode 0
 ${GetParameters} $Params
 ClearErrors
 ${GetOptions} $Params "/TEST=" $0
 ${IfNot} ${Errors}
  ${If} $0 == 1
   StrCpy $TestMode 1
   StrCpy $RegKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResearchDeskNextAcceptance"
  ${EndIf}
 ${EndIf}
 ClearErrors
 ${GetOptions} $Params "/SHORTCUTS=" $0
 ${IfNot} ${Errors}
  ${If} $0 == 0
   StrCpy $NoShortcuts 1
  ${EndIf}
 ${EndIf}
 ${If} $INSTDIR == ""
  ReadRegStr $INSTDIR HKCU "$RegKey" "InstallLocation"
  ${If} $INSTDIR == ""
   StrCpy $INSTDIR "$LOCALAPPDATA\Programs\ResearchDesk Next"
  ${EndIf}
 ${EndIf}
 ClearErrors
 ReadINIStr $Choice "$INSTDIR\.researchdesk-next.ini" "Product" "Island"
 ${IfNot} ${Errors}
  ${If} $Choice == 1
   !insertmacro SelectSection ${Island}
  ${EndIf}
 ${EndIf}
 ClearErrors
 ${GetOptions} $Params "/ISLAND=" $0
 ${IfNot} ${Errors}
  ${If} $0 == 1
   !insertmacro SelectSection ${Island}
  ${ElseIf} $0 == 0
   !insertmacro UnselectSection ${Island}
  ${Else}
   SetErrorLevel 2
   Abort
  ${EndIf}
 ${EndIf}
FunctionEnd
Function un.onInit
 SetShellVarContext current
 SetRegView 64
 ReadINIStr $0 "$INSTDIR\.researchdesk-next.ini" "Product" "ID"
 StrCmp $0 "ResearchDesk-Next-Components-v1" check refuse
check:
 ReadINIStr $TestMode "$INSTDIR\.researchdesk-next.ini" "Product" "TestMode"
 ReadINIStr $NoShortcuts "$INSTDIR\.researchdesk-next.ini" "Product" "NoShortcuts"
 StrCpy $RegKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResearchDeskNext"
 ${If} $TestMode == 1
  StrCpy $RegKey "Software\Microsoft\Windows\CurrentVersion\Uninstall\ResearchDeskNextAcceptance"
 ${EndIf}
 IfFileExists "$INSTDIR\ResearchDesk Next.exe" 0 refuse
 ClearErrors
 FileOpen $0 "$INSTDIR\ResearchDesk Next.exe" a
 IfErrors refuse
 FileClose $0
 IfFileExists "$INSTDIR\resources\bin\researchdesk-core.exe" 0 native
 ClearErrors
 FileOpen $0 "$INSTDIR\resources\bin\researchdesk-core.exe" a
 IfErrors refuse
 FileClose $0
native:
 IfFileExists "$INSTDIR\resources\bin\researchdesk-island.exe" 0 done
 ClearErrors
 FileOpen $0 "$INSTDIR\resources\bin\researchdesk-island.exe" a
 IfErrors refuse
 FileClose $0
done:
 Return
refuse:
 MessageBox MB_ICONSTOP "无法核对安装目录，或软件仍在运行。请先从托盘完整退出。" /SD IDOK
 SetErrorLevel 2
 Abort
FunctionEnd
Section "Uninstall"
 ; Frozen file list and empty directories only; never recurse or touch userData.
 !include "${REMOVE_FILES}"
 Delete "$INSTDIR\.researchdesk-next.ini"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 ${If} $NoShortcuts != 1
  Delete "$DESKTOP\知屿.lnk"
  Delete "$SMPROGRAMS\知屿\知屿.lnk"
  Delete "$SMPROGRAMS\知屿\卸载.lnk"
  RMDir "$SMPROGRAMS\知屿"
  Delete "$DESKTOP\ResearchDesk Next.lnk"
  Delete "$SMPROGRAMS\ResearchDesk Next\ResearchDesk Next.lnk"
  Delete "$SMPROGRAMS\ResearchDesk Next\卸载.lnk"
  RMDir "$SMPROGRAMS\ResearchDesk Next"
 ${EndIf}
 ${If} $TestMode != 1
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ResearchDesk Next"
  ${If} $0 == '"$INSTDIR\ResearchDesk Next.exe"'
   DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ResearchDesk Next"
  ${ElseIf} $0 == "$INSTDIR\ResearchDesk Next.exe"
   DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ResearchDesk Next"
  ${EndIf}
 ${EndIf}
 ReadRegStr $0 HKCU "$RegKey" "InstallLocation"
 ${If} $0 == $INSTDIR
  DeleteRegKey HKCU "$RegKey"
 ${EndIf}
SectionEnd
