@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem --- MSYS2 ucrt64 must be on PATH or g++ dies with missing libgmp/libisl/libmpc/libmpfr ---
set "MSYS=C:\msys64\ucrt64\bin"
if not exist "%MSYS%\g++.exe" (
    echo [-] MSYS2 not found at C:\msys64. install MSYS2.MSYS2 first.
    pause & exit /b 1
)
set "PATH=%MSYS%;%PATH%"

echo [*] checking toolchain...
"%MSYS%\g++.exe" --version >nul 2>nul
if errorlevel 1 (
    echo [-] g++.exe broken. rerun: pacman -S mingw-w64-ucrt-x86_64-gcc
    pause & exit /b 1
)

if not exist "Npcap\Include\pcap.h" (
    echo [-] Npcap SDK missing. download from https://npcap.com/#download
    echo     extract so Npcap\Include and Npcap\Lib\x64 exist.
    pause & exit /b 1
)

echo [*] compiling resources...
cd src
"%MSYS%\windres.exe" -O coff auto_attack.rc -o auto_attack_res.o
if errorlevel 1 ( echo [-] windres failed for engine & cd .. & pause & exit /b 1 )
"%MSYS%\windres.exe" -O coff gui.rc -o gui_res.o
if errorlevel 1 ( echo [-] windres failed for gui & cd .. & pause & exit /b 1 )
cd ..

echo [*] building engine: auto_attack.exe ...
"%MSYS%\g++.exe" -O2 -s -std=c++17 "src\auto_attack.cpp" "src\auto_attack_res.o" -o "auto_attack.exe" ^
    -I"Npcap\Include" -L"Npcap\Lib\x64" ^
    -lwpcap -lPacket -lws2_32 -liphlpapi -ladvapi32 -static -static-libgcc -static-libstdc++
if errorlevel 1 (
    echo [-] engine build failed
    pause & exit /b 1
)

echo [*] building GUI: auto_attack_gui.exe ...
rem -O1 for the GUI: GCC 16 -O2 merges long string literals in .rdata in a way
rem that can corrupt UI text; the GUI has no perf-critical code, so -O1 is safer
"%MSYS%\g++.exe" -O1 -s -std=c++17 -mwindows -municode "src\gui_main.cpp" "src\gui_res.o" -o "auto_attack_gui.exe" ^
    -lcomctl32 -luxtheme -lcomdlg32 -lgdi32 -luser32 -ladvapi32 -liphlpapi -lshell32 -static -static-libgcc -static-libstdc++
if errorlevel 1 (
    echo [-] GUI build failed
    pause & exit /b 1
)

rem --- stage release folder ---
echo [*] staging dist\ ...
if exist "dist" rmdir /s /q "dist"
mkdir "dist"
copy /y "auto_attack.exe"      "dist\" >nul
copy /y "auto_attack_gui.exe"  "dist\" >nul
copy /y "README.txt"           "dist\" >nul
xcopy /e /i /y "src" "dist\src" >nul
echo     (exes are statically linked - only wpcap.dll from the Npcap
echo      runtime is needed, it is installed system-wide)

echo.
echo [+] build complete.
echo     GUI:  auto_attack_gui.exe   (run as Administrator)
echo     CLI:  auto_attack.exe --adapter=N
echo     dist: dist\  (release folder)
echo.
pause
