# C2ME - Claude Code Mobile Edition

<p align="center">
  <img src="assets/c2me_header_20260115.jpg" alt="C2ME Header" width="100%">
</p>

<p align="center">
  <b>通过 Telegram 随时随地使用 Claude Code 进行 AI 编程</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Telegram-Bot-blue?logo=telegram" alt="Telegram">
  <img src="https://img.shields.io/badge/Claude-Code-orange?logo=anthropic" alt="Claude Code">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## 这是什么？

C2ME 让你可以通过 Telegram 机器人与 Claude Code 对话，实现：

- 📱 **手机编程** - 不用电脑也能让 AI 帮你写代码
- 💬 **自然对话** - 像聊天一样描述需求，Claude 帮你实现
- 🔐 **权限控制** - 每个文件操作都需要你批准，安全可控
- 📁 **项目管理** - 支持多个项目，随时切换

## 快速开始

### 1. 创建 Telegram Bot

1. 在 Telegram 搜索 `@BotFather`
2. 发送 `/newbot`，按提示创建机器人
3. 保存获得的 Bot Token

### 2. 配置环境变量

创建 `.env` 文件：

```env
TG_BOT_TOKEN=你的Bot Token
CLAUDE_CODE_PATH=claude
WORK_DIR=/path/to/your/projects
```

### 3. 启动服务

```bash
pnpm install
pnpm run start
```

## 使用方法

### 基础命令

| 命令 | 说明 |
|------|------|
| `/start` | 开始使用 |
| `/createproject` | 创建新项目 |
| `/listproject` | 查看所有项目 |
| `/ls` | 浏览文件目录 |
| `/clear` | 清除对话历史 |
| `/help` | 查看帮助 |

### 权限模式

| 命令 | 说明 |
|------|------|
| `/default` | 默认模式，每个操作需要审批 |
| `/acceptedits` | 自动批准文件编辑 |
| `/bypass` | 跳过所有权限检查（谨慎使用） |

### 使用示例

```
你: 帮我写一个 Express 服务器，监听 3000 端口

Claude: 好的，我来创建一个基础的 Express 服务器...

[📝 创建文件] server.js
+const express = require('express');
+const app = express();
+app.listen(3000);

[✅ 批准] [❌ 拒绝]
```

点击「批准」后，Claude 会继续完成剩余工作。

## 桌面管理应用（可选）

`desktop/` 目录包含一个 Tauri 桌面应用，可以：

- 一键启动/停止 Bot
- 查看实时日志
- 管理配置文件

```bash
cd desktop
pnpm install
pnpm tauri dev
```

## 环境要求

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安装
- Redis（可选，用于持久化存储）

## License

MIT
