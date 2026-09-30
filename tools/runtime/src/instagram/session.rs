use super::{crypto::Usdid, transport::Session, Error, Result};
use serde_json::Value;

impl Session {
    /// Import the saved TypeScript state once, preserving the login and its device.
    pub fn from_saved(serialized: &str) -> Result<Self> {
        let value: Value = serde_json::from_str(serialized)
            .map_err(|_| Error::new("Saved Instagram session is invalid"))?;
        if value["version"] == 1 {
            return serde_json::from_value(value)
                .map_err(|_| Error::new("Saved Instagram session is invalid"));
        }
        if !value["version"].is_null() {
            return Err(Error::new("Unsupported saved Instagram session version"));
        }
        let field = |name: &str| -> Result<String> {
            value[name]
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= 512)
                .map(String::from)
                .ok_or_else(|| Error::new("Saved Instagram device is incomplete"))
        };
        let mut session = Self {
            version: 1,
            uuid: field("uuid")?,
            phone_id: field("phoneId")?,
            device_id: field("deviceId")?,
            device: field("deviceString")?,
            cookies: Default::default(),
            authorization: super::string(&value["authorization"]),
            claim: super::string(&value["igWWWClaim"]),
            usdid: if value["chatUsdid"].is_null() {
                None
            } else {
                Some(Usdid::from_typescript(&value["chatUsdid"])?)
            },
            password_key_id: super::string(&value["passwordEncryptionKeyId"])
                .parse()
                .unwrap_or(0),
            password_key: super::string(&value["passwordEncryptionPubKey"]),
        };
        let jar: Value = if let Some(text) = value["cookies"].as_str() {
            serde_json::from_str(text)
                .map_err(|_| Error::new("Saved Instagram cookies are invalid"))?
        } else {
            value["cookies"].clone()
        };
        let cookies = jar["cookies"]
            .as_array()
            .ok_or_else(|| Error::new("Saved Instagram cookies are invalid"))?;
        for cookie in cookies {
            let domain = cookie["domain"]
                .as_str()
                .unwrap_or("i.instagram.com")
                .trim_start_matches('.');
            if domain != "instagram.com" && !domain.ends_with(".instagram.com") {
                continue;
            }
            let Some(key) = cookie["key"].as_str() else {
                continue;
            };
            let Some(value) = cookie["value"].as_str() else {
                continue;
            };
            let mut encoded = format!(
                "{key}={value}; Path={}",
                cookie["path"].as_str().unwrap_or("/")
            );
            if cookie["hostOnly"] != true {
                encoded.push_str(&format!("; Domain={domain}"));
            }
            if cookie["secure"] == true {
                encoded.push_str("; Secure");
            }
            if cookie["httpOnly"] == true {
                encoded.push_str("; HttpOnly");
            }
            if let Some(expiry) = cookie["expires"]
                .as_str()
                .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
            {
                encoded.push_str(&format!(
                    "; Expires={}",
                    expiry
                        .with_timezone(&chrono::Utc)
                        .format("%a, %d %b %Y %H:%M:%S GMT")
                ));
            }
            if let Some(max_age) = cookie["maxAge"].as_i64() {
                // Preserve absolute expiry: restarting must not renew a relative cookie.
                if let Some(created) = cookie["creation"]
                    .as_str()
                    .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
                {
                    let expiry = created + chrono::Duration::seconds(max_age);
                    encoded.push_str(&format!(
                        "; Expires={}",
                        expiry
                            .with_timezone(&chrono::Utc)
                            .format("%a, %d %b %Y %H:%M:%S GMT")
                    ));
                }
            }
            let url = format!("https://{domain}/")
                .parse()
                .map_err(|_| Error::new("Saved Instagram cookie domain is invalid"))?;
            match session.cookies.parse(&encoded, &url) {
                Ok(_) | Err(cookie_store::CookieError::Expired) => {}
                Err(_) => return Err(Error::new("Saved Instagram cookie is invalid")),
            }
        }
        Ok(session)
    }
}
