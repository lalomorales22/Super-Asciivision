use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};
use crate::types::{WorkspaceItem, WorkspaceScanSummary};

const MAX_FILES: usize = 2000;
const MAX_FILE_BYTES: u64 = 1_000_000;
const CHUNK_BYTES: usize = 1800;

const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "jsonc", "yaml", "yml", "toml", "rs", "ts", "tsx", "js",
    "jsx", "mjs", "cjs", "py", "go", "sh", "zsh", "bash", "sql", "css", "scss", "html", "htm",
    "xml", "java", "kt", "swift", "c", "cc", "cpp", "h", "hpp", "cs", "rb",
];

#[derive(Debug, Clone)]
pub struct IndexedWorkspaceItem {
    pub path: String,
    pub mime_hint: Option<String>,
    pub language_hint: Option<String>,
    pub byte_size: u64,
    pub chunk_count: usize,
    pub text_content: Option<String>,
}

pub fn scan_workspace(
    workspace_id: &str,
    roots: &[String],
) -> AppResult<(WorkspaceScanSummary, Vec<WorkspaceItem>)> {
    let mut scanned_files = 0usize;
    let mut indexed_items = Vec::new();
    let mut skipped_files = 0usize;
    let mut total_bytes = 0u64;
    let timestamp = Utc::now().to_rfc3339();

    for root in roots {
        let root_path = PathBuf::from(root);
        if root_path.is_file() {
            match index_candidate(&root_path) {
                Ok(item) => {
                    scanned_files += 1;
                    total_bytes += item.byte_size;
                    indexed_items.push(to_workspace_item(workspace_id, &timestamp, item));
                }
                Err(_) => skipped_files += 1,
            }
            continue;
        }

        for entry in WalkDir::new(&root_path)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !is_ignored(entry.path()))
        {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    skipped_files += 1;
                    continue;
                }
            };
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if indexed_items.len() >= MAX_FILES {
                break;
            }
            scanned_files += 1;
            match index_candidate(path) {
                Ok(item) => {
                    total_bytes += item.byte_size;
                    indexed_items.push(to_workspace_item(workspace_id, &timestamp, item));
                }
                Err(_) => skipped_files += 1,
            }
        }
    }

    let summary = WorkspaceScanSummary {
        workspace_id: workspace_id.to_string(),
        scanned_files,
        indexed_items: indexed_items.len(),
        skipped_files,
        total_bytes,
    };

    Ok((summary, indexed_items))
}

pub fn build_context_prompt(items: &[WorkspaceItem]) -> AppResult<String> {
    let total_bytes: u64 = items
        .iter()
        .filter(|item| item.text_content.is_some())
        .map(|item| item.byte_size)
        .sum();
    if total_bytes > 2_000_000 {
        return Err(AppError::message(
            "Selected workspace context exceeds the 2 MB send limit.",
        ));
    }

    let mut sections = Vec::new();
    for item in items {
        if let Some(text) = &item.text_content {
            sections.push(format!(
                "<workspace-file path=\"{}\">\n{}\n</workspace-file>",
                item.path, text
            ));
        }
    }

    Ok(sections.join("\n\n"))
}

pub fn create_workspace_text_file(path: &str, content: &str) -> AppResult<()> {
    let target = PathBuf::from(path);
    let parent = target
        .parent()
        .ok_or_else(|| AppError::message("Unable to create a file at that location."))?;
    if !parent.is_dir() {
        return Err(AppError::message("The target folder does not exist."));
    }
    if target.exists() {
        return Err(AppError::message("A file already exists with that name."));
    }

    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(target)?;
    file.write_all(content.as_bytes())?;
    Ok(())
}

pub fn rename_workspace_path(path: &str, new_name: &str) -> AppResult<()> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err(AppError::message("A new name is required."));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::message("Use a name only, not a full path."));
    }

    let current = PathBuf::from(path);
    if !current.exists() {
        return Err(AppError::message("The selected path no longer exists."));
    }

    let parent = current
        .parent()
        .ok_or_else(|| AppError::message("Unable to rename the selected path."))?;
    let target = parent.join(trimmed);
    if target.exists() {
        return Err(AppError::message(
            "A file or folder with that name already exists.",
        ));
    }

    fs::rename(current, target)?;
    Ok(())
}

pub fn delete_workspace_path(path: &str) -> AppResult<()> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err(AppError::message("The selected path no longer exists."));
    }

    if target.is_dir() {
        fs::remove_dir_all(target)?;
    } else {
        fs::remove_file(target)?;
    }

    Ok(())
}

fn to_workspace_item(
    workspace_id: &str,
    timestamp: &str,
    item: IndexedWorkspaceItem,
) -> WorkspaceItem {
    WorkspaceItem {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: workspace_id.to_string(),
        path: item.path,
        mime_hint: item.mime_hint,
        language_hint: item.language_hint,
        byte_size: item.byte_size,
        chunk_count: item.chunk_count,
        last_indexed_at: timestamp.to_string(),
        text_content: item.text_content,
    }
}

fn index_candidate(path: &Path) -> AppResult<IndexedWorkspaceItem> {
    let metadata = fs::metadata(path)?;
    let mut text_content = None;
    let mut chunk_count = 0usize;

    if is_supported_text_file(path) && metadata.len() <= MAX_FILE_BYTES {
        if let Ok(bytes) = fs::read(path) {
            if let Ok(text) = String::from_utf8(bytes) {
                chunk_count = chunk_text(&text).len();
                text_content = Some(text);
            }
        }
    }

    Ok(IndexedWorkspaceItem {
        path: path.to_string_lossy().to_string(),
        mime_hint: mime_guess::from_path(path)
            .first_raw()
            .map(ToString::to_string),
        language_hint: path
            .extension()
            .and_then(|value| value.to_str())
            .map(ToString::to_string),
        byte_size: metadata.len(),
        chunk_count,
        text_content,
    })
}

fn is_supported_text_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|extension| TEXT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_ignored(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|name| {
            matches!(
                name,
                ".git"
                    | "node_modules"
                    | "target"
                    | ".next"
                    | "dist"
                    | "__pycache__"
                    | ".venv"
                    | "venv"
                    | ".env"
                    | "env"
                    | ".tox"
                    | ".eggs"
                    | ".mypy_cache"
                    | ".pytest_cache"
                    | ".ruff_cache"
                    | "build"
                    | ".build"
                    | ".DS_Store"
                    | ".idea"
                    | ".vscode"
            )
        })
        .unwrap_or(false)
}

fn chunk_text(value: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for line in value.lines() {
        if current.len() + line.len() + 1 > CHUNK_BYTES && !current.is_empty() {
            chunks.push(current.clone());
            current.clear();
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.trim().is_empty() {
        chunks.push(current);
    }
    chunks
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{build_context_prompt, scan_workspace};

    #[test]
    fn indexes_text_and_binary_files() {
        let dir = tempdir().expect("temp dir");
        fs::write(dir.path().join("main.rs"), "fn main() {}\n").expect("write rust file");
        fs::write(dir.path().join("image.png"), [0u8, 1u8, 2u8]).expect("write binary");

        let (summary, items) =
            scan_workspace("workspace-1", &[dir.path().to_string_lossy().to_string()])
                .expect("scan workspace");

        assert_eq!(summary.indexed_items, 2);
        assert_eq!(items.len(), 2);
        assert!(items.iter().any(|item| item
            .text_content
            .as_ref()
            .is_some_and(|value| value.contains("fn main"))));
        assert!(items
            .iter()
            .any(|item| item.path.ends_with("image.png") && item.text_content.is_none()));
    }

    #[test]
    fn indexes_empty_text_files() {
        let dir = tempdir().expect("temp dir");
        let file = dir.path().join("empty.ts");
        fs::write(&file, "").expect("write empty file");

        let (summary, items) =
            scan_workspace("workspace-1", &[dir.path().to_string_lossy().to_string()])
                .expect("scan workspace");

        assert_eq!(summary.indexed_items, 1);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].path, file.to_string_lossy());
        assert_eq!(items[0].text_content.as_deref(), Some(""));
    }

    #[test]
    fn builds_structured_context_prompt() {
        let dir = tempdir().expect("temp dir");
        let file = dir.path().join("notes.md");
        fs::write(&file, "# title\nbody\n").expect("write notes");
        let (_, items) = scan_workspace("workspace-1", &[file.to_string_lossy().to_string()])
            .expect("scan file");

        let prompt = build_context_prompt(&items).expect("prompt");
        assert!(prompt.contains("<workspace-file"));
        assert!(prompt.contains("notes.md"));
    }
}
