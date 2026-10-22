use crate::actor::{RoomActor, RoomCommand, RoomStats};
use crate::storage::RoomStorage;
use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tracing::info;

#[derive(Clone)]
pub struct RoomManager {
    rooms: Arc<DashMap<String, mpsc::Sender<RoomCommand>>>,
    storage: Arc<dyn RoomStorage>,
}

impl RoomManager {
    pub fn new(storage: Arc<dyn RoomStorage>) -> Self {
        Self {
            rooms: Arc::new(DashMap::new()),
            storage,
        }
    }

    /// Retrieve an existing active RoomActor sender or spawn a new one.
    pub async fn get_or_create_room(&self, room_id: &str) -> mpsc::Sender<RoomCommand> {
        if let Some(entry) = self.rooms.get(room_id) {
            if !entry.is_closed() {
                return entry.value().clone();
            }
        }

        // Channel capacity for incoming commands per room
        let (tx, rx) = mpsc::channel(512);
        info!("[RoomManager] Spawning new RoomActor for room: {}", room_id);
        RoomActor::spawn(room_id.to_string(), self.storage.clone(), rx).await;

        self.rooms.insert(room_id.to_string(), tx.clone());
        tx
    }

    /// Collect stats from all currently active rooms.
    pub async fn get_all_stats(&self) -> Vec<RoomStats> {
        let mut stats_list = Vec::new();
        let mut dead_rooms = Vec::new();

        for entry in self.rooms.iter() {
            let room_id = entry.key().clone();
            let sender = entry.value();

            let (tx, rx) = oneshot::channel();
            if let Ok(_) = sender.send(RoomCommand::GetStats { reply: tx }).await {
                if let Ok(stats) = rx.await {
                    stats_list.push(stats);
                    continue;
                }
            }
            dead_rooms.push(room_id);
        }

        for dead_id in dead_rooms {
            self.rooms.remove(&dead_id);
        }

        stats_list
    }

    /// Shutdown and remove a room actor from memory
    pub async fn remove_room(&self, room_id: &str) -> bool {
        if let Some((_, sender)) = self.rooms.remove(room_id) {
            let _ = sender.send(RoomCommand::Shutdown).await;
            true
        } else {
            false
        }
    }

    /// Shutdown all rooms and flush persistence.
    pub async fn shutdown_all(&self) {
        for entry in self.rooms.iter() {
            let _ = entry.value().send(RoomCommand::Shutdown).await;
        }
        self.rooms.clear();
    }
}

