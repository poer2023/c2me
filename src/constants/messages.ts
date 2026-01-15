// Telegram 机器人消息文本模板（中文版）
export const MESSAGES = {
  // 欢迎消息
  WELCOME_TEXT: `🚀 欢迎使用 Claude Code 机器人！

这个机器人帮助你通过 Telegram 与 Claude Code 交互。

主要功能：
• 创建和管理多个项目
• 连接 GitHub 仓库
• 在 Telegram 中使用 Claude Code
• 完整的键盘交互支持
• 支持无项目模式直接对话

可用命令：
📋 **项目管理**
• /createproject - 创建新项目
• /listproject - 查看所有项目
• /exitproject - 退出当前项目

💬 **会话控制**
• /auth - 认证（如需要）
• /abort - 中止当前查询
• /clear - 清除会话

🔧 **权限模式**
• /default - 标准模式，需要确认权限
• /acceptedits - 自动接受文件编辑
• /plan - 仅分析，不修改文件
• /bypass - 跳过所有权限确认

📁 **文件操作**
• /ls - 浏览项目文件

ℹ️ **信息**
• /status - 查看当前状态
• /help - 显示帮助

开始使用吧！直接发消息即可与 Claude 对话 🎉`,

  // 创建项目
  CREATE_PROJECT_TEXT: `📁 创建新项目

请选择项目类型：

🔗 **GitHub 仓库**
- 从 GitHub 克隆仓库
- 支持公开和私有仓库
- 自动下载代码到本地

📂 **本地目录**
- 使用已有的本地目录
- 支持任意绝对路径
- 直接在指定目录中开始`,

  // GitHub 项目设置
  GITHUB_PROJECT_TEXT: `🔗 GitHub 仓库项目

请发送 GitHub 仓库链接，格式如下：
• https://github.com/username/repo
• git@github.com:username/repo.git

支持的仓库类型：
✅ 公开仓库

示例：
https://github.com/microsoft/vscode`,

  // 本地目录项目设置
  LOCAL_PROJECT_TEXT: `📂 本地目录项目

请发送本地目录的绝对路径，例如：
• /Users/username/projects/myproject
• /home/user/code/myapp
• /opt/projects/webapp

要求：
✅ 必须是绝对路径（以 / 开头）
✅ 目录必须存在且可访问
✅ 有读写权限

示例：
/Users/john/projects/my-react-app`,

  // 项目确认
  PROJECT_CONFIRMATION_TEXT: (name: string, description: string, language: string, size: string, updatedAt: string) =>
    `📋 项目信息确认

仓库名：${name}
描述：${description}
语言：${language}
大小：${size}
最后更新：${updatedAt}

正在使用仓库名 "${name}" 作为项目名称...`,

  // 目录确认
  DIRECTORY_CONFIRMATION_TEXT: (name: string, path: string, files: number, directories: number, lastModified: string) =>
    `📋 目录信息确认

目录名：${name}
路径：${path}
文件数：${files}
子目录数：${directories}
最后修改：${lastModified}

正在使用目录名 "${name}" 作为项目名称...`,

  // 成功消息
  PROJECT_SUCCESS_TEXT: (name: string, projectId: string, repoUrl?: string, localPath?: string, sourcePath?: string) => {
    const repoSection = repoUrl ? `仓库地址：${repoUrl}\n` : '';
    const sourceSection = sourcePath ? `源路径：${sourcePath}\n` : '';

    return `✅ 项目创建成功！

项目名：${name}
项目ID：${projectId}
${repoSection}项目类型：${repoUrl ? 'GitHub 仓库' : '本地目录'}
本地路径：${localPath}
${sourceSection}
项目已就绪！现在可以直接与 Claude Code 对话了。`;
  },

  // 状态消息
  STATUS_TEXT: (userState: string, sessionStatus: string, projectCount: number, activeProjectName: string, activeProjectType: string, activeProjectPath: string, permissionMode: string, authStatus: string, hasClaudeSession: string) =>
    `📊 当前状态

🔧 **系统状态**
用户状态：${userState}
会话状态：${sessionStatus}
认证状态：${authStatus}
Claude 会话：${hasClaudeSession}

📋 **项目**
项目总数：${projectCount}
当前项目：${activeProjectName}
项目类型：${activeProjectType}
项目路径：${activeProjectPath}

⚙️ **设置**
权限模式：${permissionMode}`,

  // 帮助文本
  HELP_TEXT: `📚 帮助文档

📋 **项目管理**
/createproject - 创建新项目（GitHub 仓库或本地目录）
/listproject - 查看所有项目
/exitproject - 退出当前项目

💬 **会话控制**
/auth [密码] - 认证（如需要）
/abort - 中止当前 Claude 查询
/clear - 清除 Claude 会话

🔧 **权限模式**
/default - 标准模式，需要确认权限
/acceptedits - 自动接受文件编辑权限
/plan - 仅分析模式，不修改文件
/bypass - 跳过所有权限确认（安全环境）

📁 **文件操作**
/ls [路径] - 浏览项目文件和目录

ℹ️ **信息**
/status - 查看完整状态信息
/help - 显示此帮助消息

**使用流程：**
1. 如需要，先用 /auth 认证
2. 直接发消息与 Claude 对话（无需创建项目）
3. 或用 /createproject 创建项目
4. 使用权限模式控制 Claude 的能力
5. 需要时用 /ls 浏览文件

**提示：**
• 直接发消息即可与 Claude 对话
• 使用 /status 查看当前设置`,

  // 进度消息
  CLONING_REPO: '⏳ 正在克隆仓库...',
  TYPING_INDICATOR: '⌨️ 正在输入...',

  // 错误消息
  ERRORS: {
    COMPLETE_CURRENT_OPERATION: '请先退出当前项目',
    INVALID_GITHUB_URL: '无效的 GitHub 仓库链接',
    INVALID_ABSOLUTE_PATH: '请提供绝对路径（以 / 开头）',
    DIRECTORY_NOT_FOUND: '目录不存在或无法访问',
    PROJECT_CREATION_FAILED: (error: string) => `项目创建失败：${error}`,
    NO_ACTIVE_SESSION: '没有活跃的会话',
    SEND_INPUT_FAILED: (error: string) => `发送输入失败：${error}`,
    INVALID_OPERATION: '无效的操作',
    USER_NOT_INITIALIZED: '用户未初始化',
    FEATURE_IN_DEVELOPMENT: '功能开发中'
  },

  // 权限消息
  PERMISSION_GRANTED: '权限已授予',
  PERMISSION_DENIED: '权限已拒绝',

  // 按钮标签
  BUTTONS: {
    GITHUB_REPO: '🔗 GitHub 仓库',
    LOCAL_DIRECTORY: '📂 本地目录',
    CANCEL: '❌ 取消',
    START_SESSION: '🚀 开始会话',
    PROJECT_LIST: '📋 项目列表',
    APPROVE: '✅ 允许',
    DENY: '❌ 拒绝',
  }
};
