use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use yoin_core::YoinDocCore;
use yoin_sync_server::auth::TicketStore;
use yoin_sync_server::create_router;
use yoin_sync_server::protocol::*;
use yoin_sync_server::room_manager::RoomManager;
use yoin_sync_server::storage::{FileStorage, MemoryStorage};
use yoin_sync_server::ws::AppState;

/// Helper to launch an ephemeral test server on an OS-assigned random port (127.0.0.1:0)
async fn start_test_server(storage: Arc<dyn yoin_sync_server::storage::RoomStorage>) -> (String, Arc<AppState>) {
    let ticket_store = TicketStore::new();
    let room_manager = RoomManager::new(storage);
    let state = Arc::new(AppState {
        room_manager,
        ticket_store,
        allow_anonymous_dev: true,
    });

    let app = create_router(state.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    (format!("127.0.0.1:{}", addr.port()), state)
}

#[tokio::test]
async fn test_multi_client_convergence_and_ack() {
    let storage = Arc::new(MemoryStorage::new());
    let (addr, state) = start_test_server(storage).await;

    // 1. Issue tickets for Alice and Bob
    let (tkt_alice, _) = state.ticket_store.create_ticket("room-1", "user-alice", "Alice", "editor", 60);
    let (tkt_bob, _) = state.ticket_store.create_ticket("room-1", "user-bob", "Bob", "editor", 60);

    // 2. Connect Alice over WebSocket
    let alice_url = format!("ws://{}/ws/sync/room-1?ticket={}", addr, tkt_alice);
    let (mut alice_ws, _) = connect_async(alice_url).await.unwrap();

    // Alice should immediately receive MSG_HELLO
    let first_msg = alice_ws.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = first_msg {
        assert_eq!(bin[0], MSG_HELLO);
        let hello: HelloPayload = serde_json::from_slice(&bin[1..]).unwrap();
        assert_eq!(hello.role, "editor");
        assert_eq!(hello.user_id, "user-alice");
    } else {
        panic!("Expected binary MSG_HELLO");
    }

    // 3. Connect Bob over WebSocket
    let bob_url = format!("ws://{}/ws/sync/room-1?ticket={}", addr, tkt_bob);
    let (mut bob_ws, _) = connect_async(bob_url).await.unwrap();

    // Bob receives MSG_HELLO
    let bob_first = bob_ws.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = bob_first {
        assert_eq!(bin[0], MSG_HELLO);
    }

    // 4. Alice inserts text using YoinDocCore and sends MSG_SYNC_STEP_2 with seq=1
    let alice_doc = YoinDocCore::new();
    let update = alice_doc.insert_text("content", 0, "Hello YoinSpace 2.0");

    let mut packet = Vec::with_capacity(5 + update.len());
    packet.push(MSG_SYNC_STEP_2);
    packet.extend_from_slice(&1u32.to_be_bytes());
    packet.extend_from_slice(&update);

    alice_ws.send(Message::Binary(packet.into())).await.unwrap();

    // 5. Alice receives MSG_UPDATE_ACK with seq=1
    let alice_ack = alice_ws.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = alice_ack {
        assert_eq!(bin[0], MSG_UPDATE_ACK);
        let ack_seq = u32::from_be_bytes([bin[1], bin[2], bin[3], bin[4]]);
        assert_eq!(ack_seq, 1);
    } else {
        panic!("Expected UPDATE_ACK");
    }

    // 6. Bob receives fanned-out MSG_SYNC_STEP_2 (without seq prefix, pure update)
    let bob_msg = bob_ws.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = bob_msg {
        assert_eq!(bin[0], MSG_SYNC_STEP_2);
        let received_update = &bin[1..];

        let bob_doc = YoinDocCore::new();
        bob_doc.apply_update(received_update).unwrap();

        // Verify Bob's doc converged to Alice's text!
        assert_eq!(bob_doc.get_text("content"), "Hello YoinSpace 2.0");
    } else {
        panic!("Expected Bob to receive SYNC_STEP_2");
    }
}

#[tokio::test]
async fn test_viewer_read_only_mutation_rejection() {
    let storage = Arc::new(MemoryStorage::new());
    let (addr, state) = start_test_server(storage).await;

    // Issue viewer ticket
    let (tkt_viewer, _) = state.ticket_store.create_ticket("room-ro", "user-viewer", "Observer", "viewer", 60);

    let url = format!("ws://{}/ws/sync/room-ro?ticket={}", addr, tkt_viewer);
    let (mut ws, _) = connect_async(url).await.unwrap();

    // Consume HELLO
    let hello = ws.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = hello {
        assert_eq!(bin[0], MSG_HELLO);
        let parsed: HelloPayload = serde_json::from_slice(&bin[1..]).unwrap();
        assert_eq!(parsed.role, "viewer");
    }

    // Attempt to submit mutation with seq=42
    let doc = YoinDocCore::new();
    let update = doc.insert_text("content", 0, "Malicious write");

    let mut packet = vec![MSG_SYNC_STEP_2];
    packet.extend_from_slice(&42u32.to_be_bytes());
    packet.extend_from_slice(&update);

    ws.send(Message::Binary(packet.into())).await.unwrap();

    // Server must reject with FORBIDDEN_READONLY error
    let err_msg = ws.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = err_msg {
        assert_eq!(bin[0], MSG_ERROR);
        let err: ErrorPayload = serde_json::from_slice(&bin[1..]).unwrap();
        assert_eq!(err.code, "FORBIDDEN_READONLY");
        assert_eq!(err.seq, Some(42));
    } else {
        panic!("Expected MSG_ERROR");
    }
}

#[tokio::test]
async fn test_oversize_update_rejection() {
    let storage = Arc::new(MemoryStorage::new());
    let (addr, state) = start_test_server(storage).await;

    let (tkt, _) = state.ticket_store.create_ticket("room-big", "user-1", "Alice", "editor", 60);
    let url = format!("ws://{}/ws/sync/room-big?ticket={}", addr, tkt);
    let (mut ws, _) = connect_async(url).await.unwrap();

    // Consume HELLO
    let _ = ws.next().await.unwrap().unwrap();

    // Create payload exceeding 1MB (1024*1024 + 10 bytes)
    let oversize_data = vec![0xAB; MAX_UPDATE_BYTES + 10];
    let mut packet = vec![MSG_SYNC_STEP_2];
    packet.extend_from_slice(&99u32.to_be_bytes());
    packet.extend_from_slice(&oversize_data);

    ws.send(Message::Binary(packet.into())).await.unwrap();

    // Server rejects with TOO_LARGE
    let err_msg = ws.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = err_msg {
        assert_eq!(bin[0], MSG_ERROR);
        let err: ErrorPayload = serde_json::from_slice(&bin[1..]).unwrap();
        assert_eq!(err.code, "TOO_LARGE");
        assert_eq!(err.seq, Some(99));
    } else {
        panic!("Expected MSG_ERROR for oversize update");
    }
}

#[tokio::test]
async fn test_corrupted_crdt_binary_rejection() {
    let storage = Arc::new(MemoryStorage::new());
    let (addr, state) = start_test_server(storage).await;

    let (tkt, _) = state.ticket_store.create_ticket("room-bad", "user-1", "Alice", "editor", 60);
    let url = format!("ws://{}/ws/sync/room-bad?ticket={}", addr, tkt);
    let (mut ws, _) = connect_async(url).await.unwrap();

    // Consume HELLO
    let _ = ws.next().await.unwrap().unwrap();

    // Send corrupted non-Yrs bytes
    let garbage = vec![0xFF, 0xFE, 0xFD, 0xFC, 0xFB];
    let mut packet = vec![MSG_SYNC_STEP_2];
    packet.extend_from_slice(&77u32.to_be_bytes());
    packet.extend_from_slice(&garbage);

    ws.send(Message::Binary(packet.into())).await.unwrap();

    // Server rejects with INVALID_UPDATE
    let err_msg = ws.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = err_msg {
        assert_eq!(bin[0], MSG_ERROR);
        let err: ErrorPayload = serde_json::from_slice(&bin[1..]).unwrap();
        assert_eq!(err.code, "INVALID_UPDATE");
        assert_eq!(err.seq, Some(77));
    } else {
        panic!("Expected MSG_ERROR for corrupted update");
    }
}

#[tokio::test]
async fn test_server_restart_persistence_and_sync_step_1() {
    let temp_dir = std::env::temp_dir().join(format!("yoin_persist_test_{}", uuid::Uuid::new_v4()));
    let storage = Arc::new(FileStorage::new(&temp_dir));

    // Phase 1: Start Server A, write updates, compact
    let (addr_a, state_a) = start_test_server(storage.clone()).await;
    let (tkt_a, _) = state_a.ticket_store.create_ticket("room-restart", "user-1", "Alice", "editor", 60);

    let url_a = format!("ws://{}/ws/sync/room-restart?ticket={}", addr_a, tkt_a);
    let (mut ws_a, _) = connect_async(url_a).await.unwrap();
    let _ = ws_a.next().await.unwrap().unwrap(); // HELLO

    // Insert text
    let doc_a = YoinDocCore::new();
    let up = doc_a.insert_text("content", 0, "Persisted content after restart");
    let mut packet = vec![MSG_SYNC_STEP_2];
    packet.extend_from_slice(&1u32.to_be_bytes());
    packet.extend_from_slice(&up);
    ws_a.send(Message::Binary(packet.into())).await.unwrap();

    let _ = ws_a.next().await.unwrap().unwrap(); // ACK
    ws_a.close(None).await.unwrap();

    // Gracefully shutdown Server A (triggers room compaction & file write)
    state_a.room_manager.shutdown_all().await;
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Phase 2: Start new Server B pointing to the exact same storage directory
    let storage_b = Arc::new(FileStorage::new(&temp_dir));
    let (addr_b, state_b) = start_test_server(storage_b).await;
    let (tkt_b, _) = state_b.ticket_store.create_ticket("room-restart", "user-2", "Bob", "editor", 60);

    let url_b = format!("ws://{}/ws/sync/room-restart?ticket={}", addr_b, tkt_b);
    let (mut ws_b, _) = connect_async(url_b).await.unwrap();
    let _ = ws_b.next().await.unwrap().unwrap(); // HELLO

    // Bob sends SYNC_STEP_1 with empty state vector to catch up from scratch
    let bob_doc = YoinDocCore::new();
    let bob_sv = bob_doc.get_state_vector();
    let mut sync1 = vec![MSG_SYNC_STEP_1];
    sync1.extend_from_slice(&bob_sv);
    ws_b.send(Message::Binary(sync1.into())).await.unwrap();

    // Server responds with SYNC_STEP_2 containing server diff, followed by SYNC_STEP_1_REPLY
    let response = ws_b.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = response {
        assert_eq!(bin[0], MSG_SYNC_STEP_2);
        bob_doc.apply_update(&bin[1..]).unwrap();
        assert_eq!(bob_doc.get_text("content"), "Persisted content after restart");
    } else {
        panic!("Expected SYNC_STEP_2 in response to SYNC_STEP_1");
    }

    // Cleanup
    let _ = tokio::fs::remove_dir_all(&temp_dir).await;
}

#[tokio::test]
async fn test_ticket_auth_subprotocol_header_and_rejection() {
    let storage = Arc::new(MemoryStorage::new());
    let (addr, state) = start_test_server(storage).await;

    // Issue ticket
    let (ticket, _) = state.ticket_store.create_ticket("room-sec", "user-sec", "Charlie", "editor", 60);

    // Connect using Sec-WebSocket-Protocol: yoin.v2, bearer.<ticket>
    let url = format!("ws://{}/ws/sync/room-sec", addr);
    let mut req = url.into_client_request().unwrap();
    req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        format!("yoin.v2, bearer.{}", ticket).parse().unwrap(),
    );

    let (mut ws, response) = connect_async(req).await.unwrap();
    assert_eq!(
        response.headers().get("Sec-WebSocket-Protocol").and_then(|h| h.to_str().ok()),
        Some("yoin.v2")
    );

    let hello = ws.next().await.unwrap().unwrap();
    if let Message::Binary(bin) = hello {
        assert_eq!(bin[0], MSG_HELLO);
        let parsed: HelloPayload = serde_json::from_slice(&bin[1..]).unwrap();
        assert_eq!(parsed.user_id, "user-sec");
    }

    // Now attempt connect with invalid ticket -> should fail with 401
    let fail_url = format!("ws://{}/ws/sync/room-sec", addr);
    let mut fail_req = fail_url.into_client_request().unwrap();
    fail_req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        "yoin.v2, bearer.invalid_ticket_123".parse().unwrap(),
    );

    let res = connect_async(fail_req).await;
    assert!(res.is_err(), "Expected connection with invalid ticket to fail");
}
