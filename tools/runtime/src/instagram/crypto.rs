use super::{Error, Result};
use aes_gcm::{
    aead::{AeadInPlace, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use hmac::{Hmac, Mac};
use p256::{
    ecdsa::{signature::Signer, Signature, SigningKey},
    pkcs8::{DecodePrivateKey, EncodePrivateKey, EncodePublicKey},
};
use rand::{rngs::OsRng, RngCore};
use rsa::{pkcs1::DecodeRsaPublicKey, pkcs8::DecodePublicKey, Pkcs1v15Encrypt, RsaPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize)]
pub struct Usdid {
    pub id: String,
    private_key: String,
}
fn sign(key: &SigningKey, value: &str) -> String {
    let signature: Signature = key.sign(value.as_bytes());
    URL_SAFE_NO_PAD.encode(signature.to_der().as_bytes())
}
impl Usdid {
    pub fn from_typescript(value: &Value) -> Result<Self> {
        let id = value["id"]
            .as_str()
            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
            .ok_or_else(|| Error::new("Saved Instagram device identity is invalid"))?;
        let pem = value["privateKey"]
            .as_str()
            .ok_or_else(|| Error::new("Saved Instagram device key is invalid"))?;
        let key = SigningKey::from_pkcs8_pem(pem)
            .map_err(|_| Error::new("Saved Instagram device key is invalid"))?;
        Ok(Self {
            id: id.into(),
            private_key: STANDARD.encode(
                key.to_pkcs8_der()
                    .map_err(|_| Error::new("Saved Instagram device key is invalid"))?
                    .as_bytes(),
            ),
        })
    }
    pub fn create(phone_id: &str) -> Result<(Self, String)> {
        let key = SigningKey::random(&mut OsRng);
        let identity = Self {
            id: uuid::Uuid::new_v4().to_string(),
            private_key: STANDARD.encode(
                key.to_pkcs8_der()
                    .map_err(|_| Error::new("Device key encoding failed"))?
                    .as_bytes(),
            ),
        };
        let variables = identity.registration(phone_id)?;
        Ok((identity, variables))
    }
    pub fn registration(&self, phone_id: &str) -> Result<String> {
        let bytes = STANDARD
            .decode(&self.private_key)
            .map_err(|_| Error::new("Invalid device identity"))?;
        let key = SigningKey::from_pkcs8_der(&bytes)
            .map_err(|_| Error::new("Invalid device identity"))?;
        let now = crate::api::now_ms() / 1000;
        let public = key
            .verifying_key()
            .to_public_key_der()
            .map_err(|_| Error::new("Device key encoding failed"))?;
        let payload = URL_SAFE_NO_PAD.encode(json!({"sub":self.id,"iat":now,"aud":super::transport::APP_ID,"exp":now+3600,"pub":STANDARD.encode(public.as_bytes()),"alg":"ES256"}).to_string());
        let mut random = [0; 32];
        OsRng.fill_bytes(&mut random);
        let protected = URL_SAFE_NO_PAD.encode(json!({"typ":"JWT","alg":"ES256","kid":URL_SAFE_NO_PAD.encode(random),"aid":super::transport::APP_ID,"ver":"1"}).to_string());
        let token = URL_SAFE_NO_PAD.encode(json!({"payload":payload,"signatures":[{"protected":protected,"signature":sign(&key,&format!("{protected}.{payload}"))}]}).to_string());
        Ok(json!({"input":{"usdid_token":{"sensitive_string_value":token},"fdid":{"sensitive_string_value":phone_id}}}).to_string())
    }
    pub fn header(&self) -> Result<String> {
        let bytes = STANDARD
            .decode(&self.private_key)
            .map_err(|_| Error::new("Invalid device identity"))?;
        let key = SigningKey::from_pkcs8_der(&bytes)
            .map_err(|_| Error::new("Invalid device identity"))?;
        let value = format!("{}.{}", self.id, crate::api::now_ms() / 1000 + 3600);
        Ok(format!("{value}.{}", sign(&key, &value)))
    }
}

pub fn encrypt_password(password: &str, key_id: u8, public: &str) -> Result<(String, String)> {
    let pem = STANDARD
        .decode(public)
        .map_err(|_| Error::new("Invalid password encryption key"))?;
    let pem =
        std::str::from_utf8(&pem).map_err(|_| Error::new("Invalid password encryption key"))?;
    let rsa = RsaPublicKey::from_public_key_pem(pem)
        .or_else(|_| RsaPublicKey::from_pkcs1_pem(pem))
        .map_err(|_| Error::new("Invalid password encryption key"))?;
    let mut key = [0; 32];
    let mut iv = [0; 12];
    OsRng.fill_bytes(&mut key);
    OsRng.fill_bytes(&mut iv);
    let wrapped = rsa
        .encrypt(&mut OsRng, Pkcs1v15Encrypt, &key)
        .map_err(|_| Error::new("Password encryption failed"))?;
    let time = (crate::api::now_ms() / 1000).to_string();
    let mut encrypted = password.as_bytes().to_vec();
    let tag = Aes256Gcm::new((&key).into())
        .encrypt_in_place_detached(Nonce::from_slice(&iv), time.as_bytes(), &mut encrypted)
        .map_err(|_| Error::new("Password encryption failed"))?;
    let mut packet = vec![1, key_id];
    packet.extend(iv);
    packet.extend((wrapped.len() as u16).to_le_bytes());
    packet.extend(wrapped);
    packet.extend(tag);
    packet.extend(encrypted);
    Ok((time, STANDARD.encode(packet)))
}

pub fn signed_fields(payload: &Value) -> super::transport::Fields {
    let body = payload.to_string();
    let mut mac = <Hmac<sha2::Sha256> as Mac>::new_from_slice(
        b"9193488027538fd3450b83b7d05286d4ca9599a0f7eeed90d8c85925698a05dc",
    )
    .unwrap();
    mac.update(body.as_bytes());
    let hash = mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|v| format!("{v:02x}"))
        .collect::<String>();
    [
        ("ig_sig_key_version".into(), "4".into()),
        ("signed_body".into(), format!("{hash}.{body}")),
    ]
    .into()
}

pub fn authenticator_code(key: &str, now: u64) -> Result<String> {
    let mut bytes = Vec::new();
    let mut bits = 0;
    let mut buffer = 0u32;
    for ch in key.bytes() {
        let digit = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
            .iter()
            .position(|v| *v == ch)
            .ok_or_else(|| Error::new("Invalid authenticator key"))?;
        buffer = (buffer << 5) | digit as u32;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    if bytes.is_empty() || bits > 0 && buffer != 0 {
        return Err(Error::new("Invalid authenticator key"));
    }
    let mut mac = <Hmac<sha1::Sha1> as Mac>::new_from_slice(&bytes).unwrap();
    mac.update(&(now / 30_000).to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = (digest[19] & 15) as usize;
    Ok(format!(
        "{:06}",
        (u32::from_be_bytes(digest[offset..offset + 4].try_into().unwrap()) & 0x7fffffff)
            % 1_000_000
    ))
}
