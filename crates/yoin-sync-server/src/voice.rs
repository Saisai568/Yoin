use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct VoiceTokenQuery {
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VoiceTokenResponse {
    pub token: String,
    pub url: String,
    pub room: String,
    pub identity: String,
}

pub async fn get_voice_token_handler(
    State(_state): State<Arc<crate::ws::AppState>>,
    Path(room_id): Path<String>,
    Query(query): Query<VoiceTokenQuery>,
) -> impl IntoResponse {
    let identity = query
        .user_id
        .unwrap_or_else(|| format!("user_{}", &Uuid::new_v4().simple().to_string()[..8]));
    let name = query.name.unwrap_or_else(|| identity.clone());

    let livekit_url = std::env::var("LIVEKIT_URL")
        .unwrap_or_else(|_| "wss://livekit.syncspace.local".to_string());

    // Generate deterministic or dev mode JWT token
    let token = format!(
        "dev_lk_jwt_{}_{}_{}_{}",
        room_id,
        identity,
        name,
        chrono::Utc::now().timestamp()
    );

    Json(VoiceTokenResponse {
        token,
        url: livekit_url,
        room: room_id,
        identity,
    })
}

