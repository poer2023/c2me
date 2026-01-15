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
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tauri_plugin_notification::NotificationExt;

// Helper function to send system notification
fn send_notification(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

// Helper function to update tray tooltip based on bot status
fn update_tray_status(app: &AppHandle, is_running: bool, uptime_secs: Option<u64>) {
    if let Some(tray) = app.tray_by_id("main") {
        let tooltip = if is_running {
            if let Some(secs) = uptime_secs {
                let hours = secs / 3600;
                let minutes = (secs % 3600) / 60;
                if hours > 0 {
                    format!("ChatCode Bot • Running ({}h {}m)", hours, minutes)
                } else if minutes > 0 {
                    format!("ChatCode Bot • Running ({}m)", minutes)
                } else {
                    "ChatCode Bot • Running".to_string()
                }
            } else {
                "ChatCode Bot • Running".to_string()
            }
        } else {
            "ChatCode Bot • Stopped".to_string()
        };
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}

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
    // Try to get from environment variable, fallback to default
    std::env::var("C2ME_PROJECT_PATH")
        .or_else(|_| std::env::var("HOME").map(|h| format!("{}/Project/c2me", h)))
        .unwrap_or_else(|_| "/tmp/c2me".to_string())
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

#[tauri::command]
fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to get autostart status: {}", e))
}

#[tauri::command]
fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| format!("Failed to enable autostart: {}", e))
    } else {
        autostart.disable().map_err(|e| format!("Failed to disable autostart: {}", e))
    }
}

#[derive(Clone, Serialize)]
pub struct BotMetrics {
    counters: serde_json::Value,
    histograms: serde_json::Value,
    gauges: serde_json::Value,
    timestamp: String,
}

#[derive(Clone, Serialize)]
pub struct AnalyticsSnapshot {
    dau: i64,
    wau: i64,
    mau: i64,
    total_users: i64,
    total_messages: i64,
    total_sessions: i64,
    top_commands: serde_json::Value,
    recent_users: serde_json::Value,
    generated_at: String,
}

#[tauri::command]
fn fetch_analytics() -> Result<serde_json::Value, String> {
    // Fetch analytics from the bot's HTTP endpoint
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get("http://localhost:3002/analytics")
        .send()
        .map_err(|e| format!("Failed to fetch analytics: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Analytics endpoint returned status: {}", response.status()));
    }

    let analytics: serde_json::Value = response
        .json()
        .map_err(|e| format!("Failed to parse analytics JSON: {}", e))?;

    Ok(analytics)
}

#[tauri::command]
fn fetch_metrics() -> Result<BotMetrics, String> {
    // Fetch metrics from the bot's HTTP endpoint
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get("http://localhost:3002/metrics")
        .send()
        .map_err(|e| format!("Failed to fetch metrics: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Metrics endpoint returned status: {}", response.status()));
    }

    let metrics: serde_json::Value = response
        .json()
        .map_err(|e| format!("Failed to parse metrics JSON: {}", e))?;

    Ok(BotMetrics {
        counters: metrics.get("counters").cloned().unwrap_or(serde_json::Value::Null),
        histograms: metrics.get("histograms").cloned().unwrap_or(serde_json::Value::Null),
        gauges: metrics.get("gauges").cloned().unwrap_or(serde_json::Value::Null),
        timestamp: metrics.get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

// Setup and dependency management

#[derive(Clone, Serialize)]
pub struct PrerequisiteStatus {
    node_installed: bool,
    node_version: Option<String>,
    pnpm_installed: bool,
    pnpm_version: Option<String>,
    project_exists: bool,
    dependencies_installed: bool,
    env_configured: bool,
}

#[tauri::command]
fn check_prerequisites(project_path: String) -> PrerequisiteStatus {
    // Check Node.js
    let node_result = Command::new("node")
        .arg("--version")
        .output();
    let (node_installed, node_version) = match node_result {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            (true, Some(version))
        }
        _ => (false, None),
    };

    // Check pnpm
    let pnpm_result = Command::new("pnpm")
        .arg("--version")
        .output();
    let (pnpm_installed, pnpm_version) = match pnpm_result {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            (true, Some(version))
        }
        _ => (false, None),
    };

    // Check if project directory exists
    let project_exists = std::path::Path::new(&project_path).exists();

    // Check if node_modules exists
    let node_modules_path = format!("{}/node_modules", project_path);
    let dependencies_installed = std::path::Path::new(&node_modules_path).exists();

    // Check if .env file exists and has required keys
    let env_path = format!("{}/.env", project_path);
    let env_configured = if let Ok(content) = std::fs::read_to_string(&env_path) {
        content.contains("TG_BOT_TOKEN=") && content.contains("CLAUDE_CODE_PATH=")
    } else {
        false
    };

    PrerequisiteStatus {
        node_installed,
        node_version,
        pnpm_installed,
        pnpm_version,
        project_exists,
        dependencies_installed,
        env_configured,
    }
}

#[derive(Clone, Serialize)]
pub struct InstallProgress {
    stage: String,
    message: String,
    progress: u8, // 0-100
}

#[tauri::command]
fn install_dependencies(app: AppHandle, project_path: String) -> Result<String, String> {
    // Emit initial progress
    let _ = app.emit("install-progress", InstallProgress {
        stage: "starting".to_string(),
        message: "Starting dependency installation...".to_string(),
        progress: 0,
    });

    // Run pnpm install
    let output = Command::new("pnpm")
        .args(["install", "--frozen-lockfile"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run pnpm install: {}", e))?;

    let _ = app.emit("install-progress", InstallProgress {
        stage: "installing".to_string(),
        message: "Installing packages...".to_string(),
        progress: 50,
    });

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Try without frozen lockfile
        let retry_output = Command::new("pnpm")
            .arg("install")
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to run pnpm install: {}", e))?;

        if !retry_output.status.success() {
            let retry_stderr = String::from_utf8_lossy(&retry_output.stderr);
            return Err(format!("pnpm install failed: {}", retry_stderr));
        }
    }

    let _ = app.emit("install-progress", InstallProgress {
        stage: "building".to_string(),
        message: "Building TypeScript...".to_string(),
        progress: 75,
    });

    // Run build
    let build_output = Command::new("pnpm")
        .args(["run", "build"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Failed to run build: {}", e))?;

    if !build_output.status.success() {
        let stderr = String::from_utf8_lossy(&build_output.stderr);
        return Err(format!("Build failed: {}", stderr));
    }

    let _ = app.emit("install-progress", InstallProgress {
        stage: "complete".to_string(),
        message: "Installation complete!".to_string(),
        progress: 100,
    });

    Ok("Dependencies installed and built successfully".to_string())
}

#[tauri::command]
fn install_pnpm() -> Result<String, String> {
    let output = Command::new("npm")
        .args(["install", "-g", "pnpm"])
        .output()
        .map_err(|e| format!("Failed to install pnpm: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to install pnpm: {}", stderr));
    }

    Ok("pnpm installed successfully".to_string())
}

#[tauri::command]
fn check_setup_complete() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let flag_path = format!("{}/.chatcode/setup_complete", home);
    std::path::Path::new(&flag_path).exists()
}

#[tauri::command]
fn mark_setup_complete() -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir_path = format!("{}/.chatcode", home);
    let flag_path = format!("{}/setup_complete", dir_path);

    std::fs::create_dir_all(&dir_path)
        .map_err(|e| format!("Failed to create .chatcode directory: {}", e))?;

    std::fs::write(&flag_path, "1")
        .map_err(|e| format!("Failed to write setup flag: {}", e))?;

    Ok(())
}

#[tauri::command]
fn create_env_file(project_path: String, config: std::collections::HashMap<String, String>) -> Result<(), String> {
    let env_path = format!("{}/.env", project_path);

    // Read existing .env.example if exists
    let example_path = format!("{}/.env.example", project_path);
    let mut content = if let Ok(example) = std::fs::read_to_string(&example_path) {
        example
    } else {
        // Default template
        r#"# Telegram Bot Token (required)
TG_BOT_TOKEN=

# Claude Code binary path (required)
CLAUDE_CODE_PATH=

# Working directory for projects
WORK_DIR=

# Storage type: redis or memory
STORAGE_TYPE=memory

# Redis URL (optional, for production)
# REDIS_URL=redis://localhost:6379
"#.to_string()
    };

    // Replace values in template
    for (key, value) in config {
        let pattern = format!("{}=", key);
        let replacement = format!("{}={}", key, value);

        if content.contains(&pattern) {
            // Replace existing line
            let lines: Vec<&str> = content.lines().collect();
            let new_lines: Vec<String> = lines.iter().map(|line| {
                if line.starts_with(&pattern) || line.starts_with(&format!("# {}", pattern)) {
                    replacement.clone()
                } else {
                    line.to_string()
                }
            }).collect();
            content = new_lines.join("\n");
        } else {
            // Append new line
            content.push_str(&format!("\n{}", replacement));
        }
    }

    std::fs::write(&env_path, content)
        .map_err(|e| format!("Failed to write .env file: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            let tray = TrayIconBuilder::with_id(app, "main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("ChatCode Bot • Stopped")
                .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
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
                            Ok(msg) => {
                                send_notification(app, "ChatCode Bot", "Bot started successfully");
                                update_tray_status(app, true, None);
                                let _ = app.emit("bot-status", msg);
                            }
                            Err(e) => { let _ = app.emit("bot-error", e); }
                        }
                    }
                    "stop" => {
                        let state: State<BotState> = app.state();
                        match stop_bot_internal(&state) {
                            Ok(msg) => {
                                send_notification(app, "ChatCode Bot", "Bot stopped");
                                update_tray_status(app, false, None);
                                let _ = app.emit("bot-status", msg);
                            }
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
                            Ok(msg) => {
                                send_notification(app, "ChatCode Bot", "Bot restarted successfully");
                                update_tray_status(app, true, None);
                                let _ = app.emit("bot-status", msg);
                            }
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
                                Ok(msg) => {
                                    update_tray_status(app, true, None);
                                    let _ = app.emit("bot-status", msg);
                                }
                                Err(e) => { let _ = app.emit("bot-error", e); }
                            }
                        }
                        "menu_stop" => {
                            let state: State<BotState> = app.state();
                            match stop_bot_internal(&state) {
                                Ok(msg) => {
                                    update_tray_status(app, false, None);
                                    let _ = app.emit("bot-status", msg);
                                }
                                Err(e) => { let _ = app.emit("bot-error", e); }
                            }
                        }
                        "menu_restart" => {
                            let state: State<BotState> = app.state();
                            let project_path = get_project_path();
                            let _ = stop_bot_internal(&state);
                            thread::sleep(Duration::from_millis(300));
                            match start_bot_internal(app.clone(), &state, project_path) {
                                Ok(msg) => {
                                    update_tray_status(app, true, None);
                                    let _ = app.emit("bot-status", msg);
                                }
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

            // Register global shortcut (Cmd+Shift+C to toggle bot)
            #[cfg(desktop)]
            {
                let app_handle = app.handle().clone();
                let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyC);

                app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, _event| {
                    let state: State<BotState> = app_handle.state();
                    let is_running = {
                        let process = state.process.lock().unwrap();
                        process.is_some()
                    };

                    if is_running {
                        let _ = stop_bot_internal(&state);
                        update_tray_status(&app_handle, false, None);
                        let _ = app_handle.emit("bot-status", "Bot stopped via shortcut");
                    } else {
                        let project_path = get_project_path();
                        match start_bot_internal(app_handle.clone(), &state, project_path) {
                            Ok(msg) => {
                                update_tray_status(&app_handle, true, None);
                                let _ = app_handle.emit("bot-status", msg);
                            }
                            Err(e) => { let _ = app_handle.emit("bot-error", e); }
                        }
                    }
                })?;
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
            save_config,
            get_autostart_enabled,
            set_autostart_enabled,
            fetch_metrics,
            fetch_analytics,
            // Setup wizard commands
            check_prerequisites,
            install_dependencies,
            install_pnpm,
            check_setup_complete,
            mark_setup_complete,
            create_env_file
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
