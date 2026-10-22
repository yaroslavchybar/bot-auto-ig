use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;

pub fn log_environment(service: &str) -> Value {
    let env = |key, fallback: &str| std::env::var(key).unwrap_or_else(|_| fallback.into());
    json!({"service": service, "runtime": "rust", "version": env("SERVICE_VERSION", "1.0.0"),
        "commitHash": env("COMMIT_SHA", &env("GIT_COMMIT", "unknown")), "region": env("REGION", "unknown"),
        "instanceId": env("INSTANCE_ID", &env("HOSTNAME", service)),
        "nodeEnv": env("NODE_ENV", "production")})
}

/// Keep Rust application events bounded and redact credentials before Docker collects them.
pub fn write_log_entry(mut entry: Value) {
    if !entry["message"].is_string() {
        entry["message"] = json!(entry["event"]
            .as_str()
            .unwrap_or("application event")
            .replace(['.', '_'], " "));
    }
    let secrets: Vec<String> = std::env::vars_os()
        .map(|(key, value)| {
            (
                key.to_string_lossy().into_owned(),
                value.to_string_lossy().into_owned(),
            )
        })
        .filter(|(key, value)| secret_env_key(key) && value.len() >= 4)
        .map(|(_, value)| value)
        .collect();
    sanitize(&mut entry, &secrets, 0);
    if entry["level"] == "error" {
        eprintln!("{entry}");
    } else {
        println!("{entry}");
    }
}

fn secret_env_key(key: &str) -> bool {
    let key = key.replace(['_', '-'], "").to_ascii_lowercase();
    [
        "password",
        "passwd",
        "secret",
        "token",
        "apikey",
        "privatekey",
    ]
    .iter()
    .any(|part| key.contains(part))
}

fn private_key(key: &str) -> bool {
    let key = key.replace(['_', '-'], "").to_ascii_lowercase();
    [
        "password",
        "passwd",
        "secret",
        "token",
        "apikey",
        "privatekey",
        "authenticatorkey",
    ]
    .iter()
    .any(|part| key.ends_with(part))
        || [
            "authorization",
            "cookie",
            "cookies",
            "cookiesjson",
            "sessionid",
            "instagramsessionid",
            "headers",
            "body",
            "requestbody",
            "responsebody",
            "attachment",
            "content",
            "messagetext",
        ]
        .contains(&key.as_str())
}

fn protected_cookie_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    private_key(&name)
        || ["session", "csrf", "auth", "token"]
            .iter()
            .any(|part| name.contains(part))
}

pub fn sanitize_log_text(text: &str, secrets: &[String]) -> String {
    static REDACTIONS: LazyLock<Vec<(Regex, &str)>> = LazyLock::new(|| {
        [
            (r"(?i)([a-z][a-z0-9+.-]*://)[^\s/@]*:[^\s/@]+@", "${1}[redacted]@"),
            (r#"(?i)\bBearer\s+[^\s,;"']+"#, "Bearer [redacted]"),
            (r#"(?i)\b(sessionid|instagramSessionId|csrftoken|password|passwd|secret|token|api_key|access_token|authenticatorKey)=([^\s&;,"']+)"#, "${1}=[redacted]"),
            (r#"(?i)(["'](?:password|passwd|secret|token|api_key|access_token|sessionid|instagramSessionId|csrftoken|authorization|cookie|authenticatorKey)["']\s*:\s*)["'][^"']*["']"#, r#"${1}"[redacted]""#),
            (r"(?i)data:image/[^;,\s]+;base64,[a-z0-9+/=_-]+", "[redacted image]"),
        ].into_iter().map(|(pattern, replacement)| (Regex::new(pattern).unwrap(), replacement)).collect()
    });
    // Parse embedded records so field order, escapes and nested metadata cannot bypass redaction.
    let mut clean = String::with_capacity(text.len());
    let mut copied = 0;
    for (start, _) in text.match_indices('{') {
        if start < copied {
            continue;
        }
        let mut records = serde_json::Deserializer::from_str(&text[start..]).into_iter::<Value>();
        let Some(Ok(mut record)) = records.next() else {
            continue;
        };
        sanitize(&mut record, secrets, 0);
        clean.push_str(&text[copied..start]);
        clean.push_str(&record.to_string());
        copied = start + records.byte_offset();
    }
    clean.push_str(&text[copied..]);
    let mut text = clean;
    for (pattern, replacement) in REDACTIONS.iter() {
        text = pattern.replace_all(&text, *replacement).into_owned();
    }
    for secret in secrets.iter().filter(|secret| secret.len() >= 4) {
        text = text.replace(secret, "[redacted]");
    }
    text.chars().take(4000).collect()
}

fn sanitize(value: &mut Value, secrets: &[String], depth: usize) {
    match value {
        Value::String(text) => *text = sanitize_log_text(text, secrets),
        Value::Array(_) | Value::Object(_) if depth >= 6 => *value = json!("[truncated]"),
        Value::Array(items) => {
            items.truncate(30);
            for item in items {
                sanitize(item, secrets, depth + 1);
            }
        }
        Value::Object(fields) => {
            let protected_value = fields
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(protected_cookie_name);
            let keys: Vec<_> = fields.keys().skip(100).cloned().collect();
            for key in keys {
                fields.remove(&key);
            }
            for (key, item) in fields {
                if private_key(key) || (key == "value" && protected_value) {
                    *item = json!("[redacted]");
                } else {
                    sanitize(item, secrets, depth + 1);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ESCAPED_RECORD: &str = r#"Error: {"password":"first\"quote-secret","api-key":"other'apostrophe-secret","nested":{"access_token":"slash\\\"quote-secret"},"record":{"name":"theme","value":"Bob's \"blue\" theme"},"count":4} (retry)"#;

    fn assert_escaped_record_is_sanitized(message: &str) {
        assert!(!message.contains("quote-secret"));
        assert!(!message.contains("apostrophe-secret"));
        let record: Value = serde_json::from_str(
            message
                .strip_prefix("Error: ")
                .unwrap()
                .strip_suffix(" (retry)")
                .unwrap(),
        )
        .unwrap();
        assert_eq!(record["password"], "[redacted]");
        assert_eq!(record["api-key"], "[redacted]");
        assert_eq!(record["nested"]["access_token"], "[redacted]");
        assert_eq!(
            record["record"],
            json!({"name":"theme","value":"Bob's \"blue\" theme"})
        );
        assert_eq!(record["count"], 4);
    }

    #[test]
    fn text_redacts_every_embedded_record_with_escaped_quotes_and_apostrophes() {
        assert_escaped_record_is_sanitized(&sanitize_log_text(ESCAPED_RECORD, &[]));
    }

    #[test]
    fn writer_redacts_every_embedded_record_with_escaped_quotes_and_apostrophes() {
        const CHILD: &str = "IG_LOGGING_EMBEDDED_JSON_TEST_CHILD";
        if std::env::var_os(CHILD).is_some() {
            write_log_entry(json!({"event":"fixture", "level":"info", "message":ESCAPED_RECORD}));
            return;
        }
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "logging::tests::writer_redacts_every_embedded_record_with_escaped_quotes_and_apostrophes", "--nocapture"])
            .env(CHILD, "1")
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        let entry: Value = serde_json::from_str(
            stdout
                .lines()
                .find_map(|line| line.find('{').map(|start| &line[start..]))
                .unwrap(),
        )
        .unwrap();
        assert_escaped_record_is_sanitized(entry["message"].as_str().unwrap());
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn logging_handles_non_unicode_environment_and_preserves_redaction() {
        const CHILD: &str = "IG_LOGGING_NON_UNICODE_TEST_CHILD";
        if std::env::var_os(CHILD).is_some() {
            write_log_entry(json!({"event":"fixture", "level":"info",
                "message":"Failure fixture-password fixture-key-secret secr\u{fffd}et db.fixture abc"}));
            return;
        }
        // Inject invalid OS strings into a child process without mutating parallel tests' environment.
        #[cfg(unix)]
        let invalid = {
            use std::os::unix::ffi::OsStringExt;
            std::ffi::OsString::from_vec(vec![0xff])
        };
        #[cfg(windows)]
        let invalid = {
            use std::os::windows::ffi::OsStringExt;
            std::ffi::OsString::from_wide(&[0xd800])
        };
        let mut key = std::ffi::OsString::from("API_TOKEN_");
        key.push(&invalid);
        let mut value = std::ffi::OsString::from("secr");
        value.push(&invalid);
        value.push("et");
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "logging::tests::logging_handles_non_unicode_environment_and_preserves_redaction",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .env("DB_PASSWORD", "fixture-password")
            .env(key, "fixture-key-secret")
            .env("DB_PASSWD", value)
            .env("DB_HOST", "db.fixture")
            .env("SHORT_SECRET", "abc")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        let entry: Value = serde_json::from_str(
            stdout
                .lines()
                .find_map(|line| line.find('{').map(|start| &line[start..]))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            entry["message"],
            "Failure [redacted] [redacted] [redacted] db.fixture abc"
        );
    }

    #[test]
    fn passwd_environment_values_are_redacted_without_a_label() {
        for key in [
            "DB_PASSWD",
            "DB-PASSWD",
            "dbpasswd",
            "DbPasswd",
            "DB_PASSWORD",
        ] {
            let environment = [(key, "opaque-db-credential"), ("DB_HOST", "db.fixture")];
            let secrets: Vec<String> = environment
                .into_iter()
                .filter(|(key, value)| secret_env_key(key) && value.len() >= 4)
                .map(|(_, value)| value.to_owned())
                .collect();
            assert_eq!(
                sanitize_log_text(
                    "Connection failed: opaque-db-credential at db.fixture",
                    &secrets
                ),
                "Connection failed: [redacted] at db.fixture",
                "environment key {key}"
            );
        }
    }

    #[test]
    fn logged_urls_redact_database_http_and_socks_credentials() {
        for scheme in [
            "postgres",
            "postgresql",
            "mysql",
            "mongodb+srv",
            "redis",
            "http",
            "https",
            "socks5",
            "socks5h",
        ] {
            let mut entry = json!({"event":"connection.failed", "context":{"attempts":2},
                "error":{"message":format!("Failed {scheme}://db-user:db-password@db.fixture:5432/app?sslmode=require")}});
            sanitize(&mut entry, &[], 0);
            let output = entry.to_string();
            assert!(
                !output.contains("db-password"),
                "password leaked for {scheme}"
            );
            assert!(!output.contains("db-user"), "username leaked for {scheme}");
            assert_eq!(
                entry["error"]["message"],
                format!("Failed {scheme}://[redacted]@db.fixture:5432/app?sslmode=require")
            );
            assert_eq!(entry["context"]["attempts"], 2);
            let public_url = format!("{scheme}://db.fixture:5432/app");
            assert_eq!(sanitize_log_text(&public_url, &[]), public_url);
        }
        assert_eq!(
            sanitize_log_text("redis://:opaque-password@db.fixture", &[]),
            "redis://[redacted]@db.fixture"
        );
        assert_eq!(
            sanitize_log_text("POSTGRESQL://user:p%40ss%3Aword@[::1]:5432/app", &[]),
            "POSTGRESQL://[redacted]@[::1]:5432/app"
        );
    }

    #[test]
    fn logged_name_value_records_redact_protected_cookies_only() {
        for name in [
            "sessionid",
            "csrftoken",
            "instagramSessionId",
            "ACCESS_TOKEN",
            "Session-ID",
            "auth-0",
            "csrf-1",
            "session-2",
        ] {
            for secret in [
                json!("opaque-cookie-credential"),
                json!({"nested":"opaque-cookie-credential"}),
            ] {
                let mut entry = json!({"event":"fixture", "context":{"records":[
                    {"name":name,"value":secret,"domain":".instagram.com"},
                    {"name":"theme","value":"dark"},
                    {"value":"ordinary-value"},
                    {"name":123,"value":"ordinary-value"},
                    {"name":name}
                ]}});
                sanitize(&mut entry, &[], 0);
                assert!(!entry.to_string().contains("opaque-cookie-credential"));
                assert_eq!(
                    entry["context"]["records"][0],
                    json!({"name":name,"value":"[redacted]","domain":".instagram.com"})
                );
                assert_eq!(
                    entry["context"]["records"][1],
                    json!({"name":"theme","value":"dark"})
                );
                assert_eq!(entry["context"]["records"][2]["value"], "ordinary-value");
                assert_eq!(entry["context"]["records"][3]["value"], "ordinary-value");
                assert_eq!(entry["context"]["records"][4], json!({"name":name}));
            }
        }
    }

    #[test]
    fn logged_messages_redact_serialized_cookie_records() {
        for name in ["sessionid", "auth-0", "CSRF-ID"] {
            for record in [
                json!({"name":name,"value":"session-secret","domain":".instagram.com"}).to_string(),
                format!(
                    r#"{{"value":"session-secret", "domain":".instagram.com", "name":{}}}"#,
                    json!(name)
                ),
                json!({"name":name,"value":"session-secret","domain":".instagram.com", "metadata":{"source":"browser"}}).to_string(),
                json!({"name":name,"value":{"nested":"session-secret"},"domain":".instagram.com"}).to_string(),
                json!({"name":name,"value":"session-secret","domain":".instagram.com", "metadata":{"name":"auth-1","value":"session-secret"}}).to_string(),
            ] {
                let message =
                    format!(r#"addCookies failed: [{record},{{"name":"theme","value":"dark"}}]"#);
                let mut entry = json!({"event":"fixture", "message":message});
                sanitize(&mut entry, &[], 0);
                assert!(!entry.to_string().contains("session-secret"));
                let message = entry["message"].as_str().unwrap();
                let records: Value =
                    serde_json::from_str(message.strip_prefix("addCookies failed: ").unwrap())
                        .unwrap();
                assert_eq!(records[0]["name"], name);
                assert_eq!(records[0]["value"], "[redacted]");
                assert_eq!(records[0]["domain"], ".instagram.com");
                assert_eq!(records[1], json!({"name":"theme","value":"dark"}));
            }
        }
        let message = r#"[{"name":"sessionid"},{"name":"theme","value":"ordinary"}]"#;
        assert_eq!(sanitize_log_text(message, &[]), message);
        let message = r#"Cookie: {"name":"sess\u0069onid","value":"session-secret\"tail"}"#;
        let clean = sanitize_log_text(message, &[]);
        assert!(!clean.contains("session-secret"));
        assert!(!clean.contains("tail"));
    }

    #[test]
    fn logs_redact_credentials_and_bound_details_without_losing_counts() {
        let mut value = json!({"event":"job.finished", "context":{"saved":3, "password":"hidden", "accessToken":"hidden",
            "promptTokens":123, "totalTokens":456, "tokenCount":7, "tokenUsage":{"input":8},
            "notes":[{"message":r#"https://user:pass@proxy.test Bearer bearer-value sessionid=cookie-value {"password":"quoted-value"} configured-value data:image/png;base64,AAAA"#}],
            "large":"🤖".repeat(5000), "rows":vec![1; 50]}});
        sanitize(&mut value, &["configured-value".into()], 0);
        let text = value.to_string();
        for secret in [
            "hidden",
            "user:pass",
            "bearer-value",
            "cookie-value",
            "quoted-value",
            "configured-value",
            "AAAA",
        ] {
            assert!(!text.contains(secret), "leaked {secret}");
        }
        assert_eq!(value["context"]["saved"], 3);
        assert_eq!(value["context"]["promptTokens"], 123);
        assert_eq!(value["context"]["totalTokens"], 456);
        assert_eq!(value["context"]["tokenCount"], 7);
        assert_eq!(value["context"]["tokenUsage"]["input"], 8);
        assert_eq!(value["context"]["rows"].as_array().unwrap().len(), 30);
        assert_eq!(
            value["context"]["large"].as_str().unwrap().chars().count(),
            4000
        );
    }
}
