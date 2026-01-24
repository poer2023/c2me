import { Telegraf } from 'telegraf';
import { loadConfig, validateConfig } from './config/config';
import { StorageFactory } from './storage/factory';
import { IStorage } from './storage/interface';
import { GitHubManager } from './handlers/github';
import { DirectoryManager } from './handlers/directory';
import { ClaudeManager } from './handlers/claude';
import { TelegramHandler } from './handlers/telegram';
import { ExpressServer } from './server/express';
import { MessageFormatter } from './utils/formatter';
import { PermissionManager } from './handlers/permission-manager';
import { initMessageStore } from './services/message-store';
import { getDefaultRateLimiter } from './utils/rate-limiter';
import { logger } from './utils/logger';
import { ClaudeMessage } from './models/types';

// Phase 4: Rate limiter cleanup interval reference
let rateLimiterCleanupInterval: NodeJS.Timeout | null = null;

async function main(): Promise<void> {
  try {
    // Load and validate configuration
    const config = loadConfig();
    validateConfig(config);

    console.log('Configuration loaded successfully');

    // Create Telegram Bot
    const bot = new Telegraf(config.telegram.botToken);
    bot.telegram.getMe().then((botInfo) => {
      console.log(`Authorized as @${botInfo.username}`);
    });

    // Initialize components
    const storage = StorageFactory.create(config.storage);
    await storage.initialize();
    console.log(`${config.storage.type} storage initialized`);

    // Initialize Message Store for Message Simulator
    initMessageStore(storage);
    console.log('Message store initialized');

    const messageFormatter = new MessageFormatter();
    const github = new GitHubManager(config.workDir.workDir);
    const directory = new DirectoryManager();

    // Initialize Permission Manager
    const permissionManager = new PermissionManager(bot);
    console.log('Permission manager initialized');

    // First create a placeholder handler that we'll set up later
    // eslint-disable-next-line prefer-const
    let telegramHandler: TelegramHandler;

    // Initialize SDK manager with callback architecture
    const claudeSDK = new ClaudeManager(storage, permissionManager, {
      onClaudeResponse: async (userId: string, message: ClaudeMessage | null, toolInfo?: { toolId: string; toolName: string; isToolUse: boolean; isToolResult: boolean }, parentToolUseId?: string) => {
        await telegramHandler.handleClaudeResponse(userId, message, toolInfo, parentToolUseId);
      },
      onClaudeError: async (userId: string, error: string) => {
        await telegramHandler.handleClaudeError(userId, error);
      }
    }, config.claudeCode.binaryPath);
    console.log('Claude SDK manager initialized');

    // Create Telegram handler with callback architecture
    telegramHandler = new TelegramHandler(
      bot,
      github,
      directory,
      claudeSDK,
      storage,
      messageFormatter,
      config,
      permissionManager
    );

    console.log('Telegram handler initialized with callback architecture');

    // Always start metrics server (port 3002) for dashboard integration
    const metricsServer = new ExpressServer(bot, 3002, storage);
    metricsServer.setupRoutes();
    await metricsServer.start();
    console.log('Metrics server started on port 3002');

    if (config.telegram.mode === 'webhook') {
      if (!config.webhook) {
        throw new Error('Webhook configuration is missing');
      }
      const expressServer = new ExpressServer(bot, 3001);
      // Set up webhook
      await expressServer.setupWebhook(config.webhook);
      // Start Express server
      expressServer.setupRoutes();
      await expressServer.start();
    }
    
    // Start bot based on mode
    console.log(`Starting Telegram bot in ${config.telegram.mode} mode...`);
    
    if (config.telegram.mode === 'webhook') {
      console.log('Telegram bot is running in webhook mode');
    } else {
      // Use polling mode (default)
      await bot.launch();
      console.log('Telegram bot is running in polling mode');
    }

    // Phase 4: Start rate limiter cleanup interval (every hour)
    rateLimiterCleanupInterval = setInterval(() => {
      const limiter = getDefaultRateLimiter();
      limiter.cleanupOldBuckets();
      logger.info({ stats: limiter.getStats() }, 'Rate limiter cleanup completed');
    }, 60 * 60 * 1000); // 1 hour

    // Handle graceful shutdown (register after successful startup)
    process.once('SIGINT', () => gracefulShutdown(bot, claudeSDK, storage));
    process.once('SIGTERM', () => gracefulShutdown(bot, claudeSDK, storage));
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}


async function gracefulShutdown(
  bot: Telegraf,
  claudeSDK: ClaudeManager,
  storage: IStorage
): Promise<void> {
  console.log('Received shutdown signal, shutting down gracefully...');

  try {
    // Phase 4: Stop rate limiter cleanup interval
    if (rateLimiterCleanupInterval) {
      clearInterval(rateLimiterCleanupInterval);
      rateLimiterCleanupInterval = null;
    }

    // Stop the bot
    bot.stop('SIGINT');

    // Shutdown SDK manager
    await claudeSDK.shutdown();

    // Disconnect storage
    await storage.disconnect();
    console.log('Storage disconnected');

    console.log('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
