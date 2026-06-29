@echo off
cd /d "%~dp0"
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "ANDROID_HOME=C:\Android\Sdk"
call "C:\Users\HONOR\.gradle\wrapper\dists\gradle-8.14-bin\38aieal9i53h9rfe7vjup95b9\gradle-8.14\bin\gradle.bat" assembleDebug --no-daemon --console=plain
exit /b %ERRORLEVEL%
