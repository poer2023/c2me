# ChatCode

<p align="center">
  <img src="assets/header.jpg" alt="ChatCode" width="100%">
</p>

<p align="center">
  <b>在手机上使用 Claude Code 的桌面客户端</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.3.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-green" alt="Platform">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

---

## 这是什么？

ChatCode 是一个桌面应用，让你通过 Telegram 机器人远程使用 Claude Code 进行 AI 编程。

**下载安装后，打开即用** — 内置引导式配置，无需命令行操作。

### 核心功能

- 📱 **手机编程** — 在 Telegram 上与 Claude Code 对话，随时随地写代码
- 🖥️ **桌面管理** — 一键启动/停止，实时日志，系统托盘常驻
- 🔐 **安全可控** — 每个文件操作都需要你在手机上确认
- ⚡ **开箱即用** — 引导式安装，自动检测依赖，一键配置

## 安装

### macOS

1. 从 [Releases](https://github.com/poer2023/c2me/releases) 下载 `.dmg` 文件
2. 拖入 Applications 文件夹
3. 打开 ChatCode，按照向导完成配置

### Windows / Linux

从 [Releases](https://github.com/poer2023/c2me/releases) 下载对应安装包。

## 首次配置

打开应用后，Setup Wizard 会引导你完成：

1. **环境检测** — 自动检查 Node.js、pnpm（缺少会提示安装）
2. **配置凭证** — 输入 Telegram Bot Token 和 Claude Code 路径
3. **安装依赖** — 一键安装所有 npm 包
4. **开始使用** — 点击 Start Bot 即可

> 💡 Telegram Bot Token 从 [@BotFather](https://t.me/BotFather) 获取

## 使用方法

### 桌面端

| 功能 | 操作 |
|------|------|
| 启动/停止 Bot | 点击 Dashboard 按钮或托盘菜单 |
| 查看日志 | Logs 标签页，支持搜索和级别过滤 |
| 用户统计 | Users 标签页 |
| 运行指标 | Metrics 标签页 |
| 修改配置 | Configuration 标签页 |
| 开机启动 | Configuration → Launch at startup |

**快捷键**: `Cmd+Shift+C` 快速切换 Bot 状态

### Telegram 端

| 命令 | 说明 |
|------|------|
| `/start` | 开始使用 |
| `/createproject` | 创建新项目 |
| `/listproject` | 查看项目列表 |
| `/ls` | 浏览文件 |
| `/clear` | 清除对话 |

**权限模式**:
- `/default` — 每个操作需要确认（推荐）
- `/acceptedits` — 自动批准文件编辑
- `/bypass` — 跳过确认（谨慎使用）

### 示例对话

```
你: 帮我写一个 REST API

Claude: 好的，我来创建一个 Express API...

[📝 创建文件] src/app.ts
+import express from 'express';
+const app = express();
+...

[✅ 批准] [❌ 拒绝]
```

## 系统要求

- **Node.js** 18+（应用会自动检测，没有会提示下载）
- **Claude Code CLI**（[安装指南](https://docs.anthropic.com/en/docs/claude-code)）
- **Telegram 账号**

## 技术栈

- **桌面应用**: Tauri 2.0 (Rust + React)
- **Bot 后端**: TypeScript + Telegraf
- **AI 集成**: Claude Agent SDK

## License

MIT
