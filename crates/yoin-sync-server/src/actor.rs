use crate::auth::TicketClaims;
use crate::protocol::*;
use crate::rate_limiter::PeerRateLimiters;
use crate::storage::RoomStorage;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};
use tracing::{error, info, warn};
use yoin_core::YoinDocCore;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct RoomStats {
    pub room_id: String,
    pub peer_count: usize,
    pub seq: u32,
    pub doc_size_bytes: usize,
    pub uncompacted_updates: usize,
}

pub struct PeerHandle {
    pub claims: TicketClaims,
    pub tx: mpsc::Sender<Vec<u8>>,
    pub rate_limiters: PeerRateLimiters,
}

pub enum RoomCommand {
    JoinPeer {
        peer_id: String,
        claims: TicketClaims,
        tx: mpsc::Sender<Vec<u8>>,
        reply: oneshot::Sender<bool>,
    },
    LeavePeer {
        peer_id: String,
    },
    ClientMsg {
        peer_id: String,
        msg: ClientMessage,
    },
    GetStats {
        reply: oneshot::Sender<RoomStats>,
    },
    Compact {
        reply: Option<oneshot::Sender<()>>,
    },
    Shutdown,
}

pub struct RoomActor {
    room_id: String,
    doc: YoinDocCore,
    storage: Arc<dyn RoomStorage>,
    peers: HashMap<String, PeerHandle>,
    rx: mpsc::Receiver<RoomCommand>,
    seq: u32,
    uncompacted_updates: usize,
    uncompacted_bytes: usize,
    last_active: Instant,
    idle_timeout: Duration,
    max_uncompacted_updates: usize,
    max_uncompacted_bytes: usize,
}

impl RoomActor {
    pub async fn spawn(
        room_id: String,
        storage: Arc<dyn RoomStorage>,
        rx: mpsc::Receiver<RoomCommand>,
    ) -> tokio::task::JoinHandle<()> {
        let mut actor = Self::new(room_id, storage, rx).await;
        tokio::spawn(async move {
            actor.run().await;
        })
    }

    pub async fn new(
        room_id: String,
        storage: Arc<dyn RoomStorage>,
        rx: mpsc::Receiver<RoomCommand>,
    ) -> Self {
        let doc = YoinDocCore::new();
        let mut seq = 0;

        // 1. Restore from storage: load snapshot if available
        if let Ok(Some(snapshot)) = storage.load_snapshot(&room_id).await {
            if let Err(e) = doc.apply_update(&snapshot) {
                error!("[RoomActor {}] Failed to load snapshot: {:?}", room_id, e);
            } else {
                info!("[RoomActor {}] Loaded snapshot ({} bytes)", room_id, snapshot.len());
            }
        }

        // 2. Replay subsequent uncompacted updates
        if let Ok(updates) = storage.load_updates(&room_id).await {
            let count = updates.len();
            for (u_seq, update) in updates {
                if u_seq > seq {
                    seq = u_seq;
                }
                if let Err(e) = doc.apply_update(&update) {
                    error!("[RoomActor {}] Failed to replay update seq {}: {:?}", room_id, u_seq, e);
                }
            }
            if count > 0 {
                info!("[RoomActor {}] Replayed {} updates from log, current seq: {}", room_id, count, seq);
            }
        }

        Self {
            room_id,
            doc,
            storage,
            peers: HashMap::new(),
            rx,
            seq,
            uncompacted_updates: 0,
            uncompacted_bytes: 0,
            last_active: Instant::now(),
            idle_timeout: Duration::from_secs(300), // 5 minutes unload timeout
            max_uncompacted_updates: 500,
            max_uncompacted_bytes: 1024 * 1024,     // 1 MB
        }
    }

    pub async fn run(&mut self) {
        let mut idle_interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            tokio::select! {
                cmd = self.rx.recv() => {
                    match cmd {
                        Some(RoomCommand::JoinPeer { peer_id, claims, tx, reply }) => {
                            self.handle_join(peer_id, claims, tx, reply).await;
                        }
                        Some(RoomCommand::LeavePeer { peer_id }) => {
                            self.handle_leave(peer_id).await;
                        }
                        Some(RoomCommand::ClientMsg { peer_id, msg }) => {
                            self.handle_client_msg(peer_id, msg).await;
                        }
                        Some(RoomCommand::GetStats { reply }) => {
                            let snapshot = self.doc.snapshot();
                            let stats = RoomStats {
                                room_id: self.room_id.clone(),
                                peer_count: self.peers.len(),
                                seq: self.seq,
                                doc_size_bytes: snapshot.len(),
                                uncompacted_updates: self.uncompacted_updates,
                            };
                            let _ = reply.send(stats);
                        }
                        Some(RoomCommand::Compact { reply }) => {
                            self.compact().await;
                            if let Some(r) = reply {
                                let _ = r.send(());
                            }
                        }
                        Some(RoomCommand::Shutdown) | None => {
                            info!("[RoomActor {}] Shutting down, persisting state...", self.room_id);
                            self.compact().await;
                            break;
                        }
                    }
                }

                _ = idle_interval.tick() => {
                    // Check if room has been empty and idle
                    if self.peers.is_empty() {
                        let idle_time = self.last_active.elapsed();
                        if idle_time > self.idle_timeout {
                            info!("[RoomActor {}] Idle timeout ({}s empty), compacting and unloading", self.room_id, idle_time.as_secs());
                            self.compact().await;
                            break;
                        } else if idle_time > Duration::from_secs(60) && self.uncompacted_updates > 0 {
                            // Compact after 60s idle (03 §3.3)
                            self.compact().await;
                        }
                    }
                }
            }
        }
    }

    async fn handle_join(
        &mut self,
        peer_id: String,
        claims: TicketClaims,
        tx: mpsc::Sender<Vec<u8>>,
        reply: oneshot::Sender<bool>,
    ) {
        self.last_active = Instant::now();

        // 1. Send MSG_HELLO
        let hello = encode_hello(&claims.role, &claims.user_id);
        if let Err(e) = tx.send(hello).await {
            warn!("[RoomActor {}] Failed to send HELLO to peer {}: {:?}", self.room_id, peer_id, e);
            let _ = reply.send(false);
            return;
        }

        // 2. Register peer
        self.peers.insert(
            peer_id.clone(),
            PeerHandle {
                claims,
                tx,
                rate_limiters: PeerRateLimiters::new(),
            },
        );

        info!("[RoomActor {}] Peer {} joined. Total peers: {}", self.room_id, peer_id, self.peers.len());
        let _ = reply.send(true);
    }

    async fn handle_leave(&mut self, peer_id: String) {
        self.last_active = Instant::now();
        if let Some(peer) = self.peers.remove(&peer_id) {
            info!("[RoomActor {}] Peer {} left. Remaining: {}", self.room_id, peer_id, self.peers.len());

            // Broadcast offline awareness so other peers remove cursor
            let offline_notice = serde_json::json!({
                "clientId": peer.claims.user_id,
                "offline": true
            });
            let bytes = serde_json::to_vec(&offline_notice).unwrap_or_default();
            self.broadcast_except(&peer_id, encode_awareness(&bytes)).await;
        }
    }

    async fn handle_client_msg(&mut self, peer_id: String, msg: ClientMessage) {
        self.last_active = Instant::now();

        let peer = match self.peers.get_mut(&peer_id) {
            Some(p) => p,
            None => {
                warn!("[RoomActor {}] Received msg from unregistered peer {}", self.room_id, peer_id);
                return;
            }
        };

        match msg {
            ClientMessage::SyncStep1(client_sv) => {
                // Compute diff from server document to client
                match self.doc.export_diff(&client_sv) {
                    Ok(diff) => {
                        // Only send diff if non-empty (suppress [0, 0])
                        if diff.len() > 2 || (diff.len() == 2 && !(diff[0] == 0 && diff[1] == 0)) {
                            let diff_msg = encode_sync_step_2(&diff);
                            let _ = peer.tx.send(diff_msg).await;
                        }
                    }
                    Err(e) => {
                        warn!("[RoomActor {}] export_diff failed for peer {}: {:?}", self.room_id, peer_id, e);
                    }
                }

                // Send server's current state vector
                let server_sv = self.doc.get_state_vector();
                let sv_reply = encode_sync_step_1_reply(&server_sv);
                let _ = peer.tx.send(sv_reply).await;
            }

            ClientMessage::SyncStep2 { seq, update } => {
                // 1. Rate limit check
                if !peer.rate_limiters.update_limiter.check_and_consume() {
                    let err = encode_error("RATE_LIMITED", "Update rate limit exceeded (max 60/s)", Some(seq));
                    let _ = peer.tx.send(err).await;
                    return;
                }

                // 2. Role permission check (03 §3.1)
                if peer.claims.role == "viewer" {
                    let err = encode_error("FORBIDDEN_READONLY", "Viewer role cannot submit mutations", Some(seq));
                    let _ = peer.tx.send(err).await;
                    return;
                }

                // 3. Payload size check
                if update.len() > MAX_UPDATE_BYTES {
                    let err = encode_error("TOO_LARGE", "Update exceeds 1MB limit", Some(seq));
                    let _ = peer.tx.send(err).await;
                    return;
                }

                // 4. Apply update to Doc
                if let Err(e) = self.doc.apply_update(&update) {
                    error!("[RoomActor {}] Invalid update from {}: {:?}", self.room_id, peer_id, e);
                    let err = encode_error("INVALID_UPDATE", &format!("Corrupted update binary: {}", e), Some(seq));
                    let _ = peer.tx.send(err).await;
                    return;
                }

                // 5. Append to persistent storage
                self.seq += 1;
                let current_seq = self.seq;
                if let Err(e) = self.storage.append_update(&self.room_id, current_seq, &update).await {
                    error!("[RoomActor {}] Failed to append update to storage: {:?}", self.room_id, e);
                }

                // 6. Send UPDATE_ACK to sender
                let ack = encode_update_ack(seq);
                let _ = peer.tx.send(ack).await;

                // 7. Fan-out update to all other room participants
                let broadcast_msg = encode_sync_step_2(&update);
                self.broadcast_except(&peer_id, broadcast_msg).await;

                // 8. Track compaction metrics
                self.uncompacted_updates += 1;
                self.uncompacted_bytes += update.len();

                if self.uncompacted_updates >= self.max_uncompacted_updates
                    || self.uncompacted_bytes >= self.max_uncompacted_bytes
                {
                    self.compact().await;
                }
            }

            ClientMessage::SyncStep2Raw(update) => {
                // Legacy / mesh mode raw update (no seq ack)
                if peer.claims.role == "viewer" {
                    let err = encode_error("FORBIDDEN_READONLY", "Viewer role cannot submit mutations", None);
                    let _ = peer.tx.send(err).await;
                    return;
                }

                if let Err(e) = self.doc.apply_update(&update) {
                    error!("[RoomActor {}] Invalid raw update from {}: {:?}", self.room_id, peer_id, e);
                    return;
                }

                self.seq += 1;
                let current_seq = self.seq;
                let _ = self.storage.append_update(&self.room_id, current_seq, &update).await;
                let broadcast_msg = encode_sync_step_2(&update);
                self.broadcast_except(&peer_id, broadcast_msg).await;
            }

            ClientMessage::Awareness(raw_bytes) => {
                // 1. Rate limit awareness (max 30/s)
                if !peer.rate_limiters.awareness_limiter.check_and_consume() {
                    return;
                }

                // 2. Sanitize awareness payload (03 §3.1: server overrides userId/name/avatar to prevent spoofing)
                let user_id = peer.claims.user_id.clone();
                let user_name = peer.claims.name.clone();

                let sanitized_bytes = match serde_json::from_slice::<serde_json::Value>(&raw_bytes) {
                    Ok(mut val) => {
                        if let Some(obj) = val.as_object_mut() {
                            obj.insert("userId".to_string(), serde_json::Value::String(user_id.clone()));
                            obj.insert("clientId".to_string(), serde_json::Value::String(user_id));
                            if !user_name.is_empty() {
                                obj.insert("name".to_string(), serde_json::Value::String(user_name));
                            }
                        }
                        serde_json::to_vec(&val).unwrap_or(raw_bytes)
                    }
                    Err(_) => raw_bytes,
                };

                let awareness_msg = encode_awareness(&sanitized_bytes);
                self.broadcast_except(&peer_id, awareness_msg).await;
            }

            ClientMessage::JoinRoom(_) => {
                // Already joined via actor routing, no-op
            }
        }
    }

    async fn broadcast_except(&mut self, sender_peer_id: &str, msg: Vec<u8>) {
        let mut failed_peers = Vec::new();
        for (pid, peer) in &self.peers {
            if pid != sender_peer_id {
                if let Err(_) = peer.tx.send(msg.clone()).await {
                    failed_peers.push(pid.clone());
                }
            }
        }

        for pid in failed_peers {
            self.peers.remove(&pid);
        }
    }

    async fn compact(&mut self) {
        let snapshot = self.doc.snapshot();
        info!(
            "[RoomActor {}] Compacting snapshot ({} bytes, version seq={})",
            self.room_id,
            snapshot.len(),
            self.seq
        );

        if let Err(e) = self.storage.compact(&self.room_id, &snapshot, self.seq as u64).await {
            error!("[RoomActor {}] Compaction failed: {:?}", self.room_id, e);
        } else {
            self.uncompacted_updates = 0;
            self.uncompacted_bytes = 0;
        }
    }
}

