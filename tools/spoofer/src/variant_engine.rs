use image::{DynamicImage, ImageDecoder, ImageReader, Rgb, RgbImage};
use jpeg_encoder::{ColorType, Encoder};
use serde::Serialize;
use serde_json::json;
use std::collections::HashSet;
use std::fs;
use std::io::{BufWriter, Cursor, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const HELP: &str = "Usage: spoof variants <image> --output-dir <path> [--copies 1-100] [--json]";

#[derive(Serialize)]
struct Variant {
    index: usize,
    name: String,
    size: u64,
    hash: String,
}

struct Rng(u64);

impl Rng {
    fn new(seed: &str) -> Self {
        let mut value = 0xcbf29ce484222325u64;
        for byte in seed.bytes() {
            value = (value ^ u64::from(byte)).wrapping_mul(0x100000001b3);
        }
        Self(value)
    }

    fn next(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545f4914f6cdd1d) as f64) / (u64::MAX as f64)
    }

    fn between(&mut self, low: f64, high: f64) -> f64 {
        low + (high - low) * self.next()
    }
}

const MAX_PIXELS: u64 = 12_000_000;
const MAX_SOURCE_BYTES: u64 = 15 * 1024 * 1024;

fn check_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width < 64
        || height < 64
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err("Image must be 64-16384 pixels per side and at most 12 megapixels".into());
    }
    Ok(())
}

/// Validate headers before decoding; one source frame is reused for every variant.
fn decode_source(input: &Path) -> Result<RgbImage, String> {
    if fs::metadata(input)
        .map_err(|_| "Source image is missing")?
        .len()
        > MAX_SOURCE_BYTES
    {
        return Err("Image must be at most 15 MB".into());
    }
    let reader = ImageReader::open(input)
        .map_err(|_| "Could not open image")?
        .with_guessed_format()
        .map_err(|_| "Could not identify image")?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| "Invalid image metadata")?;
    check_dimensions(width, height)?;
    let mut reader = ImageReader::open(input)
        .map_err(|_| "Could not open image")?
        .with_guessed_format()
        .map_err(|_| "Could not identify image")?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| "Could not decode image")?;
    let orientation = decoder
        .orientation()
        .map_err(|_| "Invalid image orientation")?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| "Could not decode image")?;
    image.apply_orientation(orientation);
    Ok(image.into_rgb8())
}

fn fingerprint(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

/// Compare decoded JPEG pixels, so metadata or encoding alone cannot establish uniqueness.
fn pixel_fingerprint(image: &RgbImage) -> u64 {
    fingerprint(image.as_raw())
}

fn sample(image: &RgbImage, x: f64, y: f64) -> [f64; 3] {
    if x < 0.0 || y < 0.0 || x > f64::from(image.width() - 1) || y > f64::from(image.height() - 1) {
        return [0.0; 3];
    }
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(image.width() - 1);
    let y1 = (y0 + 1).min(image.height() - 1);
    let dx = x - f64::from(x0);
    let dy = y - f64::from(y0);
    std::array::from_fn(|channel| {
        let top = f64::from(image.get_pixel(x0, y0)[channel]) * (1.0 - dx)
            + f64::from(image.get_pixel(x1, y0)[channel]) * dx;
        let bottom = f64::from(image.get_pixel(x0, y1)[channel]) * (1.0 - dx)
            + f64::from(image.get_pixel(x1, y1)[channel]) * dx;
        top * (1.0 - dy) + bottom * dy
    })
}

/// Fuse rotation, crop, resize and color changes into one bounded output frame.
fn make_variant(
    source: &RgbImage,
    rng: &mut Rng,
    attempt: usize,
    output: &mut RgbImage,
    encoded: &mut Vec<u8>,
) -> Result<(), String> {
    let (width, height) = source.dimensions();
    let stage = 1.0 + ((attempt - 1) / 16) as f64;
    let crop = (rng.between(0.002, 0.005) * stage).min(0.03);
    let cw = f64::from(width) * (1.0 - crop);
    let ch = f64::from(height) * (1.0 - crop);
    let crop_x = rng.next() * (f64::from(width) - cw);
    let crop_y = rng.next() * (f64::from(height) - ch);
    let (sin, cos) = (rng.between(-0.0026, 0.0026) * stage).sin_cos();
    let brightness = rng.between(-0.015, 0.015) * 255.0;
    let contrast = rng.between(0.985, 1.015);
    let saturation = rng.between(0.97, 1.03);
    let (hue_sin, hue_cos) = rng.between(-2.0, 2.0).to_radians().sin_cos();
    let noise = rng.between(0.8, 2.0) * stage;
    let quality = rng.between(91.0, 97.0).round() as u8;
    let cx = f64::from(width - 1) / 2.0;
    let cy = f64::from(height - 1) / 2.0;
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        let px = crop_x + (f64::from(x) + 0.5) * cw / f64::from(width) - 0.5 - cx;
        let py = crop_y + (f64::from(y) + 0.5) * ch / f64::from(height) - 0.5 - cy;
        let [r, g, b] = sample(source, cos * px + sin * py + cx, -sin * px + cos * py + cy);
        let luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        let i = 0.596 * r - 0.274 * g - 0.322 * b;
        let q = 0.211 * r - 0.523 * g + 0.312 * b;
        let rotated_i = (i * hue_cos - q * hue_sin) * saturation;
        let rotated_q = (i * hue_sin + q * hue_cos) * saturation;
        let rgb = [
            luminance + 0.956 * rotated_i + 0.621 * rotated_q,
            luminance - 0.272 * rotated_i - 0.647 * rotated_q,
            luminance - 1.106 * rotated_i + 1.703 * rotated_q,
        ];
        *pixel = Rgb(rgb.map(|value| {
            ((value - 127.5) * contrast + 127.5 + brightness + rng.between(-noise, noise))
                .round()
                .clamp(0.0, 255.0) as u8
        }));
    }
    encoded.clear();
    Encoder::new(encoded, quality)
        .encode(output.as_raw(), width as u16, height as u16, ColorType::Rgb)
        .map_err(|_| "Could not encode variant")?;
    Ok(())
}

/// Verification replaces the working pixels, avoiding a second decoded RGB frame.
fn verify_pixels(encoded: &[u8], output: &mut RgbImage) -> Result<u64, String> {
    let decoder = image::codecs::jpeg::JpegDecoder::new(Cursor::new(encoded))
        .map_err(|_| "Could not verify variant pixels")?;
    if decoder.dimensions() != output.dimensions() || decoder.color_type() != image::ColorType::Rgb8
    {
        return Err("Could not verify variant pixels".into());
    }
    decoder
        .read_image(output.as_mut())
        .map_err(|_| "Could not verify variant pixels")?;
    Ok(pixel_fingerprint(output))
}

fn exif_field(
    tag: u16,
    kind: u16,
    value: &[u8],
    offset: &mut u32,
    extra: &mut Vec<u8>,
) -> [u8; 12] {
    let mut field = [0u8; 12];
    field[0..2].copy_from_slice(&tag.to_le_bytes());
    field[2..4].copy_from_slice(&kind.to_le_bytes());
    field[4..8].copy_from_slice(&(value.len() as u32).to_le_bytes());
    if value.len() <= 4 {
        field[8..8 + value.len()].copy_from_slice(value);
    } else {
        field[8..12].copy_from_slice(&offset.to_le_bytes());
        extra.extend_from_slice(value);
        *offset += value.len() as u32;
        if !(*offset).is_multiple_of(2) {
            extra.push(0);
            *offset += 1;
        }
    }
    field
}

/// Write JPEG and capture metadata once, without copying or rereading the JPEG.
fn write_variant(path: &Path, bytes: &[u8], rng: &mut Rng) -> Result<u64, String> {
    const MODELS: [&str; 6] = [
        "iPhone 11",
        "iPhone 12",
        "iPhone 13",
        "iPhone 14 Pro",
        "iPhone 15",
        "iPhone 15 Pro Max",
    ];
    let model = MODELS[((rng.next() * MODELS.len() as f64) as usize).min(MODELS.len() - 1)];
    let days_ago = (rng.between(7.0, 730.0) as u64) * 86400;
    let capture = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_sub(days_ago);
    let date = format!("{}\0", chrono_date(capture));
    let make = b"Apple\0";
    let model = format!("{model}\0");
    let mut extra = Vec::new();
    let mut offset = 8 + 2 + 3 * 12 + 4;
    let fields = [
        exif_field(0x010f, 2, make, &mut offset, &mut extra),
        exif_field(0x0110, 2, model.as_bytes(), &mut offset, &mut extra),
        exif_field(0x0132, 2, date.as_bytes(), &mut offset, &mut extra),
    ];
    let mut tiff = b"II\x2a\0\x08\0\0\0".to_vec();
    tiff.extend_from_slice(&3u16.to_le_bytes());
    for field in fields {
        tiff.extend_from_slice(&field);
    }
    tiff.extend_from_slice(&0u32.to_le_bytes());
    tiff.extend(extra);
    let mut payload = b"Exif\0\0".to_vec();
    payload.extend(tiff);
    if payload.len() + 2 > u16::MAX as usize {
        return Err("EXIF data is too large".into());
    }
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return Err("Variant is not a JPEG".into());
    }
    let mut output = BufWriter::new(fs::File::create(path).map_err(|_| "Could not write variant")?);
    for part in [
        &bytes[..2],
        &[0xff, 0xe1],
        &((payload.len() + 2) as u16).to_be_bytes(),
        &payload,
        &bytes[2..],
    ] {
        output
            .write_all(part)
            .map_err(|_| "Could not write variant")?;
    }
    output.flush().map_err(|_| "Could not write variant")?;
    Ok((bytes.len() + payload.len() + 4) as u64)
}

fn chrono_date(seconds: u64) -> String {
    let days = (seconds / 86400) as i64;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    let time = seconds % 86400;
    format!(
        "{year:04}:{month:02}:{day:02} {:02}:{:02}:{:02}",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

fn parse_args(args: &[String]) -> Result<(PathBuf, PathBuf, usize, bool), String> {
    if args.first().map(String::as_str) != Some("variants") || args.len() < 2 {
        return Err(HELP.into());
    }
    let input = PathBuf::from(&args[1]);
    let mut output = None;
    let mut copies = 50;
    let mut json = false;
    let mut index = 2;
    while index < args.len() {
        match args[index].as_str() {
            "--output-dir" => {
                index += 1;
                output = args.get(index).map(PathBuf::from);
                if output.is_none() {
                    return Err("--output-dir needs a path".into());
                }
            }
            "--copies" => {
                index += 1;
                copies = args
                    .get(index)
                    .and_then(|value| value.parse::<usize>().ok())
                    .ok_or("--copies needs a number")?;
                if !(1..=100).contains(&copies) {
                    return Err("--copies must be 1–100".into());
                }
            }
            "--json" => json = true,
            "--help" => return Err(HELP.into()),
            other => return Err(format!("Unknown option: {other}")),
        }
        index += 1;
    }
    Ok((
        input,
        output.ok_or("--output-dir is required")?,
        copies,
        json,
    ))
}

pub fn generate(
    input: &Path,
    output_dir: &Path,
    copies: usize,
) -> Result<serde_json::Value, String> {
    if !(1..=100).contains(&copies) {
        return Err("Copies must be 1-100".into());
    }
    let extension = input
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["jpg", "jpeg", "png", "webp"].contains(&extension.as_str()) || !input.is_file() {
        return Err("Provide an existing JPG, PNG, or WebP image".into());
    }
    let source = decode_source(input)?;
    let source_hash = pixel_fingerprint(&source);
    fs::create_dir_all(output_dir).map_err(|error| error.to_string())?;
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut seen = HashSet::with_capacity(copies);
    let mut outputs = Vec::with_capacity(copies);
    let mut failures = Vec::new();
    let mut pixels = RgbImage::new(source.width(), source.height());
    let mut encoded = Vec::new();
    for index in 1..=copies {
        let name = format!("image_{index:03}.jpg");
        let output = output_dir.join(&name);
        let mut failure = "Could not make a unique image".to_string();
        for attempt in 1..=48 {
            let mut rng = Rng::new(&format!("{seed}:{index}:{attempt}"));
            if let Err(error) = make_variant(&source, &mut rng, attempt, &mut pixels, &mut encoded)
            {
                failure = error;
                break;
            }
            let hash = match verify_pixels(&encoded, &mut pixels) {
                Ok(hash) => hash,
                Err(error) => {
                    failure = error;
                    break;
                }
            };
            if hash == source_hash || seen.contains(&hash) {
                let _ = fs::remove_file(&output);
                continue;
            }
            let size = match write_variant(&output, &encoded, &mut rng) {
                Ok(size) => size,
                Err(error) => {
                    failure = error;
                    break;
                }
            };
            seen.insert(hash);
            outputs.push(Variant {
                index,
                name,
                size,
                hash: format!("{hash:016x}"),
            });
            failure.clear();
            break;
        }
        if !failure.is_empty() {
            let _ = fs::remove_file(&output);
            failures.push(json!({ "index": index, "error": failure }));
        }
    }
    Ok(
        json!({ "ok": failures.is_empty(), "total": copies, "outputs": outputs, "failures": failures }),
    )
}

pub fn run_cli(args: &[String]) -> Result<(), String> {
    let (input, output_dir, copies, output_json) = parse_args(args)?;
    let result = generate(&input, &output_dir, copies)?;
    if output_json {
        println!("{result}");
    } else {
        println!(
            "Created {}/{} image variants in {}",
            result["outputs"].as_array().unwrap().len(),
            copies,
            output_dir.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dimensions_bound_total_memory() {
        assert!(check_dimensions(16384, 16384).is_err());
        assert!(check_dimensions(4000, 3000).is_ok());
        assert!(check_dimensions(4000, 3001).is_err());
        assert!(check_dimensions(63, 64).is_err());
    }
    #[test]
    fn invalid_verification_data_and_dimensions_are_rejected() {
        let mut pixels = RgbImage::new(96, 64);
        assert_eq!(
            verify_pixels(b"invalid JPEG", &mut pixels).unwrap_err(),
            "Could not verify variant pixels"
        );
        let source = RgbImage::from_pixel(64, 64, Rgb([127, 127, 127]));
        let mut encoded = Vec::new();
        Encoder::new(&mut encoded, 95)
            .encode(source.as_raw(), 64, 64, ColorType::Rgb)
            .unwrap();
        assert_eq!(
            verify_pixels(&encoded, &mut pixels).unwrap_err(),
            "Could not verify variant pixels"
        );
    }
    #[test]
    fn decoded_variants_are_unique_and_keep_dimensions() {
        let source = RgbImage::from_fn(96, 64, |x, y| Rgb([x as u8, (y * 3) as u8, (x + y) as u8]));
        let mut seen = HashSet::new();
        let mut pixels = RgbImage::new(source.width(), source.height());
        let mut bytes = Vec::new();
        for seed in 0..50 {
            make_variant(
                &source,
                &mut Rng::new(&seed.to_string()),
                1,
                &mut pixels,
                &mut bytes,
            )
            .unwrap();
            let decoded = image::load_from_memory(&bytes).unwrap().into_rgb8();
            assert_eq!(decoded.dimensions(), source.dimensions());
            let hash = pixel_fingerprint(&decoded);
            assert_eq!(verify_pixels(&bytes, &mut pixels).unwrap(), hash);
            assert_ne!(hash, pixel_fingerprint(&source));
            assert!(seen.insert(hash));
        }
    }
}
