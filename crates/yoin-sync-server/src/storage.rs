use async_trait::async_trait;
use dashmap::DashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use thiserror::Error;
use tokio::fs::{self, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(String),
}

#[async_trait]
pub trait RoomStorage: Send + Sync {
    /// Load latest snapshot for the room if it exists.
    async fn load_snapshot(&self, room_id: &str) -> Result<Option<Vec<u8>>, StorageError>;

    /// Save a new snapshot for the room.
    async fn save_snapshot(&self, room_id: &str, snapshot: &[u8], version: u64) -> Result<(), StorageError>;

    /// Append a single CRDT update to the room's update log.
    async fn append_update(&self, room_id: &str, seq: u32, update: &[u8]) -> Result<(), StorageError>;

    /// Load all updates since the last snapshot.
    async fn load_updates(&self, room_id: &str) -> Result<Vec<(u32, Vec<u8>)>, StorageError>;

    /// Compact room state: atomically store the new consolidated snapshot and clear/truncate the update log.
    async fn compact(&self, room_id: &str, snapshot: &[u8], version: u64) -> Result<(), StorageError>;
}

// ============================================================
// In-Memory Storage (Default / Ephemeral / Testing)
// ============================================================

#[derive(Clone, Default)]
pub struct MemoryStorage {
    snapshots: Arc<DashMap<String, (Vec<u8>, u64)>>,
    updates: Arc<DashMap<String, Vec<(u32, Vec<u8>)>>>,
}

impl MemoryStorage {
    pub fn new() -> Self {
        Self {
            snapshots: Arc::new(DashMap::new()),
            updates: Arc::new(DashMap::new()),
        }
    }
}

#[async_trait]
impl RoomStorage for MemoryStorage {
    async fn load_snapshot(&self, room_id: &str) -> Result<Option<Vec<u8>>, StorageError> {
        Ok(self.snapshots.get(room_id).map(|pair| pair.0.clone()))
    }

    async fn save_snapshot(&self, room_id: &str, snapshot: &[u8], version: u64) -> Result<(), StorageError> {
        self.snapshots.insert(room_id.to_string(), (snapshot.to_vec(), version));
        Ok(())
    }

    async fn append_update(&self, room_id: &str, seq: u32, update: &[u8]) -> Result<(), StorageError> {
        self.updates
            .entry(room_id.to_string())
            .or_default()
            .push((seq, update.to_vec()));
        Ok(())
    }

    async fn load_updates(&self, room_id: &str) -> Result<Vec<(u32, Vec<u8>)>, StorageError> {
        Ok(self.updates.get(room_id).map(|u| u.clone()).unwrap_or_default())
    }

    async fn compact(&self, room_id: &str, snapshot: &[u8], version: u64) -> Result<(), StorageError> {
        self.snapshots.insert(room_id.to_string(), (snapshot.to_vec(), version));
        if let Some(mut entry) = self.updates.get_mut(room_id) {
            entry.clear();
        }
        Ok(())
    }
}

// ============================================================
// File-based Storage (Zero-dependency Durable Storage)
// ============================================================

#[derive(Clone)]
pub struct FileStorage {
    base_dir: PathBuf,
}

impl FileStorage {
    pub fn new(base_dir: impl AsRef<Path>) -> Self {
        Self {
            base_dir: base_dir.as_ref().to_path_buf(),
        }
    }

    fn room_dir(&self, room_id: &str) -> PathBuf {
        // Sanitize room_id to prevent directory traversal
        let safe_id: String = room_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        self.base_dir.join("rooms").join(safe_id)
    }

    fn snapshot_path(&self, room_id: &str) -> PathBuf {
        self.room_dir(room_id).join("snapshot.bin")
    }

    fn updates_path(&self, room_id: &str) -> PathBuf {
        self.room_dir(room_id).join("updates.log")
    }
}

#[async_trait]
impl RoomStorage for FileStorage {
    async fn load_snapshot(&self, room_id: &str) -> Result<Option<Vec<u8>>, StorageError> {
        let path = self.snapshot_path(room_id);
        if !path.exists() {
            return Ok(None);
        }
        let data = fs::read(path).await?;
        Ok(Some(data))
    }

    async fn save_snapshot(&self, room_id: &str, snapshot: &[u8], _version: u64) -> Result<(), StorageError> {
        let dir = self.room_dir(room_id);
        fs::create_dir_all(&dir).await?;
        let tmp_path = dir.join("snapshot.tmp");
        fs::write(&tmp_path, snapshot).await?;
        fs::rename(tmp_path, self.snapshot_path(room_id)).await?;
        Ok(())
    }

    async fn append_update(&self, room_id: &str, seq: u32, update: &[u8]) -> Result<(), StorageError> {
        let dir = self.room_dir(room_id);
        fs::create_dir_all(&dir).await?;
        let path = self.updates_path(room_id);
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await?;

        // Format: [seq: u32_be][len: u32_be][bytes...]
        let len = update.len() as u32;
        let mut header = [0u8; 8];
        header[0..4].copy_from_slice(&seq.to_be_bytes());
        header[4..8].copy_from_slice(&len.to_be_bytes());

        file.write_all(&header).await?;
        file.write_all(update).await?;
        file.flush().await?;
        Ok(())
    }

    async fn load_updates(&self, room_id: &str) -> Result<Vec<(u32, Vec<u8>)>, StorageError> {
        let path = self.updates_path(room_id);
        if !path.exists() {
            return Ok(Vec::new());
        }

        let mut file = fs::File::open(path).await?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).await?;

        let mut updates = Vec::new();
        let mut offset = 0;
        while offset + 8 <= bytes.len() {
            let seq = u32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]);
            let len = u32::from_be_bytes([bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]]) as usize;
            offset += 8;
            if offset + len > bytes.len() {
                break; // Corrupted / partial trailing write, stop
            }
            updates.push((seq, bytes[offset..offset + len].to_vec()));
            offset += len;
        }

        Ok(updates)
    }

    async fn compact(&self, room_id: &str, snapshot: &[u8], version: u64) -> Result<(), StorageError> {
        self.save_snapshot(room_id, snapshot, version).await?;
        let updates_path = self.updates_path(room_id);
        if updates_path.exists() {
            let _ = fs::remove_file(updates_path).await;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_memory_storage_lifecycle() {
        let storage = MemoryStorage::new();
        assert!(storage.load_snapshot("r1").await.unwrap().is_none());

        storage.save_snapshot("r1", b"snap1", 1).await.unwrap();
        assert_eq!(storage.load_snapshot("r1").await.unwrap().unwrap(), b"snap1");

        storage.append_update("r1", 1, b"up1").await.unwrap();
        storage.append_update("r1", 2, b"up2").await.unwrap();

        let updates = storage.load_updates("r1").await.unwrap();
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0], (1, b"up1".to_vec()));
        assert_eq!(updates[1], (2, b"up2".to_vec()));

        storage.compact("r1", b"snap2", 2).await.unwrap();
        assert_eq!(storage.load_snapshot("r1").await.unwrap().unwrap(), b"snap2");
        assert_eq!(storage.load_updates("r1").await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_file_storage_lifecycle() {
        let temp_dir = std::env::temp_dir().join(format!("yoin_test_{}", uuid::Uuid::new_v4()));
        let storage = FileStorage::new(&temp_dir);

        storage.save_snapshot("room-x", b"binary-snap", 1).await.unwrap();
        let loaded = storage.load_snapshot("room-x").await.unwrap().unwrap();
        assert_eq!(loaded, b"binary-snap");

        storage.append_update("room-x", 10, b"diff1").await.unwrap();
        storage.append_update("room-x", 11, b"diff2").await.unwrap();

        let updates = storage.load_updates("room-x").await.unwrap();
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0].0, 10);
        assert_eq!(updates[1].0, 11);

        storage.compact("room-x", b"compacted-snap", 2).await.unwrap();
        assert_eq!(storage.load_snapshot("room-x").await.unwrap().unwrap(), b"compacted-snap");
        assert_eq!(storage.load_updates("room-x").await.unwrap().len(), 0);

        let _ = fs::remove_dir_all(&temp_dir).await;
    }
}

