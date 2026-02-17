// tests/monorepo-integrity.test.mjs
// ============================================================
// Monorepo Integration Tests
// Verifies workspace structure, build outputs, and cross-package
// dependencies are correctly configured.
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.error(`  FAIL  ${message}`);
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function readJSON(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf-8'));
}

// ============================================================
// 1. Workspace Structure
// ============================================================
console.log('\n=== 1. Workspace Structure ===');

assert(fileExists('pnpm-workspace.yaml'), 'pnpm-workspace.yaml exists');
assert(fileExists('package.json'), 'Root package.json exists');
assert(fileExists('packages/core/package.json'), 'packages/core/package.json exists');
assert(fileExists('packages/client/package.json'), 'packages/client/package.json exists');
assert(fileExists('apps/demo/package.json'), 'apps/demo/package.json exists');
assert(fileExists('yoin-worker/package.json'), 'yoin-worker/package.json exists');

// ============================================================
// 2. Package Names and Versions
// ============================================================
console.log('\n=== 2. Package Configuration ===');

const rootPkg = readJSON('package.json');
assert(rootPkg.name === 'yoin-monorepo', 'Root package name is yoin-monorepo');
assert(rootPkg.private === true, 'Root package is private');

const corePkg = readJSON('packages/core/package.json');
assert(corePkg.name === '@yoin/core', 'Core package name is @yoin/core');
assert(corePkg.private === true, 'Core package is private (not publishable)');

const clientPkg = readJSON('packages/client/package.json');
assert(clientPkg.name === '@yoin/client', 'Client package name is @yoin/client');
assert(clientPkg.version === '0.1.0', 'Client version is 0.1.0');
assert(clientPkg.type === 'module', 'Client is ESM module');

const demoPkg = readJSON('apps/demo/package.json');
assert(demoPkg.name === '@yoin/demo', 'Demo package name is @yoin/demo');

// ============================================================
// 3. Cross-Package Dependencies
// ============================================================
console.log('\n=== 3. Cross-Package Dependencies ===');

assert(
  clientPkg.devDependencies?.['@yoin/core'] === 'workspace:*',
  '@yoin/client devDepends on @yoin/core (workspace:*) — bundled at build time',
);

assert(
  demoPkg.dependencies?.['@yoin/client'] === 'workspace:*',
  '@yoin/demo depends on @yoin/client (workspace:*)',
);

assert(
  demoPkg.dependencies?.['@yoin/core'] === 'workspace:*',
  '@yoin/demo depends on @yoin/core (workspace:*)',
);

// ============================================================
// 4. Client Package Exports
// ============================================================
console.log('\n=== 4. Client Package Exports ===');

assert(clientPkg.exports['.'], '@yoin/client has "." export');
assert(clientPkg.exports['./react'], '@yoin/client has "./react" export');
assert(
  clientPkg.exports['.'].import === './dist/index.js',
  'Main ESM entry is ./dist/index.js',
);
assert(
  clientPkg.exports['.'].require === './dist/index.cjs',
  'Main CJS entry is ./dist/index.cjs',
);
assert(
  clientPkg.exports['.'].types === './dist/index.d.ts',
  'Main types entry is ./dist/index.d.ts',
);
assert(
  clientPkg.exports['./react'].import === './dist/react.js',
  'React ESM entry is ./dist/react.js',
);

// ============================================================
// 5. Core Package Exports
// ============================================================
console.log('\n=== 5. Core Package Exports ===');

assert(corePkg.exports['.'], '@yoin/core has "." export');
assert(
  corePkg.exports['.'].import === './pkg-web/core.js',
  'Core ESM entry is ./pkg-web/core.js',
);
assert(
  corePkg.exports['.'].types === './pkg-web/core.d.ts',
  'Core types entry is ./pkg-web/core.d.ts',
);

// ============================================================
// 6. WASM Build Output
// ============================================================
console.log('\n=== 6. WASM Build Output ===');

assert(fileExists('packages/core/pkg-web/core.js'), 'core.js exists in pkg-web');
assert(fileExists('packages/core/pkg-web/core.d.ts'), 'core.d.ts exists in pkg-web');
assert(
  fileExists('packages/core/pkg-web/core_bg.wasm') || fileExists('packages/core/pkg-web/core_bg.wasm.d.ts'),
  'WASM file or its declaration exists',
);

// ============================================================
// 7. Client Build Output
// ============================================================
console.log('\n=== 7. Client Build Output ===');

assert(fileExists('packages/client/dist/index.js'), 'dist/index.js (ESM) exists');
assert(fileExists('packages/client/dist/index.cjs'), 'dist/index.cjs (CJS) exists');
assert(fileExists('packages/client/dist/index.d.ts'), 'dist/index.d.ts (DTS) exists');
assert(fileExists('packages/client/dist/react.js'), 'dist/react.js (React ESM) exists');
assert(fileExists('packages/client/dist/react.cjs'), 'dist/react.cjs (React CJS) exists');
assert(fileExists('packages/client/dist/react.d.ts'), 'dist/react.d.ts (React DTS) exists');

// ============================================================
// 8. Source File Completeness
// ============================================================
console.log('\n=== 8. Source File Completeness ===');

const clientSrcFiles = [
  'packages/client/src/index.ts',
  'packages/client/src/YoinClient.ts',
  'packages/client/src/types.ts',
  'packages/client/src/plugin.ts',
  'packages/client/src/network.ts',
  'packages/client/src/storage.ts',
  'packages/client/src/proxy.ts',
  'packages/client/src/logger.ts',
  'packages/client/src/wasm/loader.ts',
  'packages/client/src/plugins/undo.ts',
  'packages/client/src/plugins/db.ts',
  'packages/client/src/plugins/index.ts',
  'packages/client/src/react/index.tsx',
];

for (const file of clientSrcFiles) {
  assert(fileExists(file), `Source file exists: ${file}`);
}

// ============================================================
// 9. Old Directory Parity Check
// ============================================================
console.log('\n=== 9. Old vs New Directory Parity ===');

// Verify old client source files have equivalents in new location
const oldClientFiles = [
  'client/src/yoin/index.ts',
  'client/src/yoin/YoinClient.ts',
  'client/src/yoin/types.ts',
  'client/src/yoin/plugin.ts',
  'client/src/yoin/network.ts',
  'client/src/yoin/storage.ts',
  'client/src/yoin/proxy.ts',
  'client/src/yoin/logger.ts',
  'client/src/yoin/plugins/undo.ts',
  'client/src/yoin/plugins/db.ts',
  'client/src/yoin/plugins/index.ts',
];

const newClientMap = {
  'client/src/yoin/index.ts': 'packages/client/src/index.ts',
  'client/src/yoin/YoinClient.ts': 'packages/client/src/YoinClient.ts',
  'client/src/yoin/types.ts': 'packages/client/src/types.ts',
  'client/src/yoin/plugin.ts': 'packages/client/src/plugin.ts',
  'client/src/yoin/network.ts': 'packages/client/src/network.ts',
  'client/src/yoin/storage.ts': 'packages/client/src/storage.ts',
  'client/src/yoin/proxy.ts': 'packages/client/src/proxy.ts',
  'client/src/yoin/logger.ts': 'packages/client/src/logger.ts',
  'client/src/yoin/plugins/undo.ts': 'packages/client/src/plugins/undo.ts',
  'client/src/yoin/plugins/db.ts': 'packages/client/src/plugins/db.ts',
  'client/src/yoin/plugins/index.ts': 'packages/client/src/plugins/index.ts',
};

for (const [oldFile, newFile] of Object.entries(newClientMap)) {
  if (fileExists(oldFile)) {
    assert(fileExists(newFile), `Migration parity: ${oldFile} -> ${newFile}`);
  }
}

// Verify core WASM sources
assert(fileExists('packages/core/src/lib.rs'), 'Core Rust source exists at packages/core/src/lib.rs');
assert(fileExists('packages/core/Cargo.toml'), 'Core Cargo.toml exists at packages/core/Cargo.toml');

// ============================================================
// 10. Build Scripts Completeness
// ============================================================
console.log('\n=== 10. Build Scripts ===');

assert(rootPkg.scripts?.['build:wasm'], 'Root has build:wasm script');
assert(rootPkg.scripts?.['build:client'], 'Root has build:client script');
assert(rootPkg.scripts?.['build:demo'], 'Root has build:demo script');
assert(rootPkg.scripts?.build, 'Root has build script');
assert(rootPkg.scripts?.typecheck, 'Root has typecheck script');
assert(rootPkg.scripts?.clean, 'Root has clean script');
assert(clientPkg.scripts?.build, 'Client has build script');
assert(clientPkg.scripts?.typecheck, 'Client has typecheck script');
assert(clientPkg.scripts?.test, 'Client has test script');
assert(clientPkg.scripts?.['test:coverage'], 'Client has test:coverage script');

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`Integration Test Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}

console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
