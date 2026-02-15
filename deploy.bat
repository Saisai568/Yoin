@echo off
echo === Yoin Monorepo Full Deploy ===
echo.

echo [1/5] Building Rust Core (wasm-pack)...
cd packages\core
wasm-pack build --target web --out-dir pkg-web
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..\..

echo [2/5] Building @yoin/client SDK (tsup)...
call pnpm --filter @yoin/client build
if %errorlevel% neq 0 exit /b %errorlevel%

echo [3/5] Deploying Cloudflare Worker (Durable Objects)...
cd yoin-worker
call pnpm run deploy
if %errorlevel% neq 0 exit /b %errorlevel%
cd ..

echo [4/5] Building Demo App (Vite)...
call pnpm --filter @yoin/demo build
if %errorlevel% neq 0 exit /b %errorlevel%

echo [5/5] Deploying to Cloudflare Pages...
call pnpm --filter @yoin/demo run deploy
if %errorlevel% neq 0 exit /b %errorlevel%

echo.
echo === Deploy Complete ===
pause