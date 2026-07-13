#!/bin/bash

# 遇到任何指令失敗時立即停止執行腳本
set -e

echo "=== Yoin Monorepo Full Deploy ==="
echo ""

echo "[1/5] Building Rust Core (wasm-pack)..."
cd packages/core
wasm-pack build --target web --out-dir pkg-web
cd ../..

echo "[2/5] Building @yoin/client SDK (tsup)..."
pnpm --filter @yoin/client build

echo "[3/5] Deploying Cloudflare Worker (Durable Objects)..."
cd yoin-worker
pnpm run deploy
cd ..

echo "[4/5] Building Demo App (Vite)..."
pnpm --filter @yoin/demo build

echo "[5/5] Deploying to Cloudflare Pages..."
pnpm --filter @yoin/demo run deploy

echo ""
echo "=== Deploy Complete ==="
