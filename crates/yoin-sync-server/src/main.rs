use std::net::SocketAddr;
use std::sync::Arc;
use tracing::info;
use yoin_sync_server::auth::TicketStore;
use yoin_sync_server::create_router;
use yoin_sync_server::room_manager::RoomManager;
use yoin_sync_server::storage::FileStorage;
use yoin_sync_server::ws::AppState;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "yoin_sync_server=info,tower_http=info".into()),
        )
        .init();

    // 2. Parse configuration
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(4444);
    let storage_dir = std::env::var("STORAGE_DIR").unwrap_or_else(|_| "./data/sync".to_string());
    let allow_anon = std::env::var("ALLOW_ANONYMOUS_DEV")
        .map(|v| v != "false" && v != "0")
        .unwrap_or(true);

    info!("Starting Yoin Authoritative Sync Server v0.2.0");
    info!("Storage directory: {}", storage_dir);
    info!("Anonymous dev mode: {}", allow_anon);

    // 3. Setup state & dependencies
    let storage = Arc::new(FileStorage::new(&storage_dir));
    let room_manager = RoomManager::new(storage);
    let ticket_store = TicketStore::new();

    let state = Arc::new(AppState {
        room_manager: room_manager.clone(),
        ticket_store,
        allow_anonymous_dev: allow_anon,
    });

    // 4. Build application router
    let app = create_router(state);

    // 5. Bind and serve
    let addr: SocketAddr = format!("{}:{}", host, port).parse()?;
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("Listening on ws://{}:{}", host, port);

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            tokio::signal::ctrl_c().await.ok();
            info!("Received shutdown signal, flushing rooms...");
            room_manager.shutdown_all().await;
            info!("Server stopped cleanly.");
        })
        .await?;

    Ok(())
}

