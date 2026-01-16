import type { TranslationKey } from './en';

export const zh: Record<TranslationKey, string> = {
  // App
  'app.title': 'ChatCode 控制台',
  'app.loading': '加载中...',
  
  // Tabs
  'tab.status': '状态',
  'tab.messages': '消息',
  'tab.metrics': '指标',
  'tab.users': '用户',
  'tab.logs': '日志',
  'tab.config': '配置',
  
  // Status
  'status.running': '运行中',
  'status.stopped': '已停止',
  'status.uptime': '运行时间',
  'status.pid': '进程 ID',
  'status.project': '项目',
  
  // Controls
  'control.start': '启动机器人',
  'control.stop': '停止机器人',
  'control.restart': '重启机器人',
  'control.starting': '启动中...',
  'control.stopping': '停止中...',
  'control.restarting': '重启中...',
  
  // Logs
  'logs.title': '机器人日志',
  'logs.clear': '清空日志',
  'logs.search': '搜索日志...',
  'logs.empty': '暂无日志，启动机器人后可查看日志。',
  'logs.noMatch': '没有匹配的日志。',
  
  // Config
  'config.token': 'Telegram Bot Token',
  'config.tokenPlaceholder': '输入你的 Telegram 机器人 Token',
  'config.claudePath': 'Claude Code 路径',
  'config.apiKey': 'Anthropic API Key',
  'config.apiKeyHint': '在 console.anthropic.com 获取 API Key',
  'config.baseUrl': 'Anthropic Base URL（可选）',
  'config.baseUrlHint': '仅在使用代理或自定义端点时设置',
  'config.workDir': '工作目录',
  'config.storageType': '存储类型',
  'config.redisUrl': 'Redis URL',
  'config.logLevel': '日志级别',
  'config.autostart': '开机自启动',
  'config.autostartHint': '登录时自动启动 ChatCode',
  'config.reload': '重新加载',
  'config.save': '保存配置',
  'config.saving': '保存中...',
  'config.saved': '配置保存成功',
  
  // Settings
  'settings.title': '设置',
  'settings.theme': '主题',
  'settings.themeSystem': '跟随系统',
  'settings.themeLight': '浅色',
  'settings.themeDark': '深色',
  'settings.language': '语言',
  'settings.languageEn': 'English',
  'settings.languageZh': '中文',
  
  // Messages
  'msg.autostartEnabled': '自启动已开启',
  'msg.autostartDisabled': '自启动已关闭',
  'msg.failedAutostart': '设置自启动失败',
  'msg.failedLoadConfig': '加载配置失败',

  // Message Simulator
  'messages.title': '消息',
  'messages.noChats': '暂无对话',
  'messages.selectChat': '选择一个对话来查看消息',
  'messages.noMessages': '该对话中暂无消息',
  'messages.botOffline': '机器人已离线，启动机器人以查看消息。',
  'messages.retry': '重试',
  'messages.today': '今天',
  'messages.yesterday': '昨天',
};
