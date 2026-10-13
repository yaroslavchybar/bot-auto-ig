use super::{
    transport::{Fields, Mobile},
    Error, Result,
};
use crate::api::bounded_json;
use reqwest::Method;
use serde_json::json;
use std::time::Duration;

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
    mobile.reserve_request().await?;
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
