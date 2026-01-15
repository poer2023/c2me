use serde::Serialize;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State, Emitter, RunEvent, WindowEvent,
};

// Bot process state
pub struct BotState {
    process: Mutex<Option<Child>>,
    start_time: Mutex<Option<std::time::Instant>>,
}

impl Default for BotState {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            start_time: Mutex::new(None),
        }
    }
}

#[derive(Clone, Serialize)]
pub struct BotStatus {
    is_running: bool,
    uptime_seconds: u64,
    pid: Option<u32>,
}

#[derive(Clone, Serialize)]
pub struct LogEntry {
    level: String,
    message: String,
    timestamp: String,
}

// Commands

#[tauri::command]
fn get_bot_status(state: State<BotState>) -> BotStatus {
    let process = state.process.lock().unwrap();
    let start_time = state.start_time.lock().unwrap();

    let is_running = process.is_some();
    let uptime_seconds = if let Some(start) = *start_time {
        start.elapsed().as_secs()
    } else {
        0
    };
    let pid = process.as_ref().map(|p| p.id());

    BotStatus {
        is_running,
        uptime_seconds,
        pid,
    }
}

#[tauri::command]
fn start_bot(state: State<BotState>, project_path: String) -> Result<String, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    if process_guard.is_some() {
        return Err("Bot is already running".to_string());
    }

    let child = Command::new("pnpm")
        .args(["run", "dev"])
        .current_dir(&project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start bot: {}", e))?;

    let pid = child.id();
    *process_guard = Some(child);

    let mut start_time = state.start_time.lock().map_err(|e| e.to_string())?;
    *start_time = Some(std::time::Instant::now());

    Ok(format!("Bot started with PID: {}", pid))
}

#[tauri::command]
fn stop_bot(state: State<BotState>) -> Result<String, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = process_guard.take() {
        child.kill().map_err(|e| format!("Failed to stop bot: {}", e))?;

        let mut start_time = state.start_time.lock().map_err(|e| e.to_string())?;
        *start_time = None;

        Ok("Bot stopped successfully".to_string())
    } else {
        Err("Bot is not running".to_string())
    }
}

#[tauri::command]
fn get_project_path() -> String {
    // Hardcoded path to the chatcode project
    "/Users/hao/project/chatcode".to_string()
}

#[tauri::command]
fn load_config(project_path: String) -> Result<std::collections::HashMap<String, String>, String> {
    let env_path = format!("{}/.env", project_path);
    let content = std::fs::read_to_string(&env_path)
        .map_err(|e| format!("Failed to read .env file: {}", e))?;

    let mut config = std::collections::HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            config.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    Ok(config)
}

#[tauri::command]
fn save_config(
    project_path: String,
    config: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let env_path = format!("{}/.env", project_path);
    let content: String = config
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("\n");

    std::fs::write(&env_path, content).map_err(|e| format!("Failed to write .env file: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, show the dashboard window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(BotState::default())
        .setup(|app| {
            // Start as accessory app (menu bar only, no dock icon)
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            // Create tray menu items
            let start_i = MenuItem::with_id(app, "start", "▶️ Start Bot", true, None::<&str>)?;
            let stop_i = MenuItem::with_id(app, "stop", "⏹️ Stop Bot", true, None::<&str>)?;
            let dashboard_i = MenuItem::with_id(app, "dashboard", "📊 Open Dashboard", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "❌ Quit ChatCode", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&start_i, &stop_i, &dashboard_i, &quit_i])?;

            // Create tray icon with icon from resources
            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("ChatCode Bot")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "dashboard" => {
                        #[cfg(target_os = "macos")]
                        {
                            app.set_activation_policy(tauri::ActivationPolicy::Regular);
                        }
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "start" => {
                        let state: State<BotState> = app.state();
                        let project_path = get_project_path();
                        match start_bot(state, project_path) {
                            Ok(msg) => { let _ = app.emit("bot-status", msg); }
                            Err(e) => { let _ = app.emit("bot-error", e); }
                        }
                    }
                    "stop" => {
                        let state: State<BotState> = app.state();
                        match stop_bot(state) {
                            Ok(msg) => { let _ = app.emit("bot-status", msg); }
                            Err(e) => { let _ = app.emit("bot-error", e); }
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Store tray reference to prevent it from being dropped
            app.manage(tray);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bot_status,
            start_bot,
            stop_bot,
            get_project_path,
            load_config,
            save_config
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. } => {
                    if label == "main" {
                        // Prevent window from closing, just hide it
                        api.prevent_close();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                        // Switch back to accessory mode (hide from dock)
                        #[cfg(target_os = "macos")]
                        {
                            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                        }
                    }
                }
                _ => {}
            }
        });
}
