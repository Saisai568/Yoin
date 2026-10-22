pub mod actor;
pub mod api;
pub mod auth;
pub mod protocol;
pub mod rate_limiter;
pub mod room_manager;
pub mod storage;
pub mod ws;

use axum::routing::{get, post};
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
        .route("/health", get(api::health_handler))
        .route("/api/rooms/{id}/ticket", post(api::create_ticket_handler))
        .route("/api/admin/rooms", get(api::admin_rooms_handler))
        .route("/ws/sync/{id}", get(ws::ws_handler))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

