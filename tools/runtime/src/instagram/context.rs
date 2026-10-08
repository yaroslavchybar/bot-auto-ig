use super::*;
use crate::native::subscriptions::Subscriptions;
use std::collections::HashSet;

#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionContext {
    pub profile_id: String,
    pub token: String,
    storage_id: String,
    reconnect_required: bool,
    pub enabled: bool,
    proxy: String,
    proxy_type: String,
}

pub(super) struct ContextSnapshot {
    connection: Arc<Subscriptions>,
    epoch: u64,
    profiles: HashMap<String, SessionContext>,
    invalidated: HashSet<String>,
}

impl Service {
    /// Subscription revisions authorize reuse; disconnected streams fall back to HTTP reads.
    pub fn update_contexts(&self, contexts: Vec<SessionContext>, connection: Arc<Subscriptions>) {
        let Some(epoch) = connection.current_epoch() else {
            self.clear_contexts();
            return;
        };
        let profiles: HashMap<_, _> = contexts
            .into_iter()
            .map(|v| (v.profile_id.clone(), v))
            .collect();
        let mut cache = self.contexts.write().unwrap();
        let invalidated = cache
            .as_ref()
            .map(|old| {
                old.invalidated
                    .iter()
                    .filter(|id| old.profiles.get(*id) == profiles.get(*id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        *cache = Some(ContextSnapshot {
            connection,
            epoch,
            profiles,
            invalidated,
        });
    }
    pub fn clear_contexts(&self) {
        *self.contexts.write().unwrap() = None;
    }
    fn invalidate_context(&self, id: &str) {
        if let Some(cache) = self.contexts.write().unwrap().as_mut() {
            cache.invalidated.insert(id.into());
        }
    }
    // None means no authoritative subscription; Some(None) means the session was removed.
    fn context(&self, id: &str) -> Option<Option<SessionContext>> {
        let cache = self.contexts.read().unwrap();
        let cache = cache.as_ref()?;
        if cache.connection.current_epoch() != Some(cache.epoch) || cache.invalidated.contains(id) {
            return None;
        }
        Some(cache.profiles.get(id).cloned())
    }
    pub(super) fn cached_status(&self, id: &str) -> Option<Value> {
        self.context(id).map(|context| {
            json!({
                "connected": context.as_ref().is_some_and(|v| !v.reconnect_required),
                "reconnectRequired": context.is_some_and(|v| v.reconnect_required),
            })
        })
    }
    pub(super) fn cached_context(&self, id: &str, entry: &Entry) -> Option<Value> {
        let Some(context) = self.context(id)? else {
            return Some(json!({"connected":false}));
        };
        if context.reconnect_required {
            return Some(json!({"connected":false,"reconnectRequired":true}));
        }
        let saved = entry.saved.as_ref()?;
        if saved["token"] != context.token || saved["storageId"] != context.storage_id {
            return None;
        }
        let mut saved = saved.clone();
        saved["profile"] = json!({"proxy":context.proxy,"proxyType":context.proxy_type});
        Some(saved)
    }
    pub(super) fn checkpoint(
        &self,
        id: &str,
        entry: &mut Entry,
        saved: &Value,
        state: &str,
        token: &str,
        result: &Value,
    ) {
        if let Some(cache) = self.contexts.write().unwrap().as_mut() {
            if cache.profiles.get(id).is_none_or(|context| {
                context.token != token || result["storageId"] != context.storage_id
            }) {
                cache.invalidated.insert(id.into());
            } else {
                cache.invalidated.remove(id);
            }
        }
        let mut next = saved.clone();
        next["connected"] = json!(true);
        next["reconnectRequired"] = json!(false);
        next["token"] = json!(token);
        next["state"] = json!(state);
        next["storageId"] = result["storageId"].clone();
        entry.saved = Some(next);
    }
    pub(super) fn invalidate_saved_context(&self, id: &str, entry: &mut Entry) {
        self.invalidate_context(id);
        entry.saved = None;
    }
}

#[cfg(test)]
mod tests;
