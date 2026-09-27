use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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

fn run(command: &str, args: &[String]) -> Result<std::process::Output, String> {
    let output = Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not start {command}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "{command}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output)
}

fn dimensions(input: &Path) -> Result<(u32, u32), String> {
    let output = run(
        "ffprobe",
        &[
            "-v".into(),
            "error".into(),
            "-select_streams".into(),
            "v:0".into(),
            "-show_entries".into(),
            "stream=width,height".into(),
            "-of".into(),
            "json".into(),
            input.to_string_lossy().into_owned(),
        ],
    )?;
    let data: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Invalid image metadata: {error}"))?;
    let stream = data["streams"]
        .as_array()
        .and_then(|items| items.first())
        .ok_or("No image stream found")?;
    let width = stream["width"].as_u64().unwrap_or(0) as u32;
    let height = stream["height"].as_u64().unwrap_or(0) as u32;
    if width < 64 || height < 64 || width > 16384 || height > 16384 {
        return Err("Image dimensions must be 64–16384 pixels".into());
    }
    Ok((width, height))
}

fn fingerprint(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

/** Compare decoded pixels so metadata and JPEG encoding alone cannot make a copy unique. */
fn pixel_fingerprint(path: &Path) -> Result<u64, String> {
    let output = run(
        "ffmpeg",
        &[
            "-v".into(),
            "error".into(),
            "-threads".into(),
            "1".into(),
            "-filter_threads".into(),
            "1".into(),
            "-i".into(),
            path.to_string_lossy().into_owned(),
            "-frames:v".into(),
            "1".into(),
            "-vf".into(),
            "scale=256:256:flags=lanczos,format=rgb24".into(),
            "-f".into(),
            "rawvideo".into(),
            "-pix_fmt".into(),
            "rgb24".into(),
            "pipe:1".into(),
        ],
    )?;
    if output.stdout.len() != 256 * 256 * 3 {
        return Err("Could not fingerprint image pixels".into());
    }
    Ok(fingerprint(&output.stdout))
}

fn even(value: f64) -> u32 {
    ((value / 2.0).floor() as u32 * 2).max(2)
}

fn make_variant(
    input: &Path,
    output: &Path,
    width: u32,
    height: u32,
    rng: &mut Rng,
    attempt: usize,
) -> Result<(), String> {
    let stage = 1.0 + ((attempt - 1) / 16) as f64;
    let crop = (rng.between(0.002, 0.005) * stage).min(0.03);
    let cw = even(width as f64 * (1.0 - crop));
    let ch = even(height as f64 * (1.0 - crop));
    let x = (rng.next() * f64::from(width.saturating_sub(cw))).floor() as u32;
    let y = (rng.next() * f64::from(height.saturating_sub(ch))).floor() as u32;
    let angle = rng.between(-0.0026, 0.0026) * stage;
    let brightness = rng.between(-0.015, 0.015);
    let contrast = rng.between(0.985, 1.015);
    let saturation = rng.between(0.97, 1.03);
    let hue = rng.between(-2.0, 2.0);
    let noise = rng.between(0.8, 2.0) * stage;
    let quality = rng.between(91.0, 97.0);
    let filter = format!("rotate={angle}:ow=iw:oh=ih:c=black:bilinear=1,crop={cw}:{ch}:{x}:{y},scale={width}:{height}:flags=lanczos,eq=brightness={brightness}:contrast={contrast}:saturation={saturation},hue=h={hue},noise=alls={noise}:allf=t+u");
    run(
        "ffmpeg",
        &[
            "-v".into(),
            "error".into(),
            "-y".into(),
            "-threads".into(),
            "1".into(),
            "-filter_threads".into(),
            "1".into(),
            "-i".into(),
            input.to_string_lossy().into_owned(),
            "-frames:v".into(),
            "1".into(),
            "-vf".into(),
            filter,
            "-map_metadata".into(),
            "-1".into(),
            "-q:v".into(),
            ((100.0 - quality) / 3.0_f64).round().max(2.0).to_string(),
            output.to_string_lossy().into_owned(),
        ],
    )?;
    Ok(())
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
        if *offset % 2 != 0 {
            extra.push(0);
            *offset += 1;
        }
    }
    field
}

/** Add one plausible iPhone make/model and capture time to each JPEG. */
fn inject_exif(path: &Path, rng: &mut Rng) -> Result<(), String> {
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
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return Err("Variant is not a JPEG".into());
    }
    let mut output = Vec::with_capacity(bytes.len() + payload.len() + 4);
    output.extend_from_slice(&bytes[..2]);
    output.extend_from_slice(&[0xff, 0xe1]);
    output.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    output.extend_from_slice(&payload);
    output.extend_from_slice(&bytes[2..]);
    fs::write(path, output).map_err(|error| error.to_string())
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

pub fn run_cli(args: &[String]) -> Result<(), String> {
    let (input, output_dir, copies, output_json) = parse_args(args)?;
    let extension = input
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["jpg", "jpeg", "png", "webp"].contains(&extension.as_str()) || !input.is_file() {
        return Err("Provide an existing JPG, PNG, or WebP image".into());
    }
    let (width, height) = dimensions(&input)?;
    let source_hash = pixel_fingerprint(&input)?;
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut seen = HashSet::new();
    let mut outputs = Vec::new();
    let mut failures = Vec::new();
    for index in 1..=copies {
        let name = format!("image_{index:03}.jpg");
        let output = output_dir.join(&name);
        let mut failure = "Could not make a unique image".to_string();
        for attempt in 1..=48 {
            let mut rng = Rng::new(&format!("{seed}:{index}:{attempt}"));
            match make_variant(&input, &output, width, height, &mut rng, attempt) {
                Ok(()) => {}
                Err(error) => {
                    failure = error;
                    break;
                }
            }
            let hash = match pixel_fingerprint(&output) {
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
            if let Err(error) = inject_exif(&output, &mut rng) {
                failure = error;
                break;
            }
            seen.insert(hash);
            let size = fs::metadata(&output)
                .map_err(|error| error.to_string())?
                .len();
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
    if output_json {
        println!(
            "{}",
            json!({ "ok": failures.is_empty(), "total": copies,
            "outputs": outputs, "failures": failures })
        );
    } else {
        println!(
            "Created {}/{} image variants in {}",
            outputs.len(),
            copies,
            output_dir.display()
        );
    }
    Ok(())
}
