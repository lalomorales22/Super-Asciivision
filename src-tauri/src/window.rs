use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct WindowState {
    pub hotkey: Mutex<String>,
}

pub fn configure_window(app: &mut App) -> AppResult<()> {
    build_tray(app)?;
    Ok(())
}

pub fn apply_always_on_top(app: &AppHandle, value: bool) -> AppResult<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_always_on_top(value)?;
    }
    Ok(())
}

pub fn register_hotkey(app: &AppHandle, accelerator: &str) -> AppResult<()> {
    let shortcut = parse_shortcut(accelerator)?;
    let state = app.state::<WindowState>();
    let mut stored = state
        .hotkey
        .lock()
        .map_err(|_| AppError::message("failed to lock window state"))?;
    if !stored.is_empty() {
        let previous = parse_shortcut(&stored)?;
        let _ = app.global_shortcut().unregister(previous);
    }
    let app_handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut.clone(), move |_app, _shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let _ = toggle_main_window(&app_handle);
            }
        })
        .map_err(|error| AppError::message(format!("failed to register hotkey: {error}")))?;
    *stored = accelerator.to_string();
    Ok(())
}

pub fn toggle_main_window(app: &AppHandle) -> AppResult<()> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::message("main window is missing"))?;
    if window.is_visible().unwrap_or(false) {
        hide_window(&window)?;
    } else {
        show_window(&window)?;
    }
    Ok(())
}

fn build_tray(app: &mut App) -> AppResult<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Toggle Super ASCIIVision", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &quit])?;
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                let _ = toggle_main_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = toggle_main_window(&tray.app_handle().clone());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_window(window: &WebviewWindow) -> AppResult<()> {
    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}

fn hide_window(window: &WebviewWindow) -> AppResult<()> {
    window.hide()?;
    Ok(())
}

fn parse_shortcut(value: &str) -> AppResult<Shortcut> {
    let normalized = value.to_ascii_lowercase();
    let mut modifiers = Modifiers::empty();
    let mut code = None;
    for token in normalized.split('+') {
        match token {
            "cmd" | "command" | "meta" | "commandorcontrol" => modifiers |= Modifiers::META,
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "alt" | "option" => modifiers |= Modifiers::ALT,
            "space" => code = Some(Code::Space),
            "a" => code = Some(Code::KeyA),
            "b" => code = Some(Code::KeyB),
            "c" => code = Some(Code::KeyC),
            "d" => code = Some(Code::KeyD),
            "e" => code = Some(Code::KeyE),
            "f" => code = Some(Code::KeyF),
            "g" => code = Some(Code::KeyG),
            "h" => code = Some(Code::KeyH),
            "i" => code = Some(Code::KeyI),
            "j" => code = Some(Code::KeyJ),
            "k" => code = Some(Code::KeyK),
            "l" => code = Some(Code::KeyL),
            "m" => code = Some(Code::KeyM),
            "n" => code = Some(Code::KeyN),
            "o" => code = Some(Code::KeyO),
            "p" => code = Some(Code::KeyP),
            "q" => code = Some(Code::KeyQ),
            "r" => code = Some(Code::KeyR),
            "s" => code = Some(Code::KeyS),
            "t" => code = Some(Code::KeyT),
            "u" => code = Some(Code::KeyU),
            "v" => code = Some(Code::KeyV),
            "w" => code = Some(Code::KeyW),
            "x" => code = Some(Code::KeyX),
            "y" => code = Some(Code::KeyY),
            "z" => code = Some(Code::KeyZ),
            other => {
                return Err(AppError::message(format!(
                    "Unsupported hotkey token: {other}"
                )))
            }
        }
    }
    let code = code.ok_or_else(|| AppError::message("Hotkey is missing a key"))?;
    Ok(Shortcut::new(Some(modifiers), code))
}
