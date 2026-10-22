use crate::actor::RoomCommand;
use crate::auth::{extract_ticket_from_protocol_header, TicketClaims, TicketStore};
use crate::protocol::{encode_error, parse_client_message, ProtocolError, MSG_SYNC_STEP_2};
use crate::room_manager::RoomManager;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub room_manager: RoomManager,
    pub ticket_store: TicketStore,
    pub allow_anonymous_dev: bool,
}

#[derive(Deserialize)]
pub struct WsQuery {
    pub ticket: Option<String>,
    pub token: Option<String>,
    pub role: Option<String>,
    pub name: Option<String>,
}

pub async fn ws_handler(
    State(state): State<Arc<AppState>>,
    Path(room_id): Path<String>,
    Query(query): Query<WsQuery>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, StatusCode> {
    // 1. Extract ticket token either from Sec-WebSocket-Protocol header or Query params
    let mut ticket_token = query.ticket.or(query.token);
    let mut has_yoin_subprotocol = false;

    if let Some(proto_header) = headers.get("sec-websocket-protocol").and_then(|h| h.to_str().ok()) {
        if proto_header.contains("yoin.v2") {
            has_yoin_subprotocol = true;
        }
        if ticket_token.is_none() {
            ticket_token = extract_ticket_from_protocol_header(proto_header);
        }
    }

    // 2. Validate ticket or allow guest fallback
    let claims = match ticket_token {
        Some(token) => {
            state.ticket_store.validate_and_consume(&token, &room_id)
                .map_err(|e| {
                    warn!("[WS Auth] Ticket validation failed for room {}: {:?}", room_id, e);
                    StatusCode::UNAUTHORIZED
                })?
        }
        None => {
            if state.allow_anonymous_dev {
                // Anonymous guest ticket for local dev & testing
                let guest_id = format!("guest_{}", &Uuid::new_v4().simple().to_string()[..8]);
                let guest_role = query.role.unwrap_or_else(|| "editor".to_string());
                let guest_name = query.name.unwrap_or_else(|| format!("Guest {}", &guest_id[6..]));
                TicketClaims {
                    ticket_id: format!("anon_{}", Uuid::new_v4().simple()),
                    room_id: room_id.clone(),
                    user_id: guest_id,
                    name: guest_name,
                    role: guest_role,
                    created_at: chrono::Utc::now().timestamp(),
                    expires_at: chrono::Utc::now().timestamp() + 3600,
                }
            } else {
                warn!("[WS Auth] Missing ticket token for room {}", room_id);
                return Err(StatusCode::UNAUTHORIZED);
            }
        }
    };

    // 3. Negotiate protocol if client requested yoin.v2
    let ws = if has_yoin_subprotocol {
        ws.protocols(["yoin.v2"])
    } else {
        ws
    };

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, room_id, claims, state.room_manager.clone())))
}

async fn handle_socket(
    socket: WebSocket,
    room_id: String,
    claims: TicketClaims,
    room_manager: RoomManager,
) {
    let peer_id = format!("peer_{}", Uuid::new_v4().simple());
    let (mut ws_sender, mut ws_receiver) = socket.split();

    let room_tx = room_manager.get_or_create_room(&room_id).await;
    let (outgoing_tx, mut outgoing_rx) = mpsc::channel::<Vec<u8>>(256);

    // Register with RoomActor
    let (join_reply_tx, join_reply_rx) = oneshot::channel();
    let join_cmd = RoomCommand::JoinPeer {
        peer_id: peer_id.clone(),
        claims: claims.clone(),
        tx: outgoing_tx.clone(),
        reply: join_reply_tx,
    };

    if let Err(_) = room_tx.send(join_cmd).await {
        error!("[WS] Failed to send JoinPeer command to room actor: {}", room_id);
        return;
    }

    if let Ok(success) = join_reply_rx.await {
        if !success {
            warn!("[WS] RoomActor rejected peer: {}", peer_id);
            return;
        }
    } else {
        return;
    }

    info!("[WS] Connected peer {} (user={}, role={}) to room {}", peer_id, claims.user_id, claims.role, room_id);

    // Forward outbound messages from RoomActor to WebSocket
    let mut send_task = tokio::spawn(async move {
        while let Some(msg_bytes) = outgoing_rx.recv().await {
            if let Err(e) = ws_sender.send(Message::Binary(msg_bytes.into())).await {
                debug!("[WS] Outbound send failed: {:?}", e);
                break;
            }
        }
        let _ = ws_sender.close().await;
    });

    // Receive inbound messages from WebSocket and forward to RoomActor
    let room_tx_clone = room_tx.clone();
    let peer_id_clone = peer_id.clone();
    let outgoing_tx_clone = outgoing_tx.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(msg_result) = ws_receiver.next().await {
            match msg_result {
                Ok(Message::Binary(bytes)) => {
                    match parse_client_message(&bytes, true) {
                        Ok(client_msg) => {
                            if let Err(_) = room_tx_clone.send(RoomCommand::ClientMsg {
                                peer_id: peer_id_clone.clone(),
                                msg: client_msg,
                            }).await {
                                break;
                            }
                        }
                        Err(ProtocolError::UpdateTooLarge(len, max)) => {
                            warn!("[WS] Update too large from {}: {} bytes > max {}", peer_id_clone, len, max);
                            let seq = if bytes.len() >= 5 && bytes[0] == MSG_SYNC_STEP_2 {
                                Some(u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]))
                            } else {
                                None
                            };
                            let err_msg = encode_error("TOO_LARGE", &format!("Update of {} bytes exceeds {} bytes limit", len, max), seq);
                            let _ = outgoing_tx_clone.send(err_msg).await;
                        }
                        Err(err) => {
                            warn!("[WS] Invalid protocol frame from peer {}: {:?}", peer_id_clone, err);
                            let err_msg = encode_error("INVALID_FRAME", &err.to_string(), None);
                            let _ = outgoing_tx_clone.send(err_msg).await;
                        }
                    }
                }
                Ok(Message::Close(_)) => {
                    break;
                }
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {
                    // Handled automatically by axum/tungstenite
                }
                Ok(Message::Text(_)) => {
                    // Protocol v2 is binary, ignore raw text
                }
                Err(e) => {
                    debug!("[WS] Receive error for peer {}: {:?}", peer_id_clone, e);
                    break;
                }
            }
        }
    });

    // Wait until either task completes
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }

    // Unregister peer from RoomActor
    info!("[WS] Peer {} disconnected from room {}", peer_id, room_id);
    let _ = room_tx.send(RoomCommand::LeavePeer { peer_id }).await;
}
