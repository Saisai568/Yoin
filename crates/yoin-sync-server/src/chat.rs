use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    #[serde(rename = "roomId")]
    pub room_id: String,
    #[serde(rename = "senderId")]
    pub sender_id: String,
    #[serde(rename = "senderName")]
    pub sender_name: String,
    #[serde(rename = "senderColor")]
    pub sender_color: String,
    pub content: String,
    pub timestamp: i64,
    #[serde(default)]
    pub mentions: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    #[serde(rename = "senderId")]
    pub sender_id: String,
    #[serde(rename = "senderName")]
    pub sender_name: String,
    #[serde(rename = "senderColor")]
    pub sender_color: String,
    pub content: String,
    #[serde(default)]
    pub mentions: Vec<String>,
}

#[derive(Clone)]
pub struct ChatStore {
    messages: Arc<DashMap<String, Vec<ChatMessage>>>,
    max_history: usize,
}

impl ChatStore {
    pub fn new(max_history: usize) -> Self {
        Self {
            messages: Arc::new(DashMap::new()),
            max_history,
        }
    }

    pub fn get_room_messages(&self, room_id: &str) -> Vec<ChatMessage> {
        self.messages
            .get(room_id)
            .map(|entry| entry.value().clone())
            .unwrap_or_default()
    }

    pub fn add_message(&self, room_id: &str, req: SendMessageRequest) -> ChatMessage {
        let msg = ChatMessage {
            id: Uuid::new_v4().to_string(),
            room_id: room_id.to_string(),
            sender_id: req.sender_id,
            sender_name: req.sender_name,
            sender_color: req.sender_color,
            content: req.content,
            timestamp: Utc::now().timestamp_millis(),
            mentions: req.mentions,
        };

        let mut entry = self.messages.entry(room_id.to_string()).or_default();
        entry.push(msg.clone());
        if entry.len() > self.max_history {
            let overflow = entry.len() - self.max_history;
            entry.drain(0..overflow);
        }

        msg
    }
}

pub async fn get_messages_handler(
    State(state): State<Arc<crate::ws::AppState>>,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    let msgs = state.chat_store.get_room_messages(&room_id);
    Json(msgs)
}

pub async fn post_message_handler(
    State(state): State<Arc<crate::ws::AppState>>,
    Path(room_id): Path<String>,
    Json(payload): Json<SendMessageRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    if payload.content.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let msg = state.chat_store.add_message(&room_id, payload);
    Ok(Json(msg))
}
