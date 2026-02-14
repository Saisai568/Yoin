@echo off
echo [1/3] Building Rust Core...
cd core
wasm-pack build --target web
if %errorlevel% neq 0 exit /b %errorlevel%

echo [2/3] Deploying Backend Worker...
cd ../yoin-worker
call npm run deploy
if %errorlevel% neq 0 exit /b %errorlevel%

echo [3/3] Building & Deploying Frontend Client...
cd ../client
call npm run build
call npx wrangler pages deploy dist --project-name=yoin-client
echo Done!
cd ..
pause