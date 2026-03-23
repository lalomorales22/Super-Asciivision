use std::path::{Path, PathBuf};

use chrono::Utc;
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::types::{EditorOverlayClip, EditorTimelineClip, ExportEditorTimelineRequest, MediaAsset};

const EXPORT_WIDTH: &str = "1280";
const EXPORT_HEIGHT: &str = "720";
const EXPORT_FPS: &str = "30";

pub async fn export_timeline(
    request: &ExportEditorTimelineRequest,
    output_dir: &Path,
) -> AppResult<MediaAsset> {
    if request.clips.is_empty() {
        return Err(AppError::message(
            "Add at least one image, video, or audio clip before exporting.",
        ));
    }

    std::fs::create_dir_all(output_dir)?;
    let ffmpeg = resolve_ffmpeg_binary();
    let working_dir = output_dir.join(format!("editor-job-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&working_dir)?;

    let result = export_timeline_inner(&ffmpeg, request, output_dir, &working_dir).await;
    let _ = std::fs::remove_dir_all(&working_dir);
    result
}

async fn export_timeline_inner(
    ffmpeg: &Path,
    request: &ExportEditorTimelineRequest,
    output_dir: &Path,
    working_dir: &Path,
) -> AppResult<MediaAsset> {
    let mut visual_segments = Vec::new();
    let mut audio_segments = Vec::new();

    for (index, clip) in request.clips.iter().enumerate() {
        let source = Path::new(&clip.file_path);
        if !source.exists() {
            return Err(AppError::message(format!(
                "Clip source is missing: {}",
                clip.file_path
            )));
        }

        match clip.kind.as_str() {
            "image" => {
                let segment = working_dir.join(format!("visual_{index:03}.mp4"));
                build_image_segment(ffmpeg, clip, &segment).await?;
                visual_segments.push(segment);
            }
            "video" => {
                let segment = working_dir.join(format!("visual_{index:03}.mp4"));
                build_video_segment(ffmpeg, clip, &segment).await?;
                visual_segments.push(segment);
            }
            "audio" => {
                let segment = working_dir.join(format!("audio_{index:03}.m4a"));
                build_audio_segment(ffmpeg, clip, &segment).await?;
                audio_segments.push(segment);
            }
            _ => {
                return Err(AppError::message(format!(
                    "Unsupported editor clip kind: {}",
                    clip.kind
                )));
            }
        }
    }

    let visual_timeline = if visual_segments.is_empty() {
        None
    } else if visual_segments.len() == 1 {
        Some(visual_segments[0].clone())
    } else {
        let concat_list = working_dir.join("visual_concat.txt");
        write_concat_manifest(&concat_list, &visual_segments)?;
        let output = working_dir.join("visual_timeline.mp4");
        run_ffmpeg(
            ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "concat".into(),
                "-safe".into(),
                "0".into(),
                "-i".into(),
                concat_list.to_string_lossy().to_string(),
                "-an".into(),
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "veryfast".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                output.to_string_lossy().to_string(),
            ],
        )
        .await?;
        Some(output)
    };

    let audio_timeline = if audio_segments.is_empty() {
        None
    } else if audio_segments.len() == 1 {
        Some(audio_segments[0].clone())
    } else {
        let concat_list = working_dir.join("audio_concat.txt");
        write_concat_manifest(&concat_list, &audio_segments)?;
        let output = working_dir.join("audio_timeline.m4a");
        run_ffmpeg(
            ffmpeg,
            &[
                "-y".into(),
                "-f".into(),
                "concat".into(),
                "-safe".into(),
                "0".into(),
                "-i".into(),
                concat_list.to_string_lossy().to_string(),
                "-vn".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "192k".into(),
                output.to_string_lossy().to_string(),
            ],
        )
        .await?;
        Some(output)
    };

    // Composite overlays onto the visual timeline
    let visual_timeline = if let Some(ref base_video) = visual_timeline {
        let overlays = request.overlays.as_deref().unwrap_or(&[]);
        if overlays.is_empty() {
            visual_timeline
        } else {
            let composited = working_dir.join("visual_with_overlays.mp4");
            composite_overlays(ffmpeg, base_video, overlays, &composited).await?;
            Some(composited)
        }
    } else {
        None
    };

    if visual_timeline.is_none() && audio_timeline.is_none() {
        return Err(AppError::message(
            "Nothing was available to export from the editor timeline.",
        ));
    }

    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Editor Export");
    let output_path = output_dir.join(format!(
        "{}-{}.mp4",
        sanitize_file_name(title),
        uuid::Uuid::new_v4()
    ));

    match (visual_timeline.as_ref(), audio_timeline.as_ref()) {
        (Some(video), Some(audio)) => {
            run_ffmpeg(
                ffmpeg,
                &[
                    "-y".into(),
                    "-i".into(),
                    video.to_string_lossy().to_string(),
                    "-i".into(),
                    audio.to_string_lossy().to_string(),
                    "-map".into(),
                    "0:v:0".into(),
                    "-map".into(),
                    "1:a:0".into(),
                    "-c:v".into(),
                    "copy".into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "192k".into(),
                    "-shortest".into(),
                    output_path.to_string_lossy().to_string(),
                ],
            )
            .await?;
        }
        (Some(video), None) => {
            std::fs::copy(video, &output_path)?;
        }
        (None, Some(audio)) => {
            run_ffmpeg(
                ffmpeg,
                &[
                    "-y".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    format!(
                        "color=c=black:s={}x{}:r={}",
                        EXPORT_WIDTH, EXPORT_HEIGHT, EXPORT_FPS
                    ),
                    "-i".into(),
                    audio.to_string_lossy().to_string(),
                    "-c:v".into(),
                    "libx264".into(),
                    "-preset".into(),
                    "veryfast".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-c:a".into(),
                    "aac".into(),
                    "-b:a".into(),
                    "192k".into(),
                    "-shortest".into(),
                    output_path.to_string_lossy().to_string(),
                ],
            )
            .await?;
        }
        (None, None) => unreachable!(),
    }

    let now = Utc::now().to_rfc3339();
    Ok(MediaAsset {
        id: uuid::Uuid::new_v4().to_string(),
        category_id: request.category_id.clone(),
        kind: "video".into(),
        model_id: "editor-export".into(),
        prompt: title.to_string(),
        file_path: output_path.to_string_lossy().to_string(),
        source_url: None,
        mime_type: Some("video/mp4".into()),
        status: "completed".into(),
        request_id: None,
        metadata_json: Some(serde_json::to_string(request)?),
        created_at: now.clone(),
        updated_at: now,
    })
}

async fn composite_overlays(
    ffmpeg: &Path,
    base_video: &Path,
    overlays: &[EditorOverlayClip],
    output: &Path,
) -> AppResult<()> {
    if overlays.is_empty() {
        std::fs::copy(base_video, output)?;
        return Ok(());
    }

    // Build FFmpeg command with multiple overlay inputs and a complex filter graph
    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), base_video.to_string_lossy().to_string()];

    // Add each overlay image as an input
    for overlay in overlays {
        args.extend(["-i".into(), overlay.file_path.clone()]);
    }

    // Build complex filter graph
    // Each overlay is scaled to width% of video, positioned at x%,y%, shown between start and end
    let mut filter_parts = Vec::new();
    let mut prev_label = "[0:v]".to_string();

    for (i, overlay) in overlays.iter().enumerate() {
        let input_idx = i + 1;
        let out_label = format!("[ov{i}]");
        // Scale overlay to target width (percentage of 1280)
        let target_w = ((overlay.width / 100.0) * 1280.0).round() as i64;
        let scale_label = format!("[s{i}]");
        filter_parts.push(format!(
            "[{input_idx}:v]scale={target_w}:-1{scale_label}"
        ));
        // Position: x% and y% of video, offset by half the overlay size for centering
        let x_expr = format!("(W*{}/100)-(w/2)", overlay.x);
        let y_expr = format!("(H*{}/100)-(h/2)", overlay.y);
        filter_parts.push(format!(
            "{prev_label}{scale_label}overlay={x_expr}:{y_expr}:enable='between(t,{},{})'{out_label}",
            overlay.start, overlay.end,
        ));
        prev_label = out_label;
    }

    let filter_graph = filter_parts.join(";");
    args.extend([
        "-filter_complex".into(),
        filter_graph,
        "-map".into(),
        format!("{prev_label}"),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-an".into(),
        output.to_string_lossy().to_string(),
    ]);

    run_ffmpeg(ffmpeg, &args).await
}

async fn build_image_segment(
    ffmpeg: &Path,
    clip: &EditorTimelineClip,
    output: &Path,
) -> AppResult<()> {
    let duration = clip.still_duration.unwrap_or(3.0);
    if duration <= 0.0 {
        return Err(AppError::message(
            "Image clip duration must be greater than zero.",
        ));
    }

    run_ffmpeg(
        ffmpeg,
        &[
            "-y".into(),
            "-loop".into(),
            "1".into(),
            "-t".into(),
            format_seconds(duration),
            "-i".into(),
            clip.file_path.clone(),
            "-vf".into(),
            video_filter().into(),
            "-an".into(),
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            output.to_string_lossy().to_string(),
        ],
    )
    .await
}

async fn build_video_segment(
    ffmpeg: &Path,
    clip: &EditorTimelineClip,
    output: &Path,
) -> AppResult<()> {
    let mut args = vec!["-y".into()];
    append_time_window(&mut args, clip)?;
    args.extend([
        "-i".into(),
        clip.file_path.clone(),
        "-vf".into(),
        video_filter().into(),
        "-an".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        output.to_string_lossy().to_string(),
    ]);
    run_ffmpeg(ffmpeg, &args).await
}

async fn build_audio_segment(
    ffmpeg: &Path,
    clip: &EditorTimelineClip,
    output: &Path,
) -> AppResult<()> {
    let mut args = vec!["-y".into()];
    append_time_window(&mut args, clip)?;
    args.extend([
        "-i".into(),
        clip.file_path.clone(),
        "-vn".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-ar".into(),
        "48000".into(),
        "-ac".into(),
        "2".into(),
        output.to_string_lossy().to_string(),
    ]);
    run_ffmpeg(ffmpeg, &args).await
}

fn append_time_window(args: &mut Vec<String>, clip: &EditorTimelineClip) -> AppResult<()> {
    let start = clip.trim_start.unwrap_or(0.0);
    let end = clip.trim_end.unwrap_or(0.0);
    if start < 0.0 {
        return Err(AppError::message("Trim start must be zero or greater."));
    }
    if start > 0.0 {
        args.push("-ss".into());
        args.push(format_seconds(start));
    }
    if clip.trim_end.is_some() {
        if end <= start {
            return Err(AppError::message(
                "Trim end must be greater than trim start.",
            ));
        }
        args.push("-t".into());
        args.push(format_seconds(end - start));
    }
    Ok(())
}

fn write_concat_manifest(path: &Path, segments: &[PathBuf]) -> AppResult<()> {
    let mut contents = String::new();
    for segment in segments {
        let escaped = segment.to_string_lossy().replace('\'', "'\\''");
        contents.push_str(&format!("file '{}'\n", escaped));
    }
    std::fs::write(path, contents)?;
    Ok(())
}

fn sanitize_file_name(input: &str) -> String {
    let normalized = input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let compact = normalized
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if compact.is_empty() {
        "editor-export".into()
    } else {
        compact
    }
}

fn video_filter() -> &'static str {
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p"
}

fn format_seconds(value: f64) -> String {
    format!("{value:.3}")
}

fn resolve_ffmpeg_binary() -> PathBuf {
    for candidate in [
        std::env::var_os("FFMPEG_BIN").map(PathBuf::from),
        Some(PathBuf::from("/opt/homebrew/bin/ffmpeg")),
        Some(PathBuf::from("/usr/local/bin/ffmpeg")),
        Some(PathBuf::from("/usr/bin/ffmpeg")),
        Some(PathBuf::from("ffmpeg")),
    ]
    .into_iter()
    .flatten()
    {
        if candidate.as_os_str() == "ffmpeg" || candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("ffmpeg")
}

async fn run_ffmpeg(ffmpeg: &Path, args: &[String]) -> AppResult<()> {
    let output = Command::new(ffmpeg).args(args).output().await?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let message = if stderr.is_empty() {
        format!("ffmpeg failed with status {}", output.status)
    } else {
        stderr
    };
    Err(AppError::message(message))
}

/// Extract audio from a video file into a standalone audio asset.
pub async fn extract_audio(
    source_path: &str,
    output_dir: &Path,
) -> AppResult<MediaAsset> {
    std::fs::create_dir_all(output_dir)?;
    let ffmpeg = resolve_ffmpeg_binary();
    let output_path = output_dir.join(format!("{}.m4a", uuid::Uuid::new_v4()));
    let args: Vec<String> = vec![
        "-y".into(),
        "-i".into(),
        source_path.to_string(),
        "-vn".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-ar".into(),
        "48000".into(),
        "-ac".into(),
        "2".into(),
        output_path.to_string_lossy().to_string(),
    ];
    run_ffmpeg(&ffmpeg, &args).await?;

    let now = Utc::now().to_rfc3339();
    Ok(MediaAsset {
        id: uuid::Uuid::new_v4().to_string(),
        category_id: None,
        kind: "audio".into(),
        model_id: "extracted".into(),
        prompt: format!("Audio extracted from {}", Path::new(source_path).file_name().unwrap_or_default().to_string_lossy()),
        file_path: output_path.to_string_lossy().to_string(),
        source_url: None,
        mime_type: Some("audio/mp4".into()),
        status: "completed".into(),
        request_id: None,
        metadata_json: None,
        created_at: now.clone(),
        updated_at: now,
    })
}
