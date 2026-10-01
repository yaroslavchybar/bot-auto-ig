use super::{
    crypto,
    transport::{Fields, Mobile, BLOKS_VERSION},
    Error, Result,
};
use reqwest::Method;
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::LazyLock};

// Current CAA request bodies, kept as data so app-version changes are easy to review.
fn params(action: &str, mobile: &Mobile, values: &[(&str, Value)]) -> Result<Value> {
    static TEMPLATES: LazyLock<Value> = LazyLock::new(|| {
        serde_json::from_str(include_str!("caa-params.json")).expect("Static CAA templates")
    });
    let mut value = TEMPLATES
        .get(action)
        .cloned()
        .ok_or_else(|| Error::new("Unknown login action"))?;
    let mut variables: BTreeMap<&str, Value> = [
        ("$uuid", json!(mobile.state.uuid)),
        ("$phoneId", json!(mobile.state.phone_id)),
        ("$deviceId", json!(mobile.state.device_id)),
        ("$mid", json!(mobile.state.cookie("mid"))),
        ("$now", json!(crate::api::now_ms())),
    ]
    .into();
    variables.extend(values.iter().cloned());
    fn render(value: &mut Value, vars: &BTreeMap<&str, Value>) {
        match value {
            Value::String(text) => {
                if let Some(replacement) = vars.get(text.as_str()) {
                    *value = replacement.clone();
                } else {
                    for (key, val) in vars {
                        if let Some(val) = val.as_str().filter(|_| text.contains(key)) {
                            *text = text.replace(key, val);
                        }
                    }
                }
            }
            Value::Object(object) => object.values_mut().for_each(|v| render(v, vars)),
            Value::Array(array) => array.iter_mut().for_each(|v| render(v, vars)),
            _ => {}
        }
    }
    render(&mut value, &variables);
    Ok(value)
}

#[cfg(test)]
#[test]
fn login_templates_match_captured_typescript_requests_and_use_current_time() {
    let actual: Value = serde_json::from_str(include_str!("caa-params.json")).unwrap();
    let previous: Value =
        serde_json::from_str(include_str!("fixtures/typescript-login-params.json")).unwrap();
    assert_eq!(actual, previous);
    let mobile = Mobile {
        state: super::new_session("profile-123", "source"),
        client: super::transport::client("").unwrap(),
        base: None,
    };
    let before = crate::api::now_ms();
    let body = params(
        "com.bloks.www.bloks.caa.login.async.send_login_request",
        &mobile,
        &[],
    )
    .unwrap();
    let timestamp = body["server_params"]["INTERNAL__latency_qpl_instance_id"]
        .as_u64()
        .unwrap();
    assert!(timestamp >= before && timestamp <= crate::api::now_ms());
}

fn expression_at(text: &str, start: usize) -> &str {
    let mut depth = 0;
    let mut quoted = false;
    let mut escaped = false;
    for (offset, ch) in text.as_bytes()[start..].iter().enumerate() {
        if quoted {
            if escaped {
                escaped = false;
            } else if *ch == b'\\' {
                escaped = true;
            } else if *ch == b'"' {
                quoted = false;
            }
        } else if *ch == b'"' {
            quoted = true;
        } else if *ch == b'(' {
            depth += 1;
        } else if *ch == b')' {
            depth -= 1;
            if depth == 0 {
                return &text[start..start + offset + 1];
            }
        }
    }
    ""
}
fn quoted_at(text: &str, start: usize) -> &str {
    let mut escaped = false;
    for (offset, ch) in text.as_bytes()[start + 1..].iter().enumerate() {
        if escaped {
            escaped = false;
        } else if *ch == b'\\' {
            escaped = true;
        } else if *ch == b'"' {
            return &text[start..start + offset + 2];
        }
    }
    ""
}
fn list(expression: &str) -> Vec<&str> {
    if !expression.starts_with("(dkc") || !expression.ends_with(')') {
        return vec![];
    }
    let mut index = 4;
    let end = expression.len() - 1;
    let mut items = vec![];
    while index < end {
        while index < end && expression.as_bytes()[index].is_ascii_whitespace() {
            index += 1;
        }
        if index == end {
            break;
        }
        let start = index;
        if expression.as_bytes()[index] == b'(' {
            let nested = expression_at(expression, index);
            if nested.is_empty() {
                return vec![];
            }
            index += nested.len();
        } else if expression.as_bytes()[index] == b'"' {
            let quoted = quoted_at(expression, index);
            if quoted.is_empty() {
                return vec![];
            }
            index += quoted.len();
        } else {
            while index < end
                && !expression.as_bytes()[index].is_ascii_whitespace()
                && expression.as_bytes()[index] != b')'
            {
                index += 1;
            }
        }
        if index <= start || index > end {
            return vec![];
        }
        items.push(&expression[start..index]);
    }
    items
}
fn decoded(text: &str) -> String {
    serde_json::from_str::<String>(text).unwrap_or_default()
}

pub fn extract_context(value: &Value) -> String {
    fn direct(value: &Value, depth: usize) -> String {
        if depth > 40 {
            return String::new();
        }
        if let Some(text) = value["two_step_verification_context"]
            .as_str()
            .filter(|v| !v.is_empty())
        {
            return text.into();
        }
        let visit = |child: &Value| {
            let found = if let Some(text) = child.as_str().filter(|v| v.starts_with('{')) {
                serde_json::from_str(text)
                    .ok()
                    .map(|v| direct(&v, depth + 1))
                    .unwrap_or_default()
            } else {
                direct(child, depth + 1)
            };
            (!found.is_empty()).then_some(found)
        };
        match value {
            Value::Object(v) => v.values().find_map(visit),
            Value::Array(v) => v.iter().find_map(visit),
            _ => None,
        }
        .unwrap_or_default()
    }
    let found = direct(value, 0);
    if !found.is_empty() {
        return found;
    }
    let action = value
        .pointer("/layout/bloks_payload/action")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !action.contains("two_step_verification.entrypoint") {
        return String::new();
    }
    let Some(position) = action.find("\"two_step_verification_context\"") else {
        return String::new();
    };
    let Some(start) = action[..position].rfind("(dkc") else {
        return String::new();
    };
    let keys = expression_at(action, start);
    let Some(index) = list(keys)
        .iter()
        .position(|v| decoded(v) == "two_step_verification_context")
    else {
        return String::new();
    };
    let Some(values) = action[start + keys.len()..]
        .find("(dkc")
        .map(|p| p + start + keys.len())
    else {
        return String::new();
    };
    list(expression_at(action, values))
        .get(index)
        .map(|v| decoded(v))
        .unwrap_or_default()
}
pub fn extract_aac(value: &Value) -> String {
    for node in value
        .pointer("/layout/bloks_payload/data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let data = &node["data"];
        if data["key"] != "CAA_ACCOUNT_ACCESS_CONTEXT:aac" {
            continue;
        }
        if let Some(initial) = data["initial"].as_str().filter(|v| !v.is_empty()) {
            return initial.into();
        }
        if let Some(lispy) = data["initial_lispy"].as_str() {
            if let Some(start) = lispy.find('"') {
                let text = decoded(quoted_at(lispy, start));
                if !text.is_empty() {
                    return text;
                }
            }
        }
    }
    String::new()
}
fn login_payload(value: &Value, depth: usize) -> Option<Value> {
    if depth > 40 {
        return None;
    }
    if value.get("login_response").is_some() {
        return Some(value.clone());
    }
    match value {
        Value::Object(v) => v.values().find_map(|v| login_payload(v, depth + 1)),
        Value::Array(v) => v.iter().find_map(|v| login_payload(v, depth + 1)),
        Value::String(text) => {
            if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                return login_payload(&parsed, depth + 1);
            }
            let mut offset = 0;
            while let Some(start) = text[offset..].find('"').map(|p| p + offset) {
                let quoted = quoted_at(text, start);
                if quoted.is_empty() {
                    break;
                }
                let decoded = decoded(quoted);
                if decoded.contains("login_response") {
                    if let Some(v) = login_payload(&Value::String(decoded), depth + 1) {
                        return Some(v);
                    }
                }
                offset = start + quoted.len();
            }
            None
        }
        _ => None,
    }
}
pub fn apply_login(mobile: &mut Mobile, value: &Value) -> bool {
    let Some(payload) = login_payload(value, 0) else {
        return false;
    };
    let Ok(login) = serde_json::from_str::<Value>(payload["login_response"].as_str().unwrap_or(""))
    else {
        return false;
    };
    let Ok(headers) = serde_json::from_str::<Value>(payload["headers"].as_str().unwrap_or("{}"))
    else {
        return false;
    };
    let id = super::string(
        login
            .pointer("/logged_in_user/pk_id")
            .filter(|v| !v.is_null())
            .unwrap_or(&login["logged_in_user"]["pk"]),
    );
    // A previous session is not evidence that this reconnect succeeded.
    if !super::digits(&id) {
        return false;
    }
    if let Some(auth) = headers
        .as_object()
        .and_then(|h| {
            h.iter()
                .find(|(key, _)| key.eq_ignore_ascii_case("ig-set-authorization"))
        })
        .and_then(|(_, v)| v.as_str())
    {
        mobile.state.authorization = auth.into();
    }
    let url = "https://i.instagram.com/".parse().unwrap();
    let cookies = payload["cookies"].as_str().unwrap_or("");
    // Rust regex intentionally has no lookahead. A comma separates cookies only when followed by a cookie name.
    for line in cookies.lines() {
        let bytes = line.as_bytes();
        let mut start = 0;
        for i in 0..bytes.len().saturating_sub(2) {
            if &bytes[i..i + 2] == b", " {
                let tail = &line[i + 2..];
                let name = tail.split('=').next().unwrap_or("");
                if !name.is_empty() && !name.contains([' ', ',', ';']) && tail.contains('=') {
                    mobile.state.set_cookie(
                        line[start..i].trim().trim_start_matches("Set-Cookie: "),
                        &url,
                    );
                    start = i + 2;
                }
            }
        }
        mobile.state.set_cookie(
            line[start..].trim().trim_start_matches("Set-Cookie: "),
            &url,
        );
    }
    mobile.state.set_cookie(
        &format!("ds_user_id={id}; Domain=.instagram.com; Path=/"),
        &url,
    );
    !mobile.state.authorization.is_empty() || !mobile.state.cookie("sessionid").is_empty()
}

async fn bloks(
    mobile: &mut Mobile,
    action: &str,
    app: bool,
    values: &[(&str, Value)],
    extra: &Fields,
) -> Result<Value> {
    let params = params(action, mobile, values)?;
    let path = format!(
        "/api/v1/bloks/{}/{action}/",
        if app { "apps" } else { "async_action" }
    );
    let fields = [
        ("params".into(), params.to_string()),
        ("_uuid".into(), mobile.state.uuid.clone()),
        (
            "bk_client_context".into(),
            json!({"bloks_version":BLOKS_VERSION,"styles_id":"instagram"}).to_string(),
        ),
        ("bloks_versioning_id".into(), BLOKS_VERSION.into()),
    ]
    .into();
    let mut headers = extra.clone();
    headers.insert(
        "x-fb-friendly-name".into(),
        format!("IgApi: {}", path.trim_start_matches("/api/v1/")),
    );
    mobile
        .request(
            "b.i.instagram.com",
            Method::POST,
            &path,
            Some(&fields),
            &headers,
        )
        .await
}
pub async fn login(
    mobile: &mut Mobile,
    username: &str,
    password: &str,
    authenticator: &str,
) -> Result<()> {
    mobile
        .request(
            "i.instagram.com",
            Method::GET,
            "/api/v1/qe/sync/",
            None,
            &Fields::new(),
        )
        .await?;
    if mobile.state.password_key.is_empty() {
        return Err(Error::new(
            "Instagram did not provide a password encryption key",
        ));
    }
    let (identity, variables) = if let Some(identity) = mobile.state.usdid.take() {
        let variables = identity.registration(&mobile.state.phone_id)?;
        (identity, variables)
    } else {
        crypto::Usdid::create(&mobile.state.phone_id)?
    };
    let document = "124930351917786857261002920888";
    let fields = [
        ("method", "post"),
        ("pretty", "false"),
        ("format", "json"),
        ("server_timestamps", "true"),
        ("locale", "user"),
        ("fb_api_req_friendly_name", "IGUSDIDRegistrationMutation"),
        ("enable_canonical_naming", "true"),
        ("enable_canonical_variable_overrides", "true"),
        ("enable_canonical_naming_ambiguous_type_prefixing", "true"),
        ("purpose", "fetch"),
        ("client_doc_id", document),
    ]
    .into_iter()
    .map(|(k, v)| (k.into(), v.into()))
    .chain([("variables".into(), variables)])
    .collect();
    let extra = [
        ("x-fb-friendly-name", "IGUSDIDRegistrationMutation"),
        ("x-client-doc-id", document),
        ("x-root-field-name", "usdid_registration"),
        ("x-graphql-client-library", "pando"),
    ]
    .into_iter()
    .map(|(k, v)| (k.into(), v.into()))
    .collect();
    let result = mobile
        .request(
            "b.i.instagram.com",
            Method::POST,
            "/graphql_www",
            Some(&fields),
            &extra,
        )
        .await?;
    if !result["data"].as_object().is_some_and(|data| {
        data.iter().any(|(key, v)| {
            key.contains("usdid_registration") && v["success"].as_bool() == Some(true)
        })
    }) {
        return Err(Error::new("Instagram rejected CAA device registration"));
    }
    mobile.state.usdid = Some(identity);
    let waterfall = uuid::Uuid::new_v4().to_string();
    let homepage = bloks(
        mobile,
        "com.bloks.www.bloks.caa.login.process_client_data_and_redirect",
        false,
        &[("$waterfallId", json!(waterfall))],
        &Fields::new(),
    )
    .await?;
    let aac = extract_aac(&homepage);
    if aac.is_empty() {
        return Err(Error::new(
            "Instagram CAA did not issue account access context",
        ));
    }
    let fields = [
        ("app_scoped_device_id".into(), mobile.state.uuid.clone()),
        ("key_hash".into(), String::new()),
    ]
    .into();
    let extra = [(
        "x-fb-friendly-name".into(),
        "IgApi: attestation/create_android_keystore/".into(),
    )]
    .into();
    let attestation = mobile
        .request(
            "b.i.instagram.com",
            Method::POST,
            "/api/v1/attestation/create_android_keystore/",
            Some(&fields),
            &extra,
        )
        .await?;
    let nonce = attestation["challenge_nonce"]
        .as_str()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| Error::new("Instagram CAA did not issue attestation nonce"))?;
    let mut values = vec![
        ("$username", json!(username)),
        ("$aac", json!(aac)),
        ("$waterfallId", json!(waterfall)),
    ];
    bloks(
        mobile,
        "com.bloks.www.caa.login.oauth.token.fetch.async",
        false,
        &values,
        &Fields::new(),
    )
    .await?;
    let (time, encrypted) = crypto::encrypt_password(
        password,
        mobile.state.password_key_id,
        &mobile.state.password_key,
    )?;
    values.extend([
        ("$time", json!(time)),
        ("$encrypted", json!(encrypted)),
        (
            "$textInputId",
            json!(format!(
                "{}ig",
                &uuid::Uuid::new_v4().simple().to_string()[..4]
            )),
        ),
        ("$nonAscii", json!((!password.is_ascii()).to_string())),
    ]);
    let extra=[("x-ig-attest-params".into(),json!({"attestation":[{"version":2,"type":"keystore","errors":[-1013],"challenge_nonce":nonce,"signed_nonce":"","key_hash":""}]}).to_string())].into();
    let result = bloks(
        mobile,
        "com.bloks.www.bloks.caa.login.async.send_login_request",
        false,
        &values,
        &extra,
    )
    .await?;
    if apply_login(mobile, &result) {
        mobile.state.viewer_id()?;
        return Ok(());
    }
    if result
        .to_string()
        .contains("com.bloks.www.ap.two_step_verification.entrypoint_async")
    {
        return Err(Error::new(
            "Instagram requested email verification; authenticator codes are supported",
        ));
    }
    let context = extract_context(&result);
    if context.is_empty() {
        return Err(Error::new(
            "Instagram CAA login did not return a session or supported two-factor context",
        ));
    }
    let mut values = vec![("$context", json!(context))];
    for (action, app) in [
        ("com.bloks.www.two_step_verification.entrypoint", true),
        ("com.bloks.www.two_step_verification.method_picker", true),
        (
            "com.bloks.www.two_step_verification.method_picker.navigation.async",
            false,
        ),
    ] {
        bloks(mobile, action, app, &values, &Fields::new()).await?;
    }
    let remaining = 30_000 - crate::api::now_ms() % 30_000;
    if remaining < 8_000 {
        tokio::time::sleep(std::time::Duration::from_millis(remaining + 100)).await;
    }
    values.push((
        "$code",
        json!(crypto::authenticator_code(
            authenticator,
            crate::api::now_ms()
        )?),
    ));
    let result = bloks(
        mobile,
        "com.bloks.www.two_step_verification.verify_code.async",
        false,
        &values,
        &Fields::new(),
    )
    .await?;
    if !apply_login(mobile, &result) {
        return Err(Error::new("Instagram CAA rejected the verification code"));
    }
    mobile.state.viewer_id()?;
    Ok(())
}
