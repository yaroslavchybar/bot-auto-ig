use super::{
    transport::{Fields, Mobile},
    Error, Result, Service,
};
use crate::{api::bounded_json, uploads::Upload};
use reqwest::Method;
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

pub struct Uploaded {
    pub media_id: String,
    pub upload_id: String,
}
fn headers(mobile: &Mobile) -> Result<Fields> {
    let user = mobile.state.viewer_id()?;
    if mobile.state.authorization.is_empty() {
        return Err(Error::new(
            "Instagram Chat session has no upload authorization",
        ));
    }
    Ok([
        ("authorization",mobile.state.authorization.clone()),("ig-intended-user-id",user.clone()),("ig-u-ds-user-id",user),
        ("user-agent",mobile.state.user_agent()),("accept-language","en-US".into()),("x-fb-client-ip","True".into()),
        ("x-fb-friendly-name","undefined:media-upload".into()),("x-fb-http-engine","Tigon/MNS/TCP".into()),
        ("x-fb-request-analytics-tags",json!({"network_tags":{"product":"567067343352427","surface":"undefined","request_category":"media_upload","purpose":"none","retry_attempt":"0"}}).to_string()),
        ("x-fb-rmd","state=URL_ELIGIBLE".into()),("x-fb-server-cluster","True".into()),("x-tigon-is-retry","False".into()),("x-ig-salt-ids","51052545".into()),
    ].into_iter().map(|(k,v)|(k.into(),v)).collect())
}
async fn request(
    mobile: &Mobile,
    method: Method,
    endpoint: &str,
    headers: &Fields,
    file: Option<(&Upload, u64)>,
) -> Result<Value> {
    let seconds = if file.is_none() {
        30
    } else if endpoint.starts_with("/messenger_video/") {
        300
    } else {
        120
    };
    let mut request = mobile
        .client
        .request(method, mobile.endpoint("rupload.facebook.com", endpoint))
        .timeout(Duration::from_secs(seconds));
    for (key, value) in headers {
        request = request.header(key, value);
    }
    if let Some((upload, offset)) = file {
        let mut file = tokio::fs::File::open(&upload.path)
            .await
            .map_err(|_| Error::new("Attachment file is missing"))?;
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|_| Error::new("Could not read attachment file"))?;
        request = request.header("content-length", upload.size - offset).body(
            reqwest::Body::wrap_stream(ReaderStream::with_capacity(
                file.take(upload.size - offset),
                64 * 1024,
            )),
        );
    }
    let response = request
        .send()
        .await
        .map_err(|_| Error::new("Instagram media upload connection failed"))?;
    if !response.status().is_success() {
        return Err(Error::new(&format!(
            "Instagram media upload HTTP {}",
            response.status().as_u16()
        )));
    }
    bounded_json(response, 1_000_000).await.map_err(Error::new)
}
pub async fn upload(
    service: &Service,
    mobile: &Mobile,
    kind: &str,
    args: &Value,
) -> Result<Uploaded> {
    let id = args["uploadId"].as_str().unwrap_or("");
    let file: Arc<Upload> = service
        .uploads
        .entries
        .lock()
        .await
        .get(id)
        .filter(|upload| upload.is_live() && upload.kind == kind)
        .cloned()
        .ok_or_else(|| Error::new("Attachment expired or has the wrong type"))?;
    let now = crate::api::now_ms();
    let mut headers = headers(mobile)?;
    let (entity, endpoint, content_type, upload_id) = match kind {
        "photo" => {
            headers.insert("image_type".into(), "FILE_ATTACHMENT".into());
            let entity = format!("fb_uploader_{now}");
            let endpoint = format!("/messenger_image/{entity}");
            (entity, endpoint, "image/jpeg", String::new())
        }
        "voice" => {
            headers.insert("audio_type".into(), "FILE_ATTACHMENT".into());
            let entity = format!("{now}_0_{}", rand::random::<i32>());
            let endpoint = format!("/messenger_audio/{entity}");
            (entity, endpoint, "audio/mp4", now.to_string())
        }
        "video" => {
            let hex = uuid::Uuid::new_v4().simple().to_string();
            let entity = format!("{hex}-0-{}-{now}-{now}", file.size);
            let upload_id = rand::Rng::gen_range(
                &mut rand::thread_rng(),
                100_000_000_000u64..1_000_000_000_000,
            )
            .to_string();
            headers.extend([
                ("video_type".into(), "FILE_ATTACHMENT".into()),
                ("segment-start-offset".into(), "0".into()),
                ("segment-type".into(), "3".into()),
                ("ephemeral_media_view_mode".into(), "2".into()),
                ("ig_raven_metadata".into(), "{}".into()),
                (
                    "x_fb_video_waterfall_id".into(),
                    format!("{upload_id}_{}_Mixed_0", hex[..12].to_uppercase()),
                ),
            ]);
            let endpoint = format!("/messenger_video/{entity}");
            (entity, endpoint, "video/mp4", upload_id)
        }
        _ => return Err(Error::new("Invalid attachment kind")),
    };
    let offset = if kind == "photo" {
        0
    } else {
        let initial = request(mobile, Method::GET, &endpoint, &headers, None).await?;
        match initial.get("offset") {
            None => 0,
            Some(value) => value
                .as_u64()
                .filter(|v| *v <= file.size)
                .ok_or_else(|| Error::new("Instagram media upload returned an invalid offset"))?,
        }
    };
    headers.extend([
        ("content-type".into(), "application/octet-stream".into()),
        ("offset".into(), offset.to_string()),
        ("x-entity-length".into(), file.size.to_string()),
        ("x-entity-name".into(), entity),
        ("x-entity-type".into(), content_type.into()),
    ]);
    let data = request(
        mobile,
        Method::POST,
        &endpoint,
        &headers,
        Some((&file, offset)),
    )
    .await?;
    let media_id = super::string(&data["media_id"]);
    if !super::digits(&media_id) {
        return Err(Error::new("Instagram media upload returned no media ID"));
    }
    Ok(Uploaded {
        media_id,
        upload_id,
    })
}

pub async fn profile_picture(mobile: &mut Mobile, image: Vec<u8>) -> Result<()> {
    if image.is_empty() || image.len() > 10_000_000 || !image.starts_with(&[0xff, 0xd8]) {
        return Err(Error::new("Choose a JPEG photo under 10 MB"));
    }
    let upload_id = crate::api::now_ms().to_string();
    let entity = format!(
        "{upload_id}_0_{}",
        rand::Rng::gen_range(&mut rand::thread_rng(), 1_000_000_000u64..10_000_000_000)
    );
    let url: reqwest::Url = format!("https://i.instagram.com/rupload_igphoto/{entity}")
        .parse()
        .unwrap();
    let response=mobile.client.post(mobile.endpoint("i.instagram.com",url.path())).headers(mobile.headers(&url)?)
        .header("x-instagram-rupload-params",json!({"retry_context":"{\"num_step_auto_retry\":0,\"num_reupload\":0,\"num_step_manual_retry\":0}","media_type":"1","upload_id":upload_id,"xsharing_user_ids":"[]","image_compression":"{\"lib_name\":\"moz\",\"lib_version\":\"3.1.m\",\"quality\":\"80\"}"}).to_string())
        .header("x_fb_photo_waterfall_id",uuid::Uuid::new_v4().to_string())
        .header("x-entity-type","image/jpeg").header("x-entity-name",entity).header("x-entity-length",image.len()).header("offset","0").header("content-type","application/octet-stream")
        .timeout(Duration::from_secs(120)).body(image).send().await.map_err(|_|Error::new("Instagram profile photo upload failed"))?;
    let success = response.status().is_success();
    mobile.receive_headers(response.headers(), &url);
    let result = bounded_json(response, 1_000_000)
        .await
        .map_err(Error::new)?;
    if !success || result["status"] != "ok" {
        return Err(Error::new("Instagram profile photo upload failed"));
    }
    let fields = [
        ("_csrftoken".into(), mobile.state.cookie("csrftoken")),
        ("_uuid".into(), mobile.state.uuid.clone()),
        ("use_fbuploader".into(), "true".into()),
        ("upload_id".into(), upload_id),
    ]
    .into();
    let result = mobile
        .mobile(
            Method::POST,
            "accounts/change_profile_picture/",
            Some(&fields),
            &Fields::new(),
        )
        .await?;
    if result["status"] != "ok" {
        return Err(Error::new(
            "Instagram did not confirm the profile picture change",
        ));
    }
    Ok(())
}
