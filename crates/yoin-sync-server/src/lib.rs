pub mod actor;
pub mod api;
pub mod auth;
pub mod chat;
pub mod github;
pub mod protocol;
pub mod rate_limiter;
pub mod room_manager;
pub mod storage;
pub mod voice;
pub mod ws;

use axum::routing::{delete, get, patch, post};
use axum::Router;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use ws::AppState;

/// Construct the full axum router for the Yoin Sync Server.
pub fn create_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Core & Health
        .route("/health", get(api::health_handler))
        .route("/api/rooms/{id}/ticket", post(api::create_ticket_handler))
        .route("/ws/sync/{id}", get(ws::ws_handler))
        // Chat (Server-Authoritative)
        .route("/api/rooms/{id}/messages", get(chat::get_messages_handler).post(chat::post_message_handler))
        // LiveKit Voice Token
        .route("/api/rooms/{id}/voice-token", get(voice::get_voice_token_handler))
        // GitHub Integration
        .route("/api/github/issues", get(github::get_issues_handler))
        .route("/api/github/issues/{number}/state", patch(github::update_issue_state_handler))
        .route("/api/github/issues/{number}/comments", get(github::get_comments_handler).post(github::post_comment_handler))
        // Admin Dashboard
        .route("/api/admin/rooms", get(api::admin_rooms_handler))
        .route("/api/admin/rooms/{id}", delete(api::admin_delete_room_handler))
        .route("/api/admin/system", get(api::admin_system_handler))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

