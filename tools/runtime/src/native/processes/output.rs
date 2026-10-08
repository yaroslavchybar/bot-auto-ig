use regex::Regex;
use serde_json::{json, Value};
use std::sync::LazyLock;

/// Invalid control frames remain diagnostics; they must never kill the pipe reader.
pub(super) fn control_event(text: &str) -> Option<Value> {
    let text = text.strip_prefix("__EVENT__")?.strip_suffix("__EVENT__")?;
    let value: Value = serde_json::from_str(text).ok()?;
    (value.is_object() && value["type"].is_string()).then_some(value)
}

pub(super) fn diagnostic(text: &str, stderr: bool, secrets: &[String]) -> Value {
    static REDACTIONS: LazyLock<Vec<(Regex, &str)>> = LazyLock::new(|| {
        [
            (r"(?i)(https?://|socks5h?://)[^\s/@]+:[^\s/@]+@", "${1}[redacted]@"),
            (r#"(?i)\bBearer\s+[^\s,;"']+"#, "Bearer [redacted]"),
            (r#"(?i)\b(sessionid|csrftoken|password|passwd|secret|token|api_key|access_token|authenticatorKey)=([^\s&;,"']+)"#, "${1}=[redacted]"),
            (r#"(?i)(["'](?:password|passwd|secret|token|api_key|access_token|sessionid|csrftoken|authorization|cookie|authenticatorKey)["']\s*:\s*)["'][^"']*["']"#, "${1}\"[redacted]\""),
        ].into_iter().map(|(pattern, replacement)| (Regex::new(pattern).unwrap(), replacement)).collect()
    });
    let mut message = text.to_owned();
    for (pattern, replacement) in REDACTIONS.iter() {
        message = pattern.replace_all(&message, *replacement).into_owned();
    }
    for secret in secrets.iter().filter(|secret| secret.len() >= 4) {
        message = message.replace(secret, "[redacted]");
    }
    json!({"event":"worker.output", "message":message.chars().take(4000).collect::<String>(),
        "stream":if stderr { "stderr" } else { "stdout" },
        "level":if stderr && !benign_stderr(text) { "error" } else { "info" }})
}

fn benign_stderr(text: &str) -> bool {
    static BENIGN: LazyLock<Vec<Regex>> =
        LazyLock::new(|| {
            [
            r"^CloakBrowser - stealth Chromium for automation$",
            r"^https://github\.com/CloakHQ/CloakBrowser$",
            r"(?i)^CloakBrowser (free|pro) \(v[^)]*\):",
            r"(?i)^CloakBrowser Pro active \(v[^)]*\)",
            r"^Pro support -> support@cloakbrowser\.dev$",
            r"(?i)^Running the free binary \(v[^)]*\)",
            r"(?i)^Get your key: run\s+cloakbrowser login",
            r"(?i)^\[cloakbrowser\] Preview channel requested, but no preview build is available",
            r"(?i)^For more than one concurrent session",
            r"^Star us if CloakBrowser helps your project!$",
            r"(?i)Incomplete Windows font set",
            r"(?i)^\[cloakbrowser\] (Downloading GeoIP|GeoIP database ready)",
        ].into_iter().map(|pattern| Regex::new(pattern).unwrap()).collect()
        });
    BENIGN.iter().any(|pattern| pattern.is_match(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_preserve_errors_but_redact_credentials_and_bound_unicode() {
        let note = diagnostic(
            r#"Error: https://user:pass@proxy.test Bearer private sessionid=cookie {"password":"hidden","authenticatorKey":"seed"} fixture-key"#,
            true,
            &["fixture-key".into()],
        );
        let text = note["message"].as_str().unwrap();
        assert!(text.contains("Error:"));
        for secret in [
            "user:pass",
            "private",
            "cookie",
            "hidden",
            "seed",
            "fixture-key",
        ] {
            assert!(!text.contains(secret), "leaked {secret}");
        }
        assert_eq!(note["level"], "error");
        assert_eq!(note["stream"], "stderr");
        assert_eq!(
            diagnostic(&"🤖".repeat(5000), false, &[])["message"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            4000
        );
        assert_eq!(
            diagnostic("CloakBrowser - stealth Chromium for automation", true, &[])["level"],
            "info"
        );
    }
}
