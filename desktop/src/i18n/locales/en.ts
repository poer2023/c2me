export const en = {
  // App
  'app.title': 'ChatCode Dashboard',
  'app.loading': 'Loading...',
  
  // Tabs
  'tab.status': 'Status',
  'tab.messages': 'Messages',
  'tab.metrics': 'Metrics',
  'tab.users': 'Users',
  'tab.logs': 'Logs',
  'tab.config': 'Configuration',
  
  // Status
  'status.running': 'Running',
  'status.stopped': 'Stopped',
  'status.uptime': 'Uptime',
  'status.pid': 'PID',
  'status.project': 'Project',
  
  // Controls
  'control.start': 'Start Bot',
  'control.stop': 'Stop Bot',
  'control.restart': 'Restart Bot',
  'control.starting': 'Starting...',
  'control.stopping': 'Stopping...',
  'control.restarting': 'Restarting...',
  
  // Logs
  'logs.title': 'Bot Logs',
  'logs.clear': 'Clear Logs',
  'logs.search': 'Search logs...',
  'logs.empty': 'No logs yet. Start the bot to see logs.',
  'logs.noMatch': 'No logs match your filters.',
  
  // Config
  'config.token': 'Telegram Bot Token',
  'config.tokenPlaceholder': 'Enter your Telegram bot token',
  'config.claudePath': 'Claude Code Path',
  'config.apiKey': 'Anthropic API Key',
  'config.apiKeyHint': 'Get your API key from console.anthropic.com',
  'config.baseUrl': 'Anthropic Base URL (Optional)',
  'config.baseUrlHint': 'Only set if using a proxy or custom endpoint',
  'config.workDir': 'Work Directory',
  'config.storageType': 'Storage Type',
  'config.redisUrl': 'Redis URL',
  'config.logLevel': 'Log Level',
  'config.autostart': 'Launch at startup',
  'config.autostartHint': 'Automatically start ChatCode when you log in',
  'config.reload': 'Reload',
  'config.save': 'Save Configuration',
  'config.saving': 'Saving...',
  'config.saved': 'Configuration saved successfully',
  
  // Settings
  'settings.title': 'Settings',
  'settings.theme': 'Theme',
  'settings.themeSystem': 'System',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.language': 'Language',
  'settings.languageEn': 'English',
  'settings.languageZh': '中文',
  
  // Messages
  'msg.autostartEnabled': 'Auto-start enabled',
  'msg.autostartDisabled': 'Auto-start disabled',
  'msg.failedAutostart': 'Failed to set auto-start',
  'msg.failedLoadConfig': 'Failed to load config',

  // Message Simulator
  'messages.title': 'Messages',
  'messages.noChats': 'No conversations yet',
  'messages.selectChat': 'Select a conversation to view messages',
  'messages.noMessages': 'No messages in this conversation',
  'messages.botOffline': 'Bot is offline. Start the bot to view messages.',
  'messages.retry': 'Retry',
  'messages.today': 'Today',
  'messages.yesterday': 'Yesterday',
} as const;

export type TranslationKey = keyof typeof en;
