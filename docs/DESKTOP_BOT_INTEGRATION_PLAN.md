# Desktop Bot Integration Plan

## Overview

Integrate Telegram Bot management into the Tauri desktop application, providing a seamless one-click experience for users without command-line knowledge.

## Current State Analysis

### Already Implemented ✅
- Bot process management (start/stop/restart)
- Tray icon with status display
- Dashboard window with logs
- Config management (.env load/save)
- Autostart on login
- Global shortcuts (Cmd+Shift+C toggle bot)
- Metrics and analytics panels

### Missing Features ❌
1. **Dependency Installation** - No `pnpm install` functionality
2. **First-time Setup Wizard** - No onboarding for new users
3. **GitHub Actions for Tauri** - No automated .dmg/.AppImage builds
4. **Bundled Node.js** - Requires user to have Node.js installed

## Implementation Plan

### Phase 1: Dependency Installation (Priority: High)

Add ability to install/update dependencies from the desktop app.

**Rust Backend (`lib.rs`):**
```rust
#[tauri::command]
fn install_dependencies(project_path: String) -> Result<String, String>

#[tauri::command]
fn check_dependencies(project_path: String) -> DependencyStatus
```

**Frontend Component:**
- "Install Dependencies" button
- Progress indicator during installation
- Success/error feedback

### Phase 2: First-time Setup Wizard (Priority: High)

Guide new users through initial configuration.

**Wizard Steps:**
1. Welcome screen
2. Check prerequisites (Node.js, pnpm)
3. Configure .env (TG_BOT_TOKEN, CLAUDE_CODE_PATH, etc.)
4. Install dependencies
5. Test bot connection
6. Complete!

**Storage:**
- `~/.chatcode/setup_complete` flag file
- Show wizard on first launch if flag missing

### Phase 3: GitHub Actions for Tauri Builds (Priority: High)

Automate desktop app distribution.

**Workflow: `.github/workflows/tauri-release.yml`**
- Trigger: On tag push `v*`
- Build targets:
  - macOS: `.dmg`, `.app`
  - Linux: `.AppImage`, `.deb`
  - Windows: `.msi`, `.exe`
- Upload artifacts to GitHub Release

### Phase 4: Enhanced UX (Priority: Medium)

**Improvements:**
- Auto-detect project path
- Node.js version check with download link
- pnpm auto-installation if missing
- Better error messages with solutions

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   ChatCode Desktop                       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Setup Wizard│  │ Bot Control │  │ Metrics/Logs    │  │
│  │             │  │             │  │                 │  │
│  │ • Prerequisites │ • Start    │  │ • Real-time     │  │
│  │ • Config    │  │ • Stop     │  │ • Analytics     │  │
│  │ • Install   │  │ • Restart  │  │ • Health        │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
├─────────────────────────────────────────────────────────┤
│                    Tauri Backend (Rust)                  │
│  • Process management  • Config I/O  • Dependency mgmt  │
├─────────────────────────────────────────────────────────┤
│                    Telegram Bot (Node.js)                │
│  • Claude Code SDK  • Telegram API  • Redis storage     │
└─────────────────────────────────────────────────────────┘
```

## User Flow

```
Download .dmg/.AppImage
        ↓
   First Launch
        ↓
   ┌─────────────────┐
   │ Setup Wizard    │
   │ 1. Prerequisites│ ← Check Node.js, pnpm
   │ 2. Configure    │ ← Enter bot token, paths
   │ 3. Install deps │ ← Run pnpm install
   │ 4. Test         │ ← Verify bot starts
   └─────────────────┘
        ↓
   Normal Usage
        ↓
   ┌─────────────────┐
   │ Tray Icon       │
   │ • Start Bot     │
   │ • Stop Bot      │
   │ • Dashboard     │
   └─────────────────┘
```

## File Changes

### New Files
- `desktop/src/components/SetupWizard.tsx` - Wizard UI
- `desktop/src/components/DependencyManager.tsx` - Dependency UI
- `.github/workflows/tauri-release.yml` - Build workflow

### Modified Files
- `desktop/src-tauri/src/lib.rs` - Add new commands
- `desktop/src/App.tsx` - Integrate wizard
- `desktop/src-tauri/tauri.conf.json` - Update bundle targets

## Timeline

| Phase | Effort | Priority |
|-------|--------|----------|
| Phase 1: Dependency Installation | 2h | High |
| Phase 2: Setup Wizard | 3h | High |
| Phase 3: GitHub Actions | 1h | High |
| Phase 4: Enhanced UX | 2h | Medium |

**Total: ~8 hours**

## Success Criteria

1. User downloads single file (.dmg or .AppImage)
2. Opens app, completes 5-minute setup wizard
3. Bot runs with one click, no terminal required
4. App auto-starts on login (optional)
5. Updates available via GitHub Releases
