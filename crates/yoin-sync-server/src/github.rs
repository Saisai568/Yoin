use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubIssue {
    pub id: u64,
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String, // "open" | "closed"
    pub labels: Vec<String>,
    #[serde(rename = "commentsCount")]
    pub comments_count: u32,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubComment {
    pub id: u64,
    #[serde(rename = "issueNumber")]
    pub issue_number: u64,
    pub author: String,
    pub body: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateIssueStateRequest {
    pub state: String, // "open" | "closed"
}

#[derive(Debug, Deserialize)]
pub struct CreateCommentRequest {
    pub author: String,
    pub body: String,
}

#[derive(Clone)]
pub struct GitHubStore {
    issues: Arc<DashMap<u64, GitHubIssue>>,
    comments: Arc<DashMap<u64, Vec<GitHubComment>>>,
}

impl GitHubStore {
    pub fn new() -> Self {
        let issues = Arc::new(DashMap::new());
        let comments = Arc::new(DashMap::new());

        // Seed realistic development issues
        let seed = vec![
            GitHubIssue {
                id: 101,
                number: 1,
                title: "Support CRDT nested map property updates".to_string(),
                body: "Whiteboard shapes require concurrent property merges (fill vs position)".to_string(),
                state: "closed".to_string(),
                labels: vec!["core".to_string(), "crdt".to_string()],
                comments_count: 2,
                updated_at: Utc::now().to_rfc3339(),
                author: "octocat".to_string(),
            },
            GitHubIssue {
                id: 102,
                number: 2,
                title: "Fix sticky relative position offset tracking".to_string(),
                body: "Verify cursor does not jump when remote users prepend text".to_string(),
                state: "open".to_string(),
                labels: vec!["editor".to_string(), "bug".to_string()],
                comments_count: 1,
                updated_at: Utc::now().to_rfc3339(),
                author: "alice".to_string(),
            },
            GitHubIssue {
                id: 103,
                number: 3,
                title: "LiveKit voice & screen sharing integration".to_string(),
                body: "Provide WebRTC audio channels and screen sharing controls".to_string(),
                state: "open".to_string(),
                labels: vec!["voice".to_string(), "feature".to_string()],
                comments_count: 0,
                updated_at: Utc::now().to_rfc3339(),
                author: "bob".to_string(),
            },
        ];

        for item in seed {
            issues.insert(item.number, item);
        }

        Self { issues, comments }
    }

    pub fn list_issues(&self) -> Vec<GitHubIssue> {
        let mut list: Vec<GitHubIssue> = self.issues.iter().map(|entry| entry.value().clone()).collect();
        list.sort_by_key(|i| i.number);
        list
    }

    pub fn update_state(&self, number: u64, new_state: &str) -> Option<GitHubIssue> {
        if let Some(mut entry) = self.issues.get_mut(&number) {
            entry.state = new_state.to_string();
            entry.updated_at = Utc::now().to_rfc3339();
            Some(entry.clone())
        } else {
            None
        }
    }

    pub fn get_comments(&self, number: u64) -> Vec<GitHubComment> {
        self.comments
            .get(&number)
            .map(|entry| entry.value().clone())
            .unwrap_or_default()
    }

    pub fn add_comment(&self, number: u64, author: &str, body: &str) -> Option<GitHubComment> {
        if !self.issues.contains_key(&number) {
            return None;
        }

        let comment = GitHubComment {
            id: Utc::now().timestamp_micros() as u64,
            issue_number: number,
            author: author.to_string(),
            body: body.to_string(),
            created_at: Utc::now().to_rfc3339(),
        };

        let mut entry = self.comments.entry(number).or_default();
        entry.push(comment.clone());

        if let Some(mut issue) = self.issues.get_mut(&number) {
            issue.comments_count += 1;
            issue.updated_at = Utc::now().to_rfc3339();
        }

        Some(comment)
    }
}

pub async fn get_issues_handler(
    State(state): State<Arc<crate::ws::AppState>>,
) -> impl IntoResponse {
    let issues = state.github_store.list_issues();
    Json(issues)
}

pub async fn update_issue_state_handler(
    State(state): State<Arc<crate::ws::AppState>>,
    Path(number): Path<u64>,
    Json(payload): Json<UpdateIssueStateRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    state
        .github_store
        .update_state(number, &payload.state)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

pub async fn get_comments_handler(
    State(state): State<Arc<crate::ws::AppState>>,
    Path(number): Path<u64>,
) -> impl IntoResponse {
    let comments = state.github_store.get_comments(number);
    Json(comments)
}

pub async fn post_comment_handler(
    State(state): State<Arc<crate::ws::AppState>>,
    Path(number): Path<u64>,
    Json(payload): Json<CreateCommentRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    state
        .github_store
        .add_comment(number, &payload.author, &payload.body)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

