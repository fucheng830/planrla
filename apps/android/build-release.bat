@echo off
cd /d "%~dp0"
set "JAVA_HOME=C:Program FilesEclipse Adoptiumjdk-17.0.20.8-hotspot"
set "ANDROID_HOME=C:AndroidSdk"
call "C:UsersHONOR.gradlewrapperdistsgradle-8.14.3-allutluxaxniiv4wxiphsi49njgradle-8.14.3ingradle.bat" assembleRelease --no-daemon --console=plain
exit /b %ERRORLEVEL%
