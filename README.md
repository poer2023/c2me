# C2ME

<p align="center">
  <img src="assets/header.jpg" alt="C2ME" width="100%">
</p>

<p align="center">
  <b>Claude Code Mobile Edition - 在手机上使用 Claude Code</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Telegram-Bot-blue?logo=telegram" alt="Telegram">
  <img src="https://img.shields.io/badge/Claude-Code-orange" alt="Claude Code">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## 简介

C2ME 是一个 Telegram 机器人，让你可以通过手机与 Claude Code 对话进行 AI 编程。

**核心功能：**
- 📱 在手机上远程控制 Claude Code
- 💬 自然语言对话，描述需求即可生成代码
- 🔐 每个文件操作都需要你确认，安全可控
- 📁 支持管理多个项目

## 快速开始

### 1. 创建 Telegram Bot

1. 在 Telegram 搜索 `@BotFather`
2. 发送 `/newbot` 创建机器人
3. 保存获得的 Token

### 2. 配置并启动

```bash
# 克隆项目
git clone https://github.com/poer2023/c2me.git && cd c2me

# 安装依赖
pnpm install

# 配置环境变量
cat > .env << EOF
TG_BOT_TOKEN=你的Bot_Token
CLAUDE_CODE_PATH=claude
WORK_DIR=/path/to/projects
EOF

# 启动
pnpm run start
```

## 使用方法

### 基础命令

| 命令 | 说明 |
|------|------|
| `/start` | 开始使用 |
| `/createproject` | 创建新项目 |
| `/listproject` | 查看所有项目 |
| `/ls` | 浏览文件 |
| `/clear` | 清除对话 |

### 权限模式

| 命令 | 说明 |
|------|------|
| `/default` | 每个操作需要确认 |
| `/acceptedits` | 自动批准文件编辑 |
| `/bypass` | 跳过所有确认（谨慎） |

### 示例

```
你: 创建一个 Express 服务器

Claude: 好的，我来创建...

[📝 创建文件] server.js
+const express = require('express');
+const app = express();
+app.listen(3000);

[✅ 批准] [❌ 拒绝]
```

## 桌面管理器（可选）

`desktop/` 目录提供 Tauri 桌面应用，可以一键启动/停止 Bot 和查看日志。

```bash
cd desktop && pnpm install && pnpm tauri dev
```

## 环境要求

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
- Redis（可选）

## License

MIT
