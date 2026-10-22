use serde::{Deserialize, Serialize};
use thiserror::Error;

// ============================================================
// Protocol v2 Opcode Constants (03 §3.1)
// ============================================================
pub const MSG_SYNC_STEP_1: u8 = 0;
pub const MSG_SYNC_STEP_2: u8 = 1;
pub const MSG_SYNC_STEP_1_REPLY: u8 = 2;
pub const MSG_AWARENESS: u8 = 3;
pub const MSG_JOIN_ROOM: u8 = 4;
pub const MSG_HELLO: u8 = 16;
pub const MSG_UPDATE_ACK: u8 = 17;
pub const MSG_ERROR: u8 = 18;

// Limits (03 §3.3)
pub const MAX_UPDATE_BYTES: usize = 1024 * 1024; // 1 MB
pub const MAX_UPDATES_PER_SEC: u32 = 60;
pub const MAX_AWARENESS_PER_SEC: u32 = 30;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("Message packet is empty")]
    EmptyPacket,
    #[error("Packet too short for opcode {0}: expected at least {1} bytes, got {2}")]
    PacketTooShort(u8, usize, usize),
    #[error("Unknown opcode: {0}")]
    UnknownOpcode(u8),
    #[error("Update packet size ({0} bytes) exceeds maximum limit of {1} bytes")]
    UpdateTooLarge(usize, usize),
    #[error("Invalid JSON payload: {0}")]
    InvalidJson(String),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct HelloPayload {
    pub protocol: u8,
    pub role: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "serverTime")]
    pub server_time: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seq: Option<u32>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ClientMessage {
    /// C -> S: Client state vector
    SyncStep1(Vec<u8>),
    /// C -> S: Client mutation update with client sequence number (server mode)
    SyncStep2 { seq: u32, update: Vec<u8> },
    /// C -> S: Raw update without sequence (mesh / legacy mode)
    SyncStep2Raw(Vec<u8>),
    /// C -> S: Awareness JSON state
    Awareness(Vec<u8>),
    /// C -> S: Join room request
    JoinRoom(String),
}

/// Parse a raw binary frame from client into a `ClientMessage`.
/// In server mode, `MSG_SYNC_STEP_2` must have 4-byte big-endian `seq` prefix.
pub fn parse_client_message(bytes: &[u8], server_mode: bool) -> Result<ClientMessage, ProtocolError> {
    if bytes.is_empty() {
        return Err(ProtocolError::EmptyPacket);
    }

    let opcode = bytes[0];
    let payload = &bytes[1..];

    match opcode {
        MSG_SYNC_STEP_1 => Ok(ClientMessage::SyncStep1(payload.to_vec())),

        MSG_SYNC_STEP_2 => {
            if server_mode {
                if payload.len() < 4 {
                    return Err(ProtocolError::PacketTooShort(MSG_SYNC_STEP_2, 5, bytes.len()));
                }
                let seq = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
                let update_bytes = payload[4..].to_vec();
                if update_bytes.len() > MAX_UPDATE_BYTES {
                    return Err(ProtocolError::UpdateTooLarge(update_bytes.len(), MAX_UPDATE_BYTES));
                }
                Ok(ClientMessage::SyncStep2 {
                    seq,
                    update: update_bytes,
                })
            } else {
                if payload.len() > MAX_UPDATE_BYTES {
                    return Err(ProtocolError::UpdateTooLarge(payload.len(), MAX_UPDATE_BYTES));
                }
                Ok(ClientMessage::SyncStep2Raw(payload.to_vec()))
            }
        }

        MSG_AWARENESS => Ok(ClientMessage::Awareness(payload.to_vec())),

        MSG_JOIN_ROOM => {
            let room_id = String::from_utf8(payload.to_vec())
                .map_err(|e| ProtocolError::InvalidJson(e.to_string()))?;
            Ok(ClientMessage::JoinRoom(room_id))
        }

        unknown => Err(ProtocolError::UnknownOpcode(unknown)),
    }
}

// ============================================================
// Server Encoders
// ============================================================

pub fn encode_hello(role: &str, user_id: &str) -> Vec<u8> {
    let payload = HelloPayload {
        protocol: 2,
        role: role.to_string(),
        user_id: user_id.to_string(),
        server_time: chrono::Utc::now().timestamp_millis(),
    };
    let json_bytes = serde_json::to_vec(&payload).expect("Serialization of HelloPayload cannot fail");
    let mut msg = Vec::with_capacity(1 + json_bytes.len());
    msg.push(MSG_HELLO);
    msg.extend_from_slice(&json_bytes);
    msg
}

pub fn encode_update_ack(seq: u32) -> Vec<u8> {
    let mut msg = Vec::with_capacity(5);
    msg.push(MSG_UPDATE_ACK);
    msg.extend_from_slice(&seq.to_be_bytes());
    msg
}

pub fn encode_error(code: &str, message: &str, seq: Option<u32>) -> Vec<u8> {
    let payload = ErrorPayload {
        code: code.to_string(),
        message: message.to_string(),
        seq,
    };
    let json_bytes = serde_json::to_vec(&payload).expect("Serialization of ErrorPayload cannot fail");
    let mut msg = Vec::with_capacity(1 + json_bytes.len());
    msg.push(MSG_ERROR);
    msg.extend_from_slice(&json_bytes);
    msg
}

pub fn encode_sync_step_2(update: &[u8]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(1 + update.len());
    msg.push(MSG_SYNC_STEP_2);
    msg.extend_from_slice(update);
    msg
}

pub fn encode_sync_step_1_reply(state_vector: &[u8]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(1 + state_vector.len());
    msg.push(MSG_SYNC_STEP_1_REPLY);
    msg.extend_from_slice(state_vector);
    msg
}

pub fn encode_awareness(awareness_bytes: &[u8]) -> Vec<u8> {
    let mut msg = Vec::with_capacity(1 + awareness_bytes.len());
    msg.push(MSG_AWARENESS);
    msg.extend_from_slice(awareness_bytes);
    msg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sync_step_1() {
        let raw = vec![MSG_SYNC_STEP_1, 10, 20, 30];
        let msg = parse_client_message(&raw, true).unwrap();
        assert_eq!(msg, ClientMessage::SyncStep1(vec![10, 20, 30]));
    }

    #[test]
    fn test_parse_sync_step_2_server_mode() {
        let mut raw = vec![MSG_SYNC_STEP_2];
        raw.extend_from_slice(&42u32.to_be_bytes());
        raw.extend_from_slice(&[1, 2, 3, 4]);

        let msg = parse_client_message(&raw, true).unwrap();
        assert_eq!(
            msg,
            ClientMessage::SyncStep2 {
                seq: 42,
                update: vec![1, 2, 3, 4]
            }
        );
    }

    #[test]
    fn test_encode_and_parse_hello() {
        let hello = encode_hello("editor", "user-123");
        assert_eq!(hello[0], MSG_HELLO);
        let parsed: HelloPayload = serde_json::from_slice(&hello[1..]).unwrap();
        assert_eq!(parsed.protocol, 2);
        assert_eq!(parsed.role, "editor");
        assert_eq!(parsed.user_id, "user-123");
    }

    #[test]
    fn test_encode_ack() {
        let ack = encode_update_ack(108);
        assert_eq!(ack[0], MSG_UPDATE_ACK);
        assert_eq!(ack.len(), 5);
        let seq = u32::from_be_bytes([ack[1], ack[2], ack[3], ack[4]]);
        assert_eq!(seq, 108);
    }

    #[test]
    fn test_encode_error() {
        let err = encode_error("FORBIDDEN_READONLY", "Read only role", Some(12));
        assert_eq!(err[0], MSG_ERROR);
        let parsed: ErrorPayload = serde_json::from_slice(&err[1..]).unwrap();
        assert_eq!(parsed.code, "FORBIDDEN_READONLY");
        assert_eq!(parsed.seq, Some(12));
    }
}

