use super::model::*;
use crate::native::{Failure, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
};

const MAX_THREADS: usize = 200;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    token: String,
    viewer_id: String,
    ids: Vec<String>,
    synced_at: u64,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    #[serde(flatten)]
    thread: Thread,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<Message>,
    preview_updated_at: u64,
    last_incoming_at: f64,
    replied_through_at: f64,
    unsent_message_ids: Vec<String>,
}
pub struct Cache {
    db: Connection,
}
impl Cache {
    pub fn open(file: &Path) -> Result<Self> {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let db = Connection::open(file)?;
        #[cfg(unix)]
        if file != Path::new(":memory:") {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600))?;
        }
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA cache_size=-2048; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS sessions (profileId TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS threads (profileId TEXT NOT NULL REFERENCES sessions(profileId) ON DELETE CASCADE,
                threadId TEXT NOT NULL, value TEXT NOT NULL, updatedAt INTEGER NOT NULL, PRIMARY KEY(profileId, threadId));
            CREATE INDEX IF NOT EXISTS threads_by_id ON threads(threadId);
            CREATE INDEX IF NOT EXISTS threads_by_age ON threads(updatedAt);")?;
        Ok(Self { db })
    }
    fn session(&self, id: &str) -> Result<Option<Session>> {
        let value: Option<String> = self
            .db
            .query_row("SELECT value FROM sessions WHERE profileId=?", [id], |r| {
                r.get(0)
            })
            .optional()?;
        value
            .map(|v| serde_json::from_str(&v).map_err(Into::into))
            .transpose()
    }
    fn save_session(&self, id: &str, session: &Session) -> Result<()> {
        self.db.execute("INSERT INTO sessions VALUES (?, ?) ON CONFLICT(profileId) DO UPDATE SET value=excluded.value WHERE value<>excluded.value", params![id, serde_json::to_string(session)?])?;
        Ok(())
    }
    /// Return whether storage was rebound, so memory snapshots can be invalidated too.
    pub fn connect(&mut self, id: &str, token: &str, viewer: &str) -> Result<bool> {
        let old = self.session(id)?;
        if old
            .as_ref()
            .is_some_and(|s| s.token == token && (viewer.is_empty() || s.viewer_id == viewer))
        {
            return Ok(false);
        }
        self.transaction(|this| {
            let session = if let Some(mut old) = old.filter(|s| s.token == token) {
                old.viewer_id = viewer.into();
                old
            } else {
                this.clear(id)?;
                Session {
                    token: token.into(),
                    viewer_id: viewer.into(),
                    ids: vec![],
                    synced_at: 0,
                }
            };
            this.save_session(id, &session)?;
            Ok(true)
        })
    }
    pub fn clear(&self, id: &str) -> Result<()> {
        self.db
            .execute("DELETE FROM sessions WHERE profileId=?", [id])?;
        Ok(())
    }
    pub fn retain(&mut self, ids: &[String]) -> Result<()> {
        let rows: Vec<String> = self
            .db
            .prepare("SELECT profileId FROM sessions")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        self.transaction(|this| {
            for row in rows {
                if !ids.contains(&row) {
                    this.clear(&row)?;
                }
            }
            Ok(())
        })
    }
    fn require(&self, id: &str, token: &str) -> Result<Session> {
        self.session(id)?
            .filter(|s| s.token == token)
            .ok_or_else(|| Failure::invalid("Chat session changed"))
    }
    fn row(&self, profile: &str, thread: &str) -> Result<Option<Row>> {
        let value: Option<String> = self
            .db
            .query_row(
                "SELECT value FROM threads WHERE profileId=? AND threadId=?",
                params![profile, thread],
                |r| r.get(0),
            )
            .optional()?;
        value
            .map(|v| serde_json::from_str(&v).map_err(Into::into))
            .transpose()
    }
    fn put(&self, id: &str, row: &Row) -> Result<()> {
        self.db.execute("INSERT INTO threads VALUES (?, ?, ?, ?) ON CONFLICT(profileId, threadId) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt WHERE value<>excluded.value", params![id, row.thread.id, serde_json::to_string(row)?, crate::api::now_ms() as i64])?;
        Ok(())
    }
    fn prune(&self, id: &str) -> Result<()> {
        self.db.execute("DELETE FROM threads WHERE profileId=? AND (updatedAt<? OR threadId IN (SELECT threadId FROM threads WHERE profileId=? ORDER BY updatedAt DESC, threadId LIMIT -1 OFFSET ?))", params![id, crate::api::now_ms().saturating_sub(30 * 24 * 60 * 60_000) as i64, id, MAX_THREADS as i64])?;
        Ok(())
    }
    pub fn inbox(&self, id: &str) -> Result<Inbox> {
        let Some(session) = self.session(id)? else {
            return Ok(Inbox::default());
        };
        let mut threads = Vec::new();
        for thread_id in &session.ids {
            if let Some(row) = self.row(id, thread_id)? {
                let mut thread = row.thread;
                thread.messages = row.preview.into_iter().collect();
                thread.confirmed_message_ids = None;
                thread.synced_at = 0;
                threads.push(thread);
            }
        }
        threads.sort_by(|a, b| preview_time(b).total_cmp(&preview_time(a)));
        Ok(Inbox {
            connected: true,
            viewer_id: session.viewer_id,
            threads,
            synced_at: session.synced_at,
        })
    }
    pub fn thread(&self, id: &str, thread: &str) -> Result<Option<Thread>> {
        Ok(self.row(id, thread)?.map(public))
    }
    pub fn unread_count(&self, id: &str) -> Result<u64> {
        Ok(self.db.query_row(
            "SELECT COUNT(*) FROM threads WHERE profileId=? AND json_extract(value, '$.unread')=1",
            [id],
            |r| r.get::<_, i64>(0),
        )? as u64)
    }
    pub fn save_inbox(
        &mut self,
        id: &str,
        token: &str,
        viewer: &str,
        items: Vec<Thread>,
        unread: bool,
    ) -> Result<Inbox> {
        self.transaction(|this| {
            let mut session = this.require(id, token)?;
            let previous = this.inbox(id)?;
            let now = crate::api::now_ms();
            for item in items.iter().take(MAX_THREADS) {
                if item.messages.len() > 1 {
                    return Err(Failure::invalid("Inbox needs only one preview per thread"));
                }
                let mut row = this.row(id, &item.id)?.unwrap_or_default();
                let preview = match item.messages.first() {
                    Some(message) if !row.unsent_message_ids.contains(&message.id) => {
                        Some(message.clone())
                    }
                    Some(_) => row.preview.clone(),
                    None => None,
                };
                if row.preview != preview {
                    row.preview_updated_at = now;
                }
                watermarks(&mut row, preview.as_slice(), viewer);
                row.preview = preview;
                row.thread.id = item.id.clone();
                row.thread.title = item.title.clone();
                row.thread.users = item.users.clone();
                row.thread.last_seen_at = merge_seen(&row.thread.last_seen_at, &item.last_seen_at);
                this.put(id, &row)?;
            }
            let mut ids: Vec<_> = items.into_iter().map(|i| i.id).collect();
            if unread {
                ids.extend(session.ids);
            }
            let mut seen = HashSet::new();
            ids.retain(|id| seen.insert(id.clone()));
            ids.truncate(MAX_THREADS);
            session.ids = ids;
            session.viewer_id = viewer.into();
            this.save_session(id, &session)?;
            let next = this.inbox(id)?;
            if previous.threads != next.threads
                || previous.viewer_id != next.viewer_id
                || session.synced_at == 0
            {
                session.synced_at = now;
                this.save_session(id, &session)?;
            }
            this.prune(id)?;
            this.inbox(id)
        })
    }
    pub fn save_thread(
        &mut self,
        id: &str,
        token: &str,
        item: Thread,
        fetched_at: u64,
    ) -> Result<Thread> {
        self.transaction(|this| this.save_thread_inner(id, token, item, fetched_at))
    }
    fn save_thread_inner(
        &self,
        id: &str,
        token: &str,
        mut item: Thread,
        fetched_at: u64,
    ) -> Result<Thread> {
        let session = self.require(id, token)?;
        if item.messages.len() > 100 {
            return Err(Failure::invalid("Too many Chat messages"));
        }
        let old = self.row(id, &item.id)?;
        let mut row = old.clone().unwrap_or_default();
        let incoming: Vec<_> = item
            .messages
            .iter()
            .filter(|m| !row.unsent_message_ids.contains(&m.id))
            .cloned()
            .collect();
        let mut confirmed: Vec<_> = incoming.iter().map(|m| m.id.clone()).collect();
        confirmed.sort();
        let mut fetched = if !incoming.is_empty() {
            let oldest = incoming
                .iter()
                .map(|m| m.timestamp)
                .fold(f64::INFINITY, f64::min);
            merge_messages(
                row.thread
                    .messages
                    .iter()
                    .filter(|m| m.timestamp < oldest)
                    .cloned()
                    .chain(incoming),
            )
        } else if item.messages.is_empty() {
            Vec::new()
        } else {
            row.thread
                .messages
                .iter()
                .filter(|m| !row.unsent_message_ids.contains(&m.id))
                .cloned()
                .collect()
        };
        if let Some(preview) = row.preview.as_ref().filter(|m| {
            row.preview_updated_at > fetched_at
                && fetched.first().is_none_or(|latest| {
                    m.timestamp > latest.timestamp
                        || (m.id == latest.id && m.timestamp == latest.timestamp)
                })
        }) {
            fetched = merge_messages(fetched.into_iter().chain([preview.clone()]));
        }
        item.messages = fetched;
        item.confirmed_message_ids = Some(confirmed);
        item.last_seen_at = merge_seen(&row.thread.last_seen_at, &item.last_seen_at);
        item.synced_at = row.thread.synced_at;
        let preview = item.messages.first().cloned();
        if row.preview != preview {
            row.preview_updated_at = crate::api::now_ms();
        }
        row.preview = preview;
        let messages = item.messages.clone();
        row.thread = item;
        watermarks(&mut row, &messages, &session.viewer_id);
        if old.as_ref().is_none_or(|old| {
            public(row.clone()) != public(old.clone())
                || row.last_incoming_at != old.last_incoming_at
                || row.replied_through_at != old.replied_through_at
        }) {
            row.thread.synced_at = crate::api::now_ms();
        }
        self.put(id, &row)?;
        self.prune(id)?;
        Ok(public(row))
    }
    pub fn unsend(
        &mut self,
        id: &str,
        token: &str,
        thread: &str,
        message: &str,
    ) -> Result<Vec<String>> {
        self.transaction(|this| {
            this.require(id, token)?;
            if this.row(id, thread)?.is_none() {
                this.save_thread_inner(
                    id,
                    token,
                    Thread {
                        id: thread.into(),
                        title: "Conversation".into(),
                        ..Default::default()
                    },
                    0,
                )?;
            }
            let rows: Vec<(String, String)> = this
                .db
                .prepare("SELECT profileId, value FROM threads WHERE threadId=?")?
                .query_map([thread], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<std::result::Result<_, _>>()?;
            let mut ids = Vec::new();
            for (owner, value) in rows {
                let mut row: Row = serde_json::from_str(&value)?;
                let session = this
                    .session(&owner)?
                    .ok_or_else(|| Failure::invalid("Chat session changed"))?;
                let removed = row
                    .thread
                    .messages
                    .iter()
                    .find(|m| m.id == message)
                    .or_else(|| row.preview.as_ref().filter(|m| m.id == message))
                    .cloned();
                row.thread.messages.retain(|m| m.id != message);
                if let Some(confirmed) = &mut row.thread.confirmed_message_ids {
                    confirmed.retain(|id| id != message);
                }
                if row.preview.as_ref().is_some_and(|m| m.id == message) {
                    row.preview = row.thread.messages.first().cloned();
                    row.preview_updated_at = crate::api::now_ms();
                }
                let remaining = merge_messages(
                    row.thread
                        .messages
                        .iter()
                        .cloned()
                        .chain(row.preview.iter().cloned()),
                );
                if let Some(removed) = removed {
                    if removed.sender_id != session.viewer_id
                        && removed.timestamp == row.last_incoming_at
                    {
                        row.last_incoming_at = remaining
                            .iter()
                            .filter(|m| m.sender_id != session.viewer_id)
                            .map(|m| m.timestamp)
                            .fold(0.0, f64::max);
                    }
                    if removed.sender_id == session.viewer_id
                        && removed.timestamp == row.replied_through_at
                    {
                        row.replied_through_at = remaining
                            .iter()
                            .filter(|m| m.sender_id == session.viewer_id)
                            .map(|m| m.timestamp)
                            .fold(0.0, f64::max);
                    }
                }
                row.thread.unread = Some(row.last_incoming_at > row.replied_through_at);
                if !row.unsent_message_ids.iter().any(|id| id == message) {
                    row.unsent_message_ids.push(message.into());
                }
                if row.unsent_message_ids.len() > 100 {
                    row.unsent_message_ids.remove(0);
                }
                this.put(&owner, &row)?;
                ids.push(owner);
            }
            Ok(ids)
        })
    }
    fn transaction<T>(&mut self, action: impl FnOnce(&Self) -> Result<T>) -> Result<T> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        match action(self) {
            Ok(value) => {
                self.db.execute_batch("COMMIT")?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.db.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }
}
fn preview_time(thread: &Thread) -> f64 {
    thread.messages.first().map_or(0.0, |m| m.timestamp)
}
fn merge_messages(messages: impl IntoIterator<Item = Message>) -> Vec<Message> {
    let mut messages: Vec<_> = messages
        .into_iter()
        .map(|m| (m.id.clone(), m))
        .collect::<BTreeMap<_, _>>()
        .into_values()
        .collect();
    messages.sort_by(|a, b| b.timestamp.total_cmp(&a.timestamp));
    messages.truncate(30);
    messages
}
fn merge_seen(old: &[Seen], incoming: &[Seen]) -> Vec<Seen> {
    let mut seen: BTreeMap<String, f64> = old
        .iter()
        .map(|s| (s.user_id.clone(), s.timestamp))
        .collect();
    for item in incoming {
        seen.entry(item.user_id.clone())
            .and_modify(|v| *v = v.max(item.timestamp))
            .or_insert(item.timestamp);
    }
    seen.into_iter()
        .map(|(user_id, timestamp)| Seen { user_id, timestamp })
        .collect()
}
fn watermarks(row: &mut Row, messages: &[Message], viewer: &str) {
    for message in messages {
        if !viewer.is_empty() && !message.sender_id.is_empty() {
            if message.sender_id == viewer {
                row.replied_through_at = row.replied_through_at.max(message.timestamp);
            } else {
                row.last_incoming_at = row.last_incoming_at.max(message.timestamp);
            }
        }
    }
    row.thread.unread = Some(row.last_incoming_at > row.replied_through_at);
}
fn public(mut row: Row) -> Thread {
    row.thread.messages = merge_messages(row.thread.messages.into_iter().chain(row.preview));
    row.thread
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn file_backed_databases_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("cache.sqlite");
        std::fs::write(&file, []).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        let _cache = Cache::open(&file).unwrap();
        assert_eq!(
            std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn bounded_history_and_disk_cache_skip_identical_writes_and_rollback_invalid_previews() {
        let mut cache = Cache::open(Path::new(":memory:")).unwrap();
        cache.connect("one", "token", "viewer").unwrap();
        let thread = Thread {
            id: "123".into(),
            messages: (0..100)
                .map(|n| Message {
                    id: n.to_string(),
                    timestamp: (100 - n) as f64,
                    sender_id: "friend".into(),
                    kind: "text".into(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        cache
            .save_thread("one", "token", thread.clone(), crate::api::now_ms() + 1)
            .unwrap();
        assert_eq!(
            cache.thread("one", "123").unwrap().unwrap().messages.len(),
            30
        );
        let changes = cache.db.total_changes();
        cache
            .save_thread("one", "token", thread.clone(), crate::api::now_ms() + 1)
            .unwrap();
        assert_eq!(cache.db.total_changes(), changes);
        assert!(cache
            .save_inbox("one", "token", "viewer", vec![thread], false)
            .is_err());
        assert_eq!(
            cache.thread("one", "123").unwrap().unwrap().messages.len(),
            30
        );
        for n in 0..250 {
            cache
                .save_thread(
                    "one",
                    "token",
                    Thread {
                        id: n.to_string(),
                        ..Default::default()
                    },
                    0,
                )
                .unwrap();
        }
        assert_eq!(
            cache
                .db
                .query_row("SELECT count(*) FROM threads", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            200
        );
    }
}
