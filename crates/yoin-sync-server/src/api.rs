use crate::ws::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateTicketRequest {
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    pub name: Option<String>,
    pub role: Option<String>,
}

#[derive(Serialize)]
pub struct CreateTicketResponse {
    pub ticket: String,
    #[serde(rename = "roomId")]
    pub room_id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    pub role: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: i64,
}

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
    #[serde(rename = "serverTime")]
    pub server_time: i64,
}

#[derive(Serialize)]
pub struct AdminRoomsResponse {
    pub count: usize,
    pub rooms: Vec<crate::actor::RoomStats>,
}

pub async fn health_handler() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok",
        version: "0.2.0",
        server_time: chrono::Utc::now().timestamp_millis(),
    })
}

pub async fn create_ticket_handler(
    State(state): State<Arc<AppState>>,
    Path(room_id): Path<String>,
    Json(payload): Json<CreateTicketRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let user_id = payload.user_id.unwrap_or_else(|| format!("user_{}", &Uuid::new_v4().simple().to_string()[..8]));
    let name = payload.name.unwrap_or_else(|| "Anonymous".to_string());
    let role = payload.role.unwrap_or_else(|| "editor".to_string());

    let (ticket_id, claims) = state.ticket_store.create_ticket(&room_id, &user_id, &name, &role, 60);

    Ok(Json(CreateTicketResponse {
        ticket: ticket_id,
        room_id: claims.room_id,
        user_id: claims.user_id,
        role: claims.role,
        expires_at: claims.expires_at,
    }))
}

pub async fn admin_rooms_handler(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let stats = state.room_manager.get_all_stats().await;
    Json(AdminRoomsResponse {
        count: stats.len(),
        rooms: stats,
    })
}
