use super::{parse_credentials, profiles, username_hash, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE};
use crate::{
    api::Api,
    native::{
        http::{JsonBody, Services, JSON_LIMIT},
        Failure, Result,
    },
};
use axum::{
    extract::{Path, Query},
    http::Method,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::limit::RequestBodyLimitLayer;

pub fn router() -> Router<Arc<Api>> {
    Router::new()
        .route("/api/ig-accounts/page", get(page))
        .route("/api/ig-accounts/page/", get(page))
        .route("/api/ig-accounts/available-count", get(available_count))
        .route("/api/ig-accounts/available-count/", get(available_count))
        .route("/api/ig-accounts/blacklist", get(blacklist))
        .route("/api/ig-accounts/blacklist/", get(blacklist))
        .route("/api/ig-accounts/warmup", get(warmup))
        .route("/api/ig-accounts/warmup/", get(warmup))
        .route(
            "/api/ig-accounts/warmup/{profileId}/reconcile",
            post(reconcile),
        )
        .route("/api/ig-accounts/credentials/{id}", get(credentials))
        .route("/api/ig-accounts/import", post(import))
        .route("/api/ig-accounts/import/", post(import))
        .route("/api/ig-accounts/create-batch", post(create_batch))
        .route("/api/ig-accounts/create-batch/", post(create_batch))
        .route("/api/ig-accounts/{profileId}/connect", post(connect))
        .layer(RequestBodyLimitLayer::new(JSON_LIMIT))
}
async fn available_count(Services(native): Services) -> Result<Json<Value>> {
    Ok(Json(
        native.accounts.store("availableCount", json!({})).await?,
    ))
}
async fn blacklist(Services(native): Services) -> Result<Json<Value>> {
    Ok(Json(native.accounts.proxies.blacklist().await?))
}
async fn warmup(Services(native): Services) -> Result<Json<Value>> {
    Ok(Json(
        native.accounts.store("modelSetupList", json!({})).await?,
    ))
}
async fn credentials(Services(native): Services, Path(id): Path<String>) -> Result<Json<Value>> {
    let account = native.accounts.account("byId", json!({"id":id})).await?;
    if account.is_null() {
        return Err(Failure::missing("Credential not found"));
    }
    Ok(Json(account))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageQuery {
    page_size: Option<String>,
    search: Option<String>,
    cursor: Option<String>,
    profile_id: Option<String>,
}
async fn page(Services(native): Services, Query(query): Query<PageQuery>) -> Result<Json<Value>> {
    let accounts = &native.accounts;
    let value = {
        let page_size = match query.page_size.as_ref() {
            None => DEFAULT_PAGE_SIZE,
            Some(value) => value
                .parse::<usize>()
                .ok()
                .filter(|size| (1..=MAX_PAGE_SIZE).contains(size))
                .ok_or_else(|| Failure::invalid("Invalid page size"))?,
        };
        accounts
            .page(
                query.search.as_deref().unwrap_or(""),
                query.cursor.as_deref(),
                query.profile_id.as_deref(),
                page_size,
            )
            .await?
    };
    Ok(Json(value))
}
async fn import(Services(native): Services, JsonBody(body): JsonBody) -> Result<Json<Value>> {
    let raw = body["text"]
        .as_str()
        .ok_or_else(|| Failure::invalid("Choose a TXT file"))?;
    Ok(Json(native.accounts.import(raw).await?))
}
async fn reconcile(
    Services(native): Services,
    Path(id): Path<String>,
    JsonBody(body): JsonBody,
) -> Result<Json<Value>> {
    native
        .accounts
        .reconcile_setup(&id, profiles::text(&body, "resolution"))
        .await?;
    Ok(Json(json!({"ok":true})))
}
async fn create_batch(Services(native): Services, JsonBody(body): JsonBody) -> Result<Json<Value>> {
    let accounts = &native.accounts;
    let value = {
        let count = body["count"]
            .as_u64()
            .filter(|n| (1..=100).contains(n))
            .ok_or_else(|| Failure::invalid("Choose 1–100 profiles"))? as usize;
        let model = profiles::text(&body, "modelId");
        let models = accounts
            .api
            .convex(Method::GET, "/api/models", None)
            .await?;
        if !models
            .as_array()
            .into_iter()
            .flatten()
            .any(|m| m["id"] == model)
        {
            return Err(Failure::invalid("Choose a model"));
        }
        let available = accounts.available(count).await?;
        if available.len() < count {
            return Err(Failure::invalid(format!(
                "Only {} unused credentials are available",
                available.len()
            )));
        }
        let created=accounts.api.convex(Method::POST,"/api/profiles/create-for-model",Some(&json!({"modelId":model,"accounts":available.iter().map(|a|json!({"id":a["id"],"username":a["username"]})).collect::<Vec<_>>()}))).await?;
        for row in created.as_array().into_iter().flatten() {
            accounts
                .queue(profiles::text(row, "profileId").into())
                .await;
        }
        json!({"count":created.as_array().map_or(0,Vec::len),"created":created})
    };
    Ok(Json(value))
}
async fn connect(
    Services(native): Services,
    Path(id): Path<String>,
    JsonBody(body): JsonBody,
) -> Result<Json<Value>> {
    let accounts = &native.accounts;
    let value = {
        let profile_id = id.as_str();
        let profile = accounts.profiles.by_id(profile_id).await?;
        if profile.is_null() || profile["status"] == "deleting" {
            return Err(Failure::invalid("Profile is unavailable"));
        }
        let mut account = if let Some(id) = body["credentialId"].as_str() {
            accounts.account("byId", json!({"id":id})).await?
        } else {
            Value::Null
        };
        if profile["paused"] == true
            && !(account["status"] == "connected" && account["profileId"] == profile_id)
        {
            return Err(Failure::invalid(
                "Resume the profile before connecting a new credential",
            ));
        }
        if account.is_null() {
            if let Some(raw) = body["credentials"].as_str() {
                if profile["igLoggedIn"] != true {
                    return Err(Failure::invalid("Choose a logged-in profile"));
                }
                let parsed = parse_credentials(raw)?;
                accounts.import(raw).await?;
                account = accounts
                            .account(
                                "byUsernameHash",
                                json!({"usernameHash":username_hash(&accounts.credential_key()?,&parsed.username)}),
                            )
                            .await?;
            }
        }
        if account.is_null()
            || account["profileId"]
                .as_str()
                .is_some_and(|p| p != profile_id)
        {
            return Err(Failure::invalid("Choose an available credential"));
        }
        if profile["igLoggedIn"] != true {
            return Err(Failure::invalid("Choose a logged-in browser profile"));
        }
        if !profiles::text(&profile, "name")
            .eq_ignore_ascii_case(profiles::text(&account, "username"))
        {
            return Err(Failure::invalid(
                "Credential username must match the logged-in browser profile",
            ));
        }
        let _guard = accounts.action_lock(profile_id).await?;
        if account["profileId"] != profile_id {
            accounts
                .store("assign", json!({"id":account["id"],"profileId":profile_id}))
                .await?;
        }
        accounts
            .sync_name(
                profile_id,
                profiles::text(&account, "id"),
                profiles::text(&account, "username"),
            )
            .await?;
        json!({"ok":true})
    };
    Ok(Json(value))
}
