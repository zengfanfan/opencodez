@echo off
setlocal

for %%I in ("%~dp0..\..") do set "REPO=%%~fI"

if "%~1"=="" (
  echo Usage: %~nx0 ^<official-release-tag^>
  echo Example: %~nx0 v2.3.2
  exit /b 1
)

set "TAG=%~1"
set "BRANCH=%TAG%-z"

cd /d "%REPO%" || goto :error

git status --porcelain | findstr . >nul
if not errorlevel 1 goto :dirty

git fetch upstream "+refs/tags/*:refs/tags/*" || goto :error
git rev-parse -q --verify "refs/tags/%TAG%" >nul || goto :notag

git switch -c "%BRANCH%" "%TAG%" || goto :error
git push -u origin "%BRANCH%" || goto :error

echo.
echo Created %BRANCH% from %TAG%.
echo Next: cherry-pick the personal commits and add this release's changes.
exit /b 0

:dirty
echo ERROR: working tree has changes. Commit or stash them first.
exit /b 1

:notag
echo ERROR: tag %TAG% not found. Run: git fetch upstream --tags
exit /b 1

:error
echo ERROR: could not create the release branch. Read the output above.
exit /b 1
