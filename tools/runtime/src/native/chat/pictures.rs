use super::*;
use std::io::Cursor;

pub(super) async fn download(
    client: &reqwest::Client,
    url: &str,
    permit: tokio::sync::OwnedSemaphorePermit,
) -> Result<Vec<u8>> {
    let mut response = client
        .get(url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| Failure::unavailable("Profile picture unavailable"))?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > 1024 * 1024)
    {
        return Err(Failure::unavailable("Profile picture unavailable"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Failure::unavailable("Profile picture unavailable"))?
    {
        if bytes.len().saturating_add(chunk.len()) > 1024 * 1024 {
            return Err(Failure::invalid("Profile picture is too large"));
        }
        bytes.extend_from_slice(&chunk);
    }
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        thumbnail(bytes)
    })
    .await
    .map_err(|_| Failure::unavailable("Profile picture decoder failed"))?
}

fn thumbnail(bytes: Vec<u8>) -> Result<Vec<u8>> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(32 * 1024 * 1024);
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    reader.limits(limits);
    let frame = reader
        .decode()
        .map_err(|_| Failure::invalid("Invalid profile picture"))?
        .thumbnail(128, 128);
    let mut bytes = Cursor::new(Vec::new());
    frame
        .write_to(&mut bytes, image::ImageFormat::WebP)
        .map_err(|_| Failure::unavailable("Profile picture encoding failed"))?;
    Ok(bytes.into_inner())
}

impl Chat {
    pub(super) async fn picture(&self, id: &str, user: &str, profile: &Value) -> Result<Response> {
        valid_id(user)?;
        // The device requests images only when its local copy needs refreshing.
        self.inbox(id, false).await?;
        let owner = id.to_owned();
        let user = user.to_owned();
        let url = self
            .db(move |db| db.picture_url(&owner, &user))
            .await?
            .and_then(|url| instagram::picture_url(&url))
            .ok_or_else(|| Failure::missing("Profile picture unavailable"))?;
        let proxy = instagram::normalize_proxy(
            &instagram::string(&profile["proxy"]),
            &instagram::string(&profile["proxyType"]),
        )
        .map_err(|_| Failure::invalid("Invalid account proxy"))?;
        // Public CDN requests use the account proxy without forwarding its session credentials.
        let client = instagram::transport_client(&proxy)
            .map_err(|_| Failure::unavailable("Picture transport unavailable"))?;
        let permit = self
            .picture_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Failure::unavailable("Chat stopped"))?;
        let bytes = download(&client, &url, permit).await?;
        Ok((
            [
                ("content-type", "image/webp"),
                ("cache-control", "no-store"),
            ],
            bytes,
        )
            .into_response())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::Fixture;

    #[tokio::test]
    async fn public_picture_downloads_are_small_thumbnails_without_credentials() {
        let mut encoded = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(800, 400)
            .write_to(&mut encoded, image::ImageFormat::Jpeg)
            .unwrap();
        let encoded = encoded.into_inner();
        let fixture = Fixture::start(move |request| {
            let encoded = encoded.clone();
            async move {
                assert!(request.headers().get("authorization").is_none());
                assert!(request.headers().get("cookie").is_none());
                encoded.into_response()
            }
        })
        .await;
        let client = instagram::transport_client("").unwrap();
        let slots = Arc::new(tokio::sync::Semaphore::new(1));
        let bytes = download(
            &client,
            &fixture.url,
            slots.clone().acquire_owned().await.unwrap(),
        )
        .await
        .unwrap();
        let image = image::load_from_memory(&bytes).unwrap();
        assert_eq!((image.width(), image.height()), (128, 64));
        assert!(bytes.len() < 256 * 1024);
        assert_eq!(slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn invalid_large_failed_and_redirected_downloads_are_rejected() {
        let fixture = Fixture::start(|request| async move {
            match request.uri().path() {
                "/large" => vec![0_u8; 1024 * 1024 + 1].into_response(),
                "/redirect" => (
                    StatusCode::FOUND,
                    [("location", "http://127.0.0.1/private")],
                )
                    .into_response(),
                "/failed" => StatusCode::BAD_GATEWAY.into_response(),
                _ => "not an image".into_response(),
            }
        })
        .await;
        let client = instagram::transport_client("").unwrap();
        let slots = Arc::new(tokio::sync::Semaphore::new(1));
        for path in ["/invalid", "/large", "/redirect", "/failed"] {
            assert!(download(
                &client,
                &format!("{}{path}", fixture.url),
                slots.clone().acquire_owned().await.unwrap()
            )
            .await
            .is_err());
            assert_eq!(slots.available_permits(), 1);
        }
        assert!(thumbnail(vec![]).is_err());
    }
}
