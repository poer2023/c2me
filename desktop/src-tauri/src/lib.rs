use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
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

#[derive(Clone, Serialize)]
pub struct BotHealth {
    is_running: bool,
    is_responsive: bool,
    uptime_seconds: u64,
    pid: Option<u32>,
    memory_mb: Option<f64>,
}

// Internal function to stop bot (used by restart)
fn stop_bot_internal(state: &BotState) -> Result<String, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = process_guard.take() {
        // Try graceful shutdown first (SIGTERM equivalent)
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let _ = Command::new("kill")
                .args(["-TERM", &child.id().to_string()])
                .spawn();
        }

        // Wait a bit for graceful shutdown
        thread::sleep(Duration::from_millis(500));

        // Force kill if still running
        let _ = child.kill();
        let _ = child.wait();

        let mut start_time = state.start_time.lock().map_err(|e| e.to_string())?;
        *start_time = None;

        Ok("Bot stopped successfully".to_string())
    } else {
        Err("Bot is not running".to_string())
    }
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

// Internal function for starting bot (used by both command and tray menu)
fn start_bot_internal(
    app: AppHandle,
    state: &BotState,
    project_path: String,
) -> Result<String, String> {
    let mut process_guard = state.process.lock().map_err(|e| e.to_string())?;

    if process_guard.is_some() {
        return Err("Bot is already running".to_string());
    }

    let mut child = Command::new("pnpm")
        .args(["run", "dev"])
        .current_dir(&project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start bot: {}", e))?;

    let pid = child.id();

    // Capture stdout and stream to frontend
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let log = LogEntry {
                        level: "info".to_string(),
                        message: line,
                        timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                    };
                    let _ = app_clone.emit("bot-log", log);
                }
            }
        });
    }

    // Capture stderr and stream to frontend
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    let log = LogEntry {
                        level: "error".to_string(),
                        message: line,
                        timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                    };
                    let _ = app_clone.emit("bot-log", log);
                }
            }
        });
    }

    *process_guard = Some(child);

    let mut start_time = state.start_time.lock().map_err(|e| e.to_string())?;
    *start_time = Some(std::time::Instant::now());

    Ok(format!("Bot started with PID: {}", pid))
}

#[tauri::command]
fn start_bot(
    app: AppHandle,
    state: State<BotState>,
    project_path: String,
) -> Result<String, String> {
    start_bot_internal(app, &state, project_path)
}

#[tauri::command]
fn stop_bot(state: State<BotState>) -> Result<String, String> {
    stop_bot_internal(&state)
}

#[tauri::command]
fn restart_bot(
    app: AppHandle,
    state: State<BotState>,
    project_path: String,
) -> Result<String, String> {
    // Stop if running
    let _ = stop_bot_internal(&state);

    // Wait a moment
    thread::sleep(Duration::from_millis(300));

    // Start again
    start_bot_internal(app, &state, project_path)
}

#[tauri::command]
fn get_bot_health(state: State<BotState>) -> BotHealth {
    let process = state.process.lock().unwrap();
    let start_time = state.start_time.lock().unwrap();

    let is_running = process.is_some();
    let pid = process.as_ref().map(|p| p.id());

    let uptime_seconds = if let Some(start) = *start_time {
        start.elapsed().as_secs()
    } else {
        0
    };

    // Get memory usage on macOS/Linux
    let memory_mb = pid.and_then(|p| {
        #[cfg(unix)]
        {
            let output = Command::new("ps")
                .args(["-o", "rss=", "-p", &p.to_string()])
                .output()
                .ok()?;
            let rss_kb: f64 = String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse()
                .ok()?;
            Some(rss_kb / 1024.0)
        }
        #[cfg(not(unix))]
        {
            None
        }
    });

    // Check if process is responsive (exists and not zombie)
    let is_responsive = pid.map_or(false, |p| {
        #[cfg(unix)]
        {
            Command::new("kill")
                .args(["-0", &p.to_string()])
                .output()
                .map_or(false, |o| o.status.success())
        }
        #[cfg(not(unix))]
        {
            true
        }
    });

    BotHealth {
        is_running,
        is_responsive,
        uptime_seconds,
        pid,
        memory_mb,
    }
}

#[tauri::command]
fn get_project_path() -> String {
    // Path to the chatcode project
    "/Users/wanghao/Project/c2me".to_string()
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
            let restart_i = MenuItem::with_id(app, "restart", "🔄 Restart Bot", true, None::<&str>)?;
            let dashboard_i = MenuItem::with_id(app, "dashboard", "📊 Open Dashboard", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "❌ Quit ChatCode", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&start_i, &stop_i, &restart_i, &dashboard_i, &quit_i])?;

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
                        match start_bot_internal(app.clone(), &state, project_path) {
                            Ok(msg) => { let _ = app.emit("bot-status", msg); }
                            Err(e) => { let _ = app.emit("bot-error", e); }
                        }
                    }
                    "stop" => {
                        let state: State<BotState> = app.state();
                        match stop_bot_internal(&state) {
                            Ok(msg) => { let _ = app.emit("bot-status", msg); }
                            Err(e) => { let _ = app.emit("bot-error", e); }
                        }
                    }
                    "restart" => {
                        let state: State<BotState> = app.state();
                        let project_path = get_project_path();
                        // Stop first
                        let _ = stop_bot_internal(&state);
                        thread::sleep(Duration::from_millis(300));
                        // Start again
                        match start_bot_internal(app.clone(), &state, project_path) {
                            Ok(msg) => { let _ = app.emit("bot-status", msg); }
                            Err(e) => { let _ = app.emit("bot-error", e); }
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Store tray reference to prevent it from being dropped
            app.manage(tray);

            // Create native macOS menu bar
            #[cfg(target_os = "macos")]
            {
                // App menu
                let about = MenuItem::with_id(app, "about", "About ChatCode", true, None::<&str>)?;
                let settings = MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?;
                let app_menu = SubmenuBuilder::new(app, "ChatCode")
                    .item(&about)
                    .separator()
                    .item(&settings)
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;

                // Bot menu
                let menu_start = MenuItem::with_id(app, "menu_start", "Start Bot", true, Some("CmdOrCtrl+R"))?;
                let menu_stop = MenuItem::with_id(app, "menu_stop", "Stop Bot", true, Some("CmdOrCtrl+."))?;
                let menu_restart = MenuItem::with_id(app, "menu_restart", "Restart Bot", true, Some("CmdOrCtrl+Shift+R"))?;
                let menu_logs = MenuItem::with_id(app, "menu_logs", "View Logs", true, Some("CmdOrCtrl+L"))?;
                let bot_menu = SubmenuBuilder::new(app, "Bot")
                    .item(&menu_start)
                    .item(&menu_stop)
                    .item(&menu_restart)
                    .separator()
                    .item(&menu_logs)
                    .build()?;

                // Window menu
                let window_menu = SubmenuBuilder::new(app, "Window")
                    .minimize()
                    .separator()
                    .close_window()
                    .build()?;

                // Build and set the menu
                let native_menu = MenuBuilder::new(app)
                    .item(&app_menu)
                    .item(&bot_menu)
                    .item(&window_menu)
                    .build()?;

                app.set_menu(native_menu)?;

                // Handle native menu events
                app.on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "about" => {
                            // Show about dialog or window
                            let _ = app.emit("show-about", ());
                        }
                        "settings" => {
                            // Switch to config tab
                            let _ = app.emit("show-settings", ());
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "menu_start" => {
                            let state: State<BotState> = app.state();
                            let project_path = get_project_path();
                            match start_bot_internal(app.clone(), &state, project_path) {
                                Ok(msg) => { let _ = app.emit("bot-status", msg); }
                                Err(e) => { let _ = app.emit("bot-error", e); }
                            }
                        }
                        "menu_stop" => {
                            let state: State<BotState> = app.state();
                            match stop_bot_internal(&state) {
                                Ok(msg) => { let _ = app.emit("bot-status", msg); }
                                Err(e) => { let _ = app.emit("bot-error", e); }
                            }
                        }
                        "menu_restart" => {
                            let state: State<BotState> = app.state();
                            let project_path = get_project_path();
                            let _ = stop_bot_internal(&state);
                            thread::sleep(Duration::from_millis(300));
                            match start_bot_internal(app.clone(), &state, project_path) {
                                Ok(msg) => { let _ = app.emit("bot-status", msg); }
                                Err(e) => { let _ = app.emit("bot-error", e); }
                            }
                        }
                        "menu_logs" => {
                            // Switch to logs tab
                            let _ = app.emit("show-logs", ());
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_bot_status,
            start_bot,
            stop_bot,
            restart_bot,
            get_bot_health,
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
