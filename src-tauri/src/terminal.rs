use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::types::{TerminalEvent, TerminalHandle};

/// Maximum bytes of early PTY output to buffer per session.
/// This captures the shell prompt so it can be replayed after the frontend
/// listener registers (avoids the StrictMode timing gap).
const EARLY_BUFFER_CAP: usize = 16_384;

pub struct TerminalSession {
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub writer: Mutex<Box<dyn Write + Send>>,
    pub child: Mutex<Box<dyn portable_pty::Child + Send + Sync>>,
    /// Captures early PTY output so the frontend can replay missed data
    /// (e.g. the shell prompt emitted before the JS listener is ready).
    /// Set to None once drained to stop further buffering.
    pub early_buffer: Arc<Mutex<Option<Vec<u8>>>>,
}

pub type TerminalRegistry = Mutex<HashMap<String, Arc<TerminalSession>>>;

pub async fn ensure_terminal(
    app: AppHandle,
    registry: &TerminalRegistry,
) -> AppResult<TerminalHandle> {
    if let Some(existing) = registry
        .lock()
        .map_err(|_| AppError::message("terminal registry lock poisoned"))?
        .keys()
        .next()
        .cloned()
    {
        return Ok(TerminalHandle {
            session_id: existing,
        });
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| AppError::message(error.to_string()))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let home_dir = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let mut command = CommandBuilder::new(shell);
    command.arg("-l");
    command.arg("-i");
    command.cwd(&home_dir);
    command.env("HOME", home_dir.to_string_lossy().to_string());
    command.env("PATH", shell_path());
    command.env("TERM", "xterm-256color");
    command.env("CLICOLOR", "1");
    command.env("CLICOLOR_FORCE", "1");
    command.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| AppError::message(error.to_string()))?;
    drop(pair.slave);

    let master = pair.master;
    let reader = master
        .try_clone_reader()
        .map_err(|error| AppError::message(error.to_string()))?;
    let writer = master
        .take_writer()
        .map_err(|error| AppError::message(error.to_string()))?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let early_buffer = Arc::new(Mutex::new(Some(Vec::new())));
    let session = Arc::new(TerminalSession {
        master: Mutex::new(master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        early_buffer: Arc::clone(&early_buffer),
    });

    registry
        .lock()
        .map_err(|_| AppError::message("terminal registry lock poisoned"))?
        .insert(session_id.clone(), Arc::clone(&session));

    spawn_reader(app.clone(), session_id.clone(), reader, Some(early_buffer));
    spawn_waiter(app, session_id.clone(), Arc::clone(&session));

    Ok(TerminalHandle { session_id })
}

/// Always creates a new terminal session (used by Tiles page for multiple terminals).
pub async fn create_terminal_session(
    app: AppHandle,
    registry: &TerminalRegistry,
) -> AppResult<TerminalHandle> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| AppError::message(error.to_string()))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let home_dir = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let mut command = CommandBuilder::new(shell);
    command.arg("-l");
    command.arg("-i");
    command.cwd(&home_dir);
    command.env("HOME", home_dir.to_string_lossy().to_string());
    command.env("PATH", shell_path());
    command.env("TERM", "xterm-256color");
    command.env("CLICOLOR", "1");
    command.env("CLICOLOR_FORCE", "1");
    command.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| AppError::message(error.to_string()))?;
    drop(pair.slave);

    let master = pair.master;
    let reader = master
        .try_clone_reader()
        .map_err(|error| AppError::message(error.to_string()))?;
    let writer = master
        .take_writer()
        .map_err(|error| AppError::message(error.to_string()))?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let early_buffer = Arc::new(Mutex::new(Some(Vec::new())));
    let session = Arc::new(TerminalSession {
        master: Mutex::new(master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        early_buffer: Arc::clone(&early_buffer),
    });

    registry
        .lock()
        .map_err(|_| AppError::message("terminal registry lock poisoned"))?
        .insert(session_id.clone(), Arc::clone(&session));

    spawn_reader(app.clone(), session_id.clone(), reader, Some(early_buffer));
    spawn_waiter(app, session_id.clone(), Arc::clone(&session));

    Ok(TerminalHandle { session_id })
}

pub async fn write_input(
    registry: &TerminalRegistry,
    session_id: &str,
    input: &str,
) -> AppResult<()> {
    let session = registry
        .lock()
        .map_err(|_| AppError::message("terminal registry lock poisoned"))?
        .get(session_id)
        .cloned()
        .ok_or_else(|| AppError::message("terminal session not found"))?;

    let mut writer = session
        .writer
        .lock()
        .map_err(|_| AppError::message("terminal writer lock poisoned"))?;
    writer.write_all(input.as_bytes())?;
    writer.flush()?;
    Ok(())
}

pub async fn terminate_terminal(registry: &TerminalRegistry, session_id: &str) -> AppResult<()> {
    let session = registry
        .lock()
        .map_err(|_| AppError::message("terminal registry lock poisoned"))?
        .get(session_id)
        .cloned()
        .ok_or_else(|| AppError::message("terminal session not found"))?;

    let mut child = session
        .child
        .lock()
        .map_err(|_| AppError::message("terminal child lock poisoned"))?;
    child.kill()?;
    Ok(())
}

pub async fn resize_terminal(
    registry: &TerminalRegistry,
    session_id: &str,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    let session = registry
        .lock()
        .map_err(|_| AppError::message("terminal registry lock poisoned"))?
        .get(session_id)
        .cloned()
        .ok_or_else(|| AppError::message("terminal session not found"))?;

    let master = session
        .master
        .lock()
        .map_err(|_| AppError::message("terminal master lock poisoned"))?;
    master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| AppError::message(error.to_string()))
}

fn spawn_reader(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    early_buf: Option<Arc<Mutex<Option<Vec<u8>>>>>,
) {
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    // While the early buffer is active (Some), capture output there
                    // and skip emitting events — the frontend will replay the buffer
                    // once its listener registers via drain_early_buffer.
                    // After drain (buffer set to None), emit events normally.
                    let mut buffered = false;
                    if let Some(ref eb) = early_buf {
                        if let Ok(mut guard) = eb.lock() {
                            if let Some(ref mut buf) = *guard {
                                if buf.len() < EARLY_BUFFER_CAP {
                                    let remaining = EARLY_BUFFER_CAP - buf.len();
                                    let take = read.min(remaining);
                                    buf.extend_from_slice(&buffer[..take]);
                                }
                                buffered = true;
                            }
                        }
                    }

                    if !buffered {
                        let chunk = String::from_utf8_lossy(&buffer[..read]).to_string();
                        let _ = app.emit(
                            "terminal://event",
                            TerminalEvent {
                                session_id: session_id.clone(),
                                kind: "output".to_string(),
                                chunk: Some(chunk),
                                stream: Some("stdout".to_string()),
                                exit_code: None,
                            },
                        );
                    }
                }
                Err(error) => {
                    let _ = app.emit(
                        "terminal://event",
                        TerminalEvent {
                            session_id: session_id.clone(),
                            kind: "output".to_string(),
                            chunk: Some(format!("\n[terminal read error: {error}]\n")),
                            stream: Some("stderr".to_string()),
                            exit_code: None,
                        },
                    );
                    break;
                }
            }
        }
    });
}

/// Returns and clears the early output buffer for a session.
/// Called by the frontend after its event listener is ready so it can replay
/// any PTY output (e.g. the shell prompt) that was emitted before the listener
/// registered.
pub async fn drain_early_buffer(
    registry: &TerminalRegistry,
    session_id: &str,
) -> AppResult<String> {
    let session = registry
        .lock()
        .map_err(|_| AppError::message("terminal registry lock poisoned"))?
        .get(session_id)
        .cloned()
        .ok_or_else(|| AppError::message("terminal session not found"))?;

    let bytes = {
        let mut guard = session
            .early_buffer
            .lock()
            .map_err(|_| AppError::message("early buffer lock poisoned"))?;
        // Take the buffer contents and set to None to stop further buffering
        guard.take().unwrap_or_default()
    };
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn spawn_waiter(app: AppHandle, session_id: String, session: Arc<TerminalSession>) {
    thread::spawn(move || {
        let exit_code = {
            let mut child = match session.child.lock() {
                Ok(child) => child,
                Err(_) => return,
            };
            match child.wait() {
                Ok(status) => Some(status.exit_code() as i32),
                Err(_) => None,
            }
        };

        let _ = app.emit(
            "terminal://event",
            TerminalEvent {
                session_id: session_id.clone(),
                kind: "exit".to_string(),
                chunk: None,
                stream: None,
                exit_code,
            },
        );
    });
}

/// Creates a terminal session that runs the asciivision binary instead of a shell.
pub async fn create_asciivision_session(
    app: AppHandle,
    registry: &TerminalRegistry,
    binary_path: String,
) -> AppResult<TerminalHandle> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 50,
            cols: 160,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| AppError::message(error.to_string()))?;

    let mut command = CommandBuilder::new(&binary_path);
    // Set CWD so the asciivision binary can find demo-videos/demo.mp4.
    // Search several candidate roots:
    //   1. Next to the binary itself (bundled app)
    //   2. Two levels up from the binary (asciivision-core/target/release/ → asciivision-core/)
    //   3. CARGO_MANIFEST_DIR/../asciivision-core/ (dev mode, binary copied to src-tauri/target/)
    let binary_dir = std::path::Path::new(&binary_path)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    let manifest_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_root.parent().unwrap_or(std::path::Path::new("."));

    let mut cwd_candidates: Vec<std::path::PathBuf> = vec![
        binary_dir.to_path_buf(),
    ];
    // asciivision-core/target/{release,debug}/ → asciivision-core/
    if let Some(grandparent) = binary_dir.parent().and_then(|p| p.parent()) {
        cwd_candidates.push(grandparent.to_path_buf());
    }
    // Dev mode: project_root/asciivision-core/
    cwd_candidates.push(project_root.join("asciivision-core"));
    // Runtime CWD fallback (survives folder renames)
    if let Ok(cwd) = std::env::current_dir() {
        cwd_candidates.push(cwd.join("asciivision-core"));
    }

    let asciivision_root = cwd_candidates
        .into_iter()
        .find(|p| p.join("demo-videos").exists())
        .unwrap_or_else(|| binary_dir.to_path_buf());
    command.cwd(&asciivision_root);
    let home_dir = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    command.env("HOME", home_dir.to_string_lossy().to_string());
    command.env("PATH", shell_path());
    command.env("TERM", "xterm-256color");
    command.env("CLICOLOR", "1");
    command.env("CLICOLOR_FORCE", "1");
    command.env("COLORTERM", "truecolor");
    command.env("LANG", "en_US.UTF-8");
    command.env("LC_ALL", "en_US.UTF-8");

    // Load API keys: first try .env in the asciivision root, then env vars from parent
    let env_file = asciivision_root.join(".env");
    let mut env_overrides = std::collections::HashMap::new();
    if env_file.exists() {
        if let Ok(contents) = std::fs::read_to_string(&env_file) {
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((key, val)) = line.split_once('=') {
                    let val = val.trim().trim_matches('"').trim_matches('\'');
                    if !val.is_empty() {
                        env_overrides.insert(key.trim().to_string(), val.to_string());
                    }
                }
            }
        }
    }
    for key in &[
        "CLAUDE_API_KEY",
        "GROK_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
    ] {
        if let Some(val) = env_overrides.get(*key) {
            command.env(key, val);
        } else if let Ok(val) = std::env::var(key) {
            command.env(key, val);
        }
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| AppError::message(format!("Failed to launch asciivision: {error}")))?;
    drop(pair.slave);

    let master = pair.master;
    let reader = master
        .try_clone_reader()
        .map_err(|error| AppError::message(error.to_string()))?;
    let writer = master
        .take_writer()
        .map_err(|error| AppError::message(error.to_string()))?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let session = Arc::new(TerminalSession {
        master: Mutex::new(master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        early_buffer: Arc::new(Mutex::new(None)),
    });

    registry
        .lock()
        .map_err(|_| AppError::message("terminal registry lock poisoned"))?
        .insert(session_id.clone(), Arc::clone(&session));

    // ASCIIVision sessions don't need early output buffering
    spawn_reader(app.clone(), session_id.clone(), reader, None);
    spawn_waiter(app, session_id.clone(), Arc::clone(&session));

    Ok(TerminalHandle { session_id })
}

fn shell_path() -> String {
    let mut ordered = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/local/sbin"),
        PathBuf::from("/opt/local/bin"),
        PathBuf::from("/opt/local/sbin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
        PathBuf::from("/usr/sbin"),
        PathBuf::from("/sbin"),
    ];

    if let Some(existing) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&existing) {
            if !ordered.iter().any(|candidate| candidate == &path) {
                ordered.push(path);
            }
        }
    }

    std::env::join_paths(ordered)
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}
