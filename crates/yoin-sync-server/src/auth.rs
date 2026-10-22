use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum AuthError {
    #[error("Ticket not found")]
    TicketNotFound,
    #[error("Ticket expired")]
    TicketExpired,
    #[error("Room ID mismatch: expected {expected}, got {got}")]
    RoomMismatch { expected: String, got: String },
    #[error("Missing or invalid subprotocol / token")]
    MissingToken,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct TicketClaims {
    pub ticket_id: String,
    pub room_id: String,
    pub user_id: String,
    pub name: String,
    pub role: String, // "owner" | "editor" | "viewer"
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Clone)]
pub struct TicketStore {
    tickets: Arc<DashMap<String, TicketClaims>>,
}

impl Default for TicketStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TicketStore {
    pub fn new() -> Self {
        Self {
            tickets: Arc::new(DashMap::new()),
        }
    }

    /// Issue a new ticket with specified TTL in seconds (default 60s).
    pub fn create_ticket(
        &self,
        room_id: &str,
        user_id: &str,
        name: &str,
        role: &str,
        ttl_secs: u64,
    ) -> (String, TicketClaims) {
        let ticket_id = format!("tkt_{}", Uuid::new_v4().simple());
        let now = chrono::Utc::now().timestamp();
        let expires_at = now + (ttl_secs as i64);

        let claims = TicketClaims {
            ticket_id: ticket_id.clone(),
            room_id: room_id.to_string(),
            user_id: user_id.to_string(),
            name: name.to_string(),
            role: role.to_string(),
            created_at: now,
            expires_at,
        };

        self.tickets.insert(ticket_id.clone(), claims.clone());
        (ticket_id, claims)
    }

    /// Validate and consume a ticket for a specific room.
    /// Ticket must match room_id and not be expired.
    pub fn validate_and_consume(&self, ticket_token: &str, expected_room_id: &str) -> Result<TicketClaims, AuthError> {
        let (_, claims) = self.tickets.remove(ticket_token).ok_or(AuthError::TicketNotFound)?;

        let now = chrono::Utc::now().timestamp();
        if now > claims.expires_at {
            return Err(AuthError::TicketExpired);
        }

        if claims.room_id != expected_room_id {
            return Err(AuthError::RoomMismatch {
                expected: expected_room_id.to_string(),
                got: claims.room_id,
            });
        }

        Ok(claims)
    }

    /// Clean up expired tickets to prevent unbounded memory growth.
    pub fn prune_expired(&self) -> usize {
        let now = chrono::Utc::now().timestamp();
        let mut pruned = 0;
        self.tickets.retain(|_, claims| {
            if now > claims.expires_at {
                pruned += 1;
                false
            } else {
                true
            }
        });
        pruned
    }
}

/// Extract ticket token from `Sec-WebSocket-Protocol` header string:
/// e.g. "yoin.v2, bearer.tkt_12345"
pub fn extract_ticket_from_protocol_header(header: &str) -> Option<String> {
    for part in header.split(',') {
        let trimmed = part.trim();
        if let Some(token) = trimmed.strip_prefix("bearer.") {
            return Some(token.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_validate_ticket() {
        let store = TicketStore::new();
        let (token, claims) = store.create_ticket("room-1", "user-a", "Alice", "editor", 60);
        assert_eq!(claims.role, "editor");
        assert_eq!(claims.user_id, "user-a");

        let validated = store.validate_and_consume(&token, "room-1").unwrap();
        assert_eq!(validated.user_id, "user-a");

        // Single-use: subsequent consumption should fail
        let re_use = store.validate_and_consume(&token, "room-1");
        assert_eq!(re_use, Err(AuthError::TicketNotFound));
    }

    #[test]
    fn test_room_mismatch_rejected() {
        let store = TicketStore::new();
        let (token, _) = store.create_ticket("room-1", "user-a", "Alice", "editor", 60);
        let res = store.validate_and_consume(&token, "room-2");
        assert!(matches!(res, Err(AuthError::RoomMismatch { .. })));
    }

    #[test]
    fn test_extract_subprotocol_token() {
        let header = "yoin.v2, bearer.tkt_abcdef123456";
        let token = extract_ticket_from_protocol_header(header).unwrap();
        assert_eq!(token, "tkt_abcdef123456");

        let empty = extract_ticket_from_protocol_header("yoin.v2");
        assert!(empty.is_none());
    }
}

