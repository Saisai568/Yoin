/**
 * Core WASM Integration Test
 * Validates all 6 optimizations work correctly:
 * 1. JsValue returns (no JSON serialization overhead)
 * 2. Lazy UndoManager initialization
 * 3. batch_set (single transaction batching)
 * 4. Unified Result error handling
 * 5. Build optimizations (validated by compilation)
 * 6. Origin tagging (byte-based, verified via undo behavior)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { YoinDoc, init_panic_hook } = require('./pkg-node/core.js');

init_panic_hook();

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
        passed++;
    } else {
        console.error(`  ❌ ${message}`);
        failed++;
    }
}

function assertEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`  ✅ ${message}`);
        passed++;
    } else {
        console.error(`  ❌ ${message} — expected ${e}, got ${a}`);
        failed++;
    }
}

// ==========================================
// Test 1: Basic Text CRDT
// ==========================================
console.log('\n📝 Test 1: Text Operations (Result-wrapped)');
{
    const doc = new YoinDoc();
    const update1 = doc.insert_text("content", 0, "Hello");
    assert(update1 instanceof Uint8Array && update1.length > 0, "insert_text returns Uint8Array via Result");

    const update2 = doc.insert_text("content", 5, " World");
    assert(update2 instanceof Uint8Array && update2.length > 0, "second insert returns Uint8Array");

    const text = doc.get_text("content");
    assertEqual(text, "Hello World", "get_text returns combined text");

    const update3 = doc.delete_text("content", 5, 6);
    assert(update3 instanceof Uint8Array && update3.length > 0, "delete_text returns Uint8Array via Result");

    assertEqual(doc.get_text("content"), "Hello", "text after delete");
    doc.free();
}

// ==========================================
// Test 2: Map Operations with JsValue returns
// ==========================================
console.log('\n🗺️ Test 2: Map Operations (JsValue returns)');
{
    const doc = new YoinDoc();

    const update1 = doc.map_set("settings", "theme", "dark");
    assert(update1 instanceof Uint8Array, "map_set returns Uint8Array via Result");

    const update2 = doc.map_set("settings", "fontSize", "14");
    assert(update2 instanceof Uint8Array, "map_set for another key works");

    // map_get_all now returns native JS object (optimization #1)
    const allData = doc.map_get_all("settings");
    assert(typeof allData === 'object' && allData !== null, "map_get_all returns native JS object (not string)");
    assertEqual(allData.theme, "dark", "map value theme is correct");
    assertEqual(allData.fontSize, "14", "map value fontSize is correct");

    // map_get now returns JsValue
    const singleVal = doc.map_get("settings", "theme");
    assertEqual(singleVal, "dark", "map_get returns native JsValue");

    // map_get for nonexistent key
    const nullVal = doc.map_get("settings", "nonexistent");
    assertEqual(nullVal, null, "map_get for missing key returns null");

    doc.free();
}

// ==========================================
// Test 3: Array Operations with JsValue returns
// ==========================================
console.log('\n📋 Test 3: Array Operations (JsValue returns)');
{
    const doc = new YoinDoc();

    const u1 = doc.array_push("logs", "event1");
    assert(u1 instanceof Uint8Array, "array_push returns Uint8Array via Result");

    doc.array_push("logs", "event2");
    doc.array_push("logs", "event3");

    // array_get_all now returns native JS array (optimization #1)
    const allItems = doc.array_get_all("logs");
    assert(Array.isArray(allItems), "array_get_all returns native JS array (not string)");
    assertEqual(allItems.length, 3, "array has 3 items");
    assertEqual(allItems[0], "event1", "first item correct");
    assertEqual(allItems[2], "event3", "third item correct");

    // array_get now returns JsValue
    const item = doc.array_get("logs", 1);
    assertEqual(item, "event2", "array_get returns native JsValue");

    doc.free();
}

// ==========================================
// Test 4: map_set_deep
// ==========================================
console.log('\n🌳 Test 4: Deep Map Operations');
{
    const doc = new YoinDoc();

    const update = doc.map_set_deep("root_map", ["user", "name"], "Alice");
    assert(update instanceof Uint8Array && update.length > 0, "map_set_deep returns Uint8Array");

    doc.map_set_deep("root_map", ["user", "age"], 30);
    doc.map_set_deep("root_map", ["settings", "darkMode"], true);

    const all = doc.map_get_all("root_map");
    assert(typeof all === 'object', "deep map returns native object");
    assertEqual(all.user?.name, "Alice", "nested string value correct");
    assertEqual(all.user?.age, 30, "nested number value correct");
    assertEqual(all.settings?.darkMode, true, "nested boolean value correct");

    doc.free();
}

// ==========================================
// Test 5: Lazy UndoManager (optimization #2)
// ==========================================
console.log('\n↩️ Test 5: Lazy UndoManager');
{
    const doc = new YoinDoc();
    // At this point, UndoManager should NOT be initialized yet
    // We can still use the doc for read/write without Undo overhead

    doc.map_set("data", "key1", "val1");
    assertEqual(doc.map_get_all("data").key1, "val1", "write works without UndoManager");

    // Now trigger undo — this should lazily create UndoManager
    const undoResult = doc.undo();
    assert(undoResult instanceof Uint8Array, "undo works after lazy init");

    // enable_undo explicit call
    const doc2 = new YoinDoc();
    doc2.enable_undo();
    doc2.insert_text("content", 0, "test");
    const undoDiff = doc2.undo();
    // Undo should revert the insertion
    assertEqual(doc2.get_text("content"), "", "undo reverts text after enable_undo");
    assert(undoDiff.length > 0, "undo returns non-empty diff");

    // expand_undo_scope
    doc2.expand_undo_scope("custom_map");
    doc2.map_set("custom_map", "x", "1");
    const undoDiff2 = doc2.undo();
    const customMap = doc2.map_get_all("custom_map");
    // After undo, the custom_map should be empty (x was undone)
    assert(!customMap.x || customMap.x === undefined, "expand_undo_scope allows undo of custom maps");

    doc.free();
    doc2.free();
}

// ==========================================
// Test 6: batch_set (optimization #3)
// ==========================================
console.log('\n📦 Test 6: Batch Set (Single Transaction)');
{
    const doc = new YoinDoc();
    doc.enable_undo();
    doc.expand_undo_scope("config");
    doc.expand_undo_scope("other");

    const entries = [
        ["config", "color", "red"],
        ["config", "size", "large"],
        ["other", "flag", "true"]
    ];

    const update = doc.batch_set(entries);
    assert(update instanceof Uint8Array && update.length > 0, "batch_set returns Uint8Array");

    const configMap = doc.map_get_all("config");
    assertEqual(configMap.color, "red", "batch_set: first entry correct");
    assertEqual(configMap.size, "large", "batch_set: second entry correct");

    const otherMap = doc.map_get_all("other");
    assertEqual(otherMap.flag, "true", "batch_set: cross-map entry correct");

    // Key test: single undo should revert ALL batch_set operations
    const undoDiff = doc.undo();
    assert(undoDiff.length > 0, "undo after batch_set returns diff");
    
    const configAfterUndo = doc.map_get_all("config");
    assert(!configAfterUndo.color, "batch undo reverts config.color");
    assert(!configAfterUndo.size, "batch undo reverts config.size");

    doc.free();
}

// ==========================================
// Test 7: Sync / Remote Operations
// ==========================================
console.log('\n🔄 Test 7: Sync Operations');
{
    const doc1 = new YoinDoc();
    const doc2 = new YoinDoc();

    // Doc1 makes changes
    doc1.insert_text("content", 0, "Sync Test");
    doc1.map_set("shared", "status", "active");

    // Export from doc1 and apply to doc2
    const fullUpdate = doc1.export_update();
    doc2.apply_update(fullUpdate);

    assertEqual(doc2.get_text("content"), "Sync Test", "synced text matches");
    assertEqual(doc2.map_get_all("shared").status, "active", "synced map matches");

    // State vector diff sync
    const sv2 = doc2.get_state_vector();
    doc1.insert_text("content", 9, "!");
    const diff = doc1.export_diff(sv2);
    doc2.apply_update(diff);
    assertEqual(doc2.get_text("content"), "Sync Test!", "incremental diff sync works");

    // Verify remote updates don't affect undo stack
    doc2.enable_undo();
    doc2.insert_text("content", 0, "LOCAL_");
    assertEqual(doc2.get_text("content"), "LOCAL_Sync Test!", "local insert before sync text");

    // Apply another remote update
    doc1.map_set("shared", "count", "42");
    const diff2 = doc1.export_diff(doc2.get_state_vector());
    doc2.apply_update(diff2);

    // Undo should only revert local operation, not remote
    const undoDiff = doc2.undo();
    assertEqual(doc2.get_text("content"), "Sync Test!", "undo only reverts local, not remote");
    assertEqual(doc2.map_get_all("shared").count, "42", "remote map data preserved after undo");

    doc1.free();
    doc2.free();
}

// ==========================================
// Test 8: Snapshot / Server support
// ==========================================
console.log('\n🖥️ Test 8: Snapshot & Server Support');
{
    const doc = new YoinDoc();
    doc.insert_text("content", 0, "Snapshot data");
    doc.map_set("meta", "version", "1");

    const snapshot = doc.snapshot();
    assert(snapshot instanceof Uint8Array && snapshot.length > 0, "snapshot returns Uint8Array");

    // Restore from snapshot
    const doc2 = new YoinDoc();
    doc2.apply_update(snapshot);
    assertEqual(doc2.get_text("content"), "Snapshot data", "restored text from snapshot");
    assertEqual(doc2.map_get_all("meta").version, "1", "restored map from snapshot");

    // get_missing_updates
    const doc3 = new YoinDoc();
    const sv3 = doc3.get_state_vector();
    const missing = doc.get_missing_updates(sv3);
    doc3.apply_update(missing);
    assertEqual(doc3.get_text("content"), "Snapshot data", "get_missing_updates works");

    doc.free();
    doc2.free();
    doc3.free();
}

// ==========================================
// Summary
// ==========================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('🎉 All tests passed!');
    process.exit(0);
}
