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
    let message = ig_service_common::sanitize_log_text(text, secrets);
    json!({"event":"worker.output", "message":message,
        "stream":if stderr { "stderr" } else { "stdout" },
        "level":if stderr && !benign_stderr(text) { "error" } else { "info" }})
}

/// Stderr alone cannot fail a worker; an explicit session failure can, even after a clean exit.
pub(super) fn completion(
    status: &str,
    diagnostic_error: Option<Value>,
    session_error: Option<Value>,
) -> Value {
    let outcome = match status {
        "cancelled" => "cancelled",
        "failed" => "error",
        _ if session_error.is_some() => "error",
        _ => "success",
    };
    json!({
        "level": if outcome == "error" { "error" } else { "info" },
        "outcome": outcome,
        "error": if outcome == "error" {
            session_error.or_else(|| diagnostic_error.map(|note| json!({"type":"WorkerOutput", "message":note["message"]})))
        } else { None },
    })
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
    fn completion_uses_worker_status_and_retains_diagnostics_only_for_failures() {
        let warning = diagnostic(
            "TimeoutNegativeWarning: -0.1 is a negative number.",
            true,
            &[],
        );
        for status in ["completed", "pending", "cancelled"] {
            let result = completion(status, Some(warning.clone()), None);
            assert_eq!(result["level"], "info");
            assert!(result["error"].is_null());
            assert_eq!(
                result["outcome"],
                if status == "cancelled" {
                    "cancelled"
                } else {
                    "success"
                }
            );
        }
        let result = completion("failed", Some(diagnostic("Import failed", true, &[])), None);
        assert_eq!(result["outcome"], "error");
        assert_eq!(result["error"]["message"], "Import failed");
        assert_eq!(completion("failed", None, None)["outcome"], "error");
    }

    #[test]
    fn session_failure_is_visible_after_clean_exit_without_overriding_cancellation() {
        let error = json!({"type":"AutomationSession", "message":"Profile browsing stalled"});
        for status in ["completed", "pending", "failed"] {
            let result = completion(
                status,
                Some(diagnostic("Unrelated stderr", true, &[])),
                Some(error.clone()),
            );
            assert_eq!(result["level"], "error");
            assert_eq!(result["outcome"], "error");
            assert_eq!(result["error"], error);
        }
        let cancelled = completion("cancelled", None, Some(error));
        assert_eq!(cancelled["outcome"], "cancelled");
        assert!(cancelled["error"].is_null());
    }

    #[test]
    fn diagnostics_preserve_errors_but_redact_credentials_and_bound_unicode() {
        let note = diagnostic(
            r#"Error: https://user:pass@proxy.test Bearer private sessionid=cookie {"password":"hidden","instagramSessionId":"hidden","authenticatorKey":"seed"} fixture-key"#,
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
