import express, { Request, Response, NextFunction } from 'express';
import { Telegraf } from 'telegraf';
import { WebhookConfig } from '../config/config';
import { getMetricsSnapshot, MetricsSnapshot } from '../utils/metrics';
import { IStorage } from '../storage/interface';

export class ExpressServer {
  private app: express.Application;
  private bot: Telegraf;
  private port: number;
  private storage: IStorage | undefined;

  constructor(bot: Telegraf, port: number, storage?: IStorage) {
    this.app = express();
    this.bot = bot;
    this.port = port;
    this.storage = storage;
    this.setupMiddleware();
  }

  private setupMiddleware(): void {
    // Parse JSON bodies
    this.app.use(express.json());
    
    // Security headers
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      next();
    });
  }

  public setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        mode: 'webhook'
      });
    });

    // Metrics endpoint for dashboard
    this.app.get('/metrics', (_req: Request, res: Response) => {
      try {
        const metrics: MetricsSnapshot = getMetricsSnapshot();
        res.json(metrics);
      } catch (error) {
        res.status(500).json({ error: 'Failed to get metrics' });
      }
    });

    // Analytics endpoint for user statistics (Phase 2)
    this.app.get('/analytics', async (_req: Request, res: Response) => {
      try {
        if (!this.storage) {
          res.status(503).json({ error: 'Storage not available' });
          return;
        }
        const analytics = await this.storage.getAnalyticsSnapshot();
        res.json(analytics);
      } catch (error) {
        console.error('Failed to get analytics:', error);
        res.status(500).json({ error: 'Failed to get analytics' });
      }
    });

    // Root endpoint
    this.app.get('/', (_req: Request, res: Response) => {
      res.json({
        message: 'Telegram Bot Webhook Server',
        status: 'running'
      });
    });

    // 404 handler
    this.app.use('*', (_req: Request, res: Response) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('Express server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const server = this.app.listen(this.port, () => {
          console.log(`Express server listening on port ${this.port}`);
          resolve();
        });

        server.on('error', (error: any) => {
          console.error('Express server failed to start:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }


  public async setupWebhook(webhookConfig: WebhookConfig): Promise<void> {
    try {
        // Webhook endpoint for Telegram
      this.app.use(webhookConfig.path, this.bot.webhookCallback(webhookConfig.path));

      const webhookUrl = `${webhookConfig.domain}${webhookConfig.path}`;
      console.log(`Setting up webhook: ${webhookUrl}`);
      
      const webhookOptions: any = {
        url: webhookUrl,
      };

      // Add secret token if provided
      if (webhookConfig.secretToken) {
        webhookOptions.secret_token = webhookConfig.secretToken;
      }

      await this.bot.telegram.setWebhook(webhookUrl, webhookOptions);
      console.log('Webhook set successfully');
    } catch (error) {
      console.error('Failed to set webhook:', error);
      throw error;
    }
  }

  public getApp(): express.Application {
    return this.app;
  }
}