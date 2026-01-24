import { Telegraf } from 'telegraf';
import { TelegramSender } from './telegram-sender';
import { TargetTool } from '../models/types';

/**
 * Step status in the aggregated message
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'error';

/**
 * Information about a single step/tool execution
 */
export interface StepInfo {
  toolName: string;
  toolId: string;
  status: StepStatus;
  summary: string;
  details?: string | undefined;
  startTime: number;
  duration?: number;
}

/**
 * Aggregated message state for a chat
 */
export interface AggregatedMessage {
  chatId: number;
  messageId: number;
  steps: StepInfo[];
  currentStep: number;
  totalSteps: number | null;
  startTime: number;
  lastUpdateTime: number;
}

/**
 * Tool visibility classification
 */
export const ToolVisibility = {
  // High visibility - write operations, always show complete steps
  HIGH: [TargetTool.Edit, TargetTool.MultiEdit, TargetTool.Write, TargetTool.Bash] as string[],

  // Medium visibility - read operations, show in step counter but collapse details
  MEDIUM: [TargetTool.Read, TargetTool.Glob, TargetTool.Grep, TargetTool.LS] as string[],

  // Low visibility - internal operations, only count without individual display
  LOW: [TargetTool.TodoWrite, TargetTool.Task] as string[],
} as const;

/**
 * Options for message aggregator
 */
export interface MessageAggregatorOptions {
  minUpdateInterval: number;  // Minimum interval between message updates (ms)
  showLowVisibilitySteps: boolean;  // Whether to show low visibility steps
  collapseReadOperations: boolean;  // Whether to collapse read operations
  maxVisibleSteps: number;  // Maximum number of steps to show before collapsing
}

const DEFAULT_OPTIONS: MessageAggregatorOptions = {
  minUpdateInterval: 1500,
  showLowVisibilitySteps: false,
  collapseReadOperations: true,
  maxVisibleSteps: 10,
};

/**
 * MessageAggregator - Aggregates multiple tool operations into a single updating message
 *
 * This service reduces message spam by:
 * 1. Using a single message that updates as tools execute
 * 2. Showing a step counter [N/M] format
 * 3. Collapsing less important operations into expandable sections
 * 4. Providing summary information at completion
 */
export class MessageAggregator {
  private sessions: Map<number, AggregatedMessage> = new Map();
  private telegramSender: TelegramSender;
  private options: MessageAggregatorOptions;
  private updateTimers: Map<number, NodeJS.Timeout> = new Map();
  private pendingUpdates: Map<number, boolean> = new Map();

  constructor(bot: Telegraf, options: Partial<MessageAggregatorOptions> = {}) {
    this.telegramSender = new TelegramSender(bot);
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start a new aggregation session for a chat
   */
  startSession(chatId: number, messageId: number): void {
    this.sessions.set(chatId, {
      chatId,
      messageId,
      steps: [],
      currentStep: 0,
      totalSteps: null,
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
    });
  }

  /**
   * Check if a session exists for a chat
   */
  hasSession(chatId: number): boolean {
    return this.sessions.has(chatId);
  }

  /**
   * Get the current session for a chat
   */
  getSession(chatId: number): AggregatedMessage | undefined {
    return this.sessions.get(chatId);
  }

  /**
   * Add a new step (tool use) to the aggregated message
   */
  addStep(chatId: number, toolName: string, toolId: string, input?: Record<string, unknown>): void {
    const session = this.sessions.get(chatId);
    if (!session) return;

    const summary = this.formatStepSummary(toolName, input);
    const details = this.formatStepDetails(toolName, input);

    const step: StepInfo = {
      toolName,
      toolId,
      status: 'running',
      summary,
      details,
      startTime: Date.now(),
    };

    session.steps.push(step);
    session.currentStep = session.steps.length;

    this.scheduleUpdate(chatId);
  }

  /**
   * Mark a step as completed
   */
  completeStep(chatId: number, toolId: string, result?: unknown, isError: boolean = false): void {
    const session = this.sessions.get(chatId);
    if (!session) return;

    const step = session.steps.find(s => s.toolId === toolId);
    if (!step) return;

    step.status = isError ? 'error' : 'completed';
    step.duration = Date.now() - step.startTime;

    // Update summary with result info if available
    if (result && !isError) {
      step.summary = this.updateSummaryWithResult(step.toolName, step.summary, result);
    }

    this.scheduleUpdate(chatId);
  }

  /**
   * Set the total expected steps (if known)
   */
  setTotalSteps(chatId: number, total: number): void {
    const session = this.sessions.get(chatId);
    if (session) {
      session.totalSteps = total;
      this.scheduleUpdate(chatId);
    }
  }

  /**
   * End the aggregation session and return final summary
   */
  endSession(chatId: number): string {
    const session = this.sessions.get(chatId);
    if (!session) return '';

    // Clear any pending updates
    const timer = this.updateTimers.get(chatId);
    if (timer) {
      clearTimeout(timer);
      this.updateTimers.delete(chatId);
    }
    this.pendingUpdates.delete(chatId);

    const summary = this.renderCompletionSummary(session);
    this.sessions.delete(chatId);

    return summary;
  }

  /**
   * Abort the session without rendering completion
   */
  abortSession(chatId: number): void {
    const timer = this.updateTimers.get(chatId);
    if (timer) {
      clearTimeout(timer);
      this.updateTimers.delete(chatId);
    }
    this.pendingUpdates.delete(chatId);
    this.sessions.delete(chatId);
  }

  /**
   * Schedule a debounced update to the message
   */
  private scheduleUpdate(chatId: number): void {
    this.pendingUpdates.set(chatId, true);

    // If there's already a timer, let it handle the update
    if (this.updateTimers.has(chatId)) return;

    const session = this.sessions.get(chatId);
    if (!session) return;

    const timeSinceLastUpdate = Date.now() - session.lastUpdateTime;
    const delay = Math.max(0, this.options.minUpdateInterval - timeSinceLastUpdate);

    const timer = setTimeout(async () => {
      this.updateTimers.delete(chatId);

      if (this.pendingUpdates.get(chatId)) {
        this.pendingUpdates.set(chatId, false);
        await this.updateMessage(chatId);
      }
    }, delay);

    this.updateTimers.set(chatId, timer);
  }

  /**
   * Update the aggregated message
   */
  private async updateMessage(chatId: number): Promise<void> {
    const session = this.sessions.get(chatId);
    if (!session) return;

    const content = this.render(chatId);
    if (!content) return;

    try {
      await this.telegramSender.safeEditMessage(chatId, session.messageId, content);
      session.lastUpdateTime = Date.now();
    } catch (error) {
      // Ignore "message is not modified" errors
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes('message is not modified')) {
        console.error('[MessageAggregator] Failed to update message:', error);
      }
    }
  }

  /**
   * Render the current aggregated message content
   */
  render(chatId: number): string {
    const session = this.sessions.get(chatId);
    if (!session) return '';

    const lines: string[] = [];
    const elapsed = this.formatTime((Date.now() - session.startTime) / 1000);

    // Header with step counter
    const stepIndicator = session.totalSteps
      ? `[${session.currentStep}/${session.totalSteps}]`
      : `[${session.currentStep}]`;

    // Get current running step
    const runningStep = session.steps.find(s => s.status === 'running');

    if (runningStep) {
      lines.push(`⏳ ${stepIndicator} ${runningStep.summary}...`);
    } else {
      lines.push(`⏳ ${stepIndicator} Processing...`);
    }

    // Show recent completed steps (high visibility only)
    const recentSteps = this.getRecentHighVisibilitySteps(session);
    if (recentSteps.length > 0) {
      lines.push('');
      for (const step of recentSteps) {
        const statusIcon = step.status === 'completed' ? '✓' : step.status === 'error' ? '✗' : '○';
        const duration = step.duration ? ` (${this.formatTime(step.duration / 1000)})` : '';
        lines.push(`${statusIcon} ${step.summary}${duration}`);
      }
    }

    // Show collapsed details for read operations if there are many
    const readOps = session.steps.filter(s =>
      ToolVisibility.MEDIUM.includes(s.toolName) && s.status === 'completed'
    );

    if (readOps.length > 2 && this.options.collapseReadOperations) {
      lines.push('');
      lines.push(`>>> ${readOps.length} read operations completed`);
    }

    // Footer with elapsed time
    lines.push('');
    lines.push(`(${elapsed})`);

    return lines.join('\n');
  }

  /**
   * Render completion summary
   */
  private renderCompletionSummary(session: AggregatedMessage): string {
    const elapsed = this.formatTime((Date.now() - session.startTime) / 1000);
    const lines: string[] = [];

    // Summary header
    const errorCount = session.steps.filter(s => s.status === 'error').length;
    if (errorCount > 0) {
      lines.push(`⚠️ Completed with ${errorCount} error(s) (${elapsed})`);
    } else {
      lines.push(`✅ Done! (${elapsed})`);
    }

    // Categorize steps
    const writeOps = session.steps.filter(s =>
      ToolVisibility.HIGH.includes(s.toolName)
    );
    const readOps = session.steps.filter(s =>
      ToolVisibility.MEDIUM.includes(s.toolName)
    );

    // Summary stats
    if (writeOps.length > 0 || readOps.length > 0) {
      lines.push('');
      lines.push('**Summary:**');

      if (readOps.length > 0) {
        lines.push(`• Read ${readOps.length} file(s)`);
      }

      // Group write operations by type
      const edits = writeOps.filter(s => s.toolName === TargetTool.Edit || s.toolName === TargetTool.MultiEdit);
      const writes = writeOps.filter(s => s.toolName === TargetTool.Write);
      const commands = writeOps.filter(s => s.toolName === TargetTool.Bash);

      if (edits.length > 0) {
        lines.push(`• Edited ${edits.length} file(s)`);
      }
      if (writes.length > 0) {
        lines.push(`• Wrote ${writes.length} file(s)`);
      }
      if (commands.length > 0) {
        lines.push(`• Ran ${commands.length} command(s)`);
      }
    }

    // Expandable detailed steps (for many operations)
    if (session.steps.length > 3) {
      lines.push('');
      lines.push('>>> **Detailed Steps**');
      for (let i = 0; i < Math.min(session.steps.length, this.options.maxVisibleSteps); i++) {
        const step = session.steps[i];
        if (!step) continue;
        const statusIcon = step.status === 'completed' ? '✓' : step.status === 'error' ? '✗' : '○';
        const duration = step.duration ? ` (${this.formatTime(step.duration / 1000)})` : '';
        lines.push(`>>> [${i + 1}] ${statusIcon} ${step.summary}${duration}`);
      }
      if (session.steps.length > this.options.maxVisibleSteps) {
        lines.push(`>>> ... and ${session.steps.length - this.options.maxVisibleSteps} more`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get recent high visibility steps for display
   */
  private getRecentHighVisibilitySteps(session: AggregatedMessage): StepInfo[] {
    return session.steps
      .filter(s =>
        ToolVisibility.HIGH.includes(s.toolName) &&
        s.status !== 'running'
      )
      .slice(-3); // Show last 3 high visibility steps
  }

  /**
   * Format step summary based on tool type
   */
  private formatStepSummary(toolName: string, input?: Record<string, unknown>): string {
    switch (toolName) {
      case TargetTool.Read:
        return `Reading ${this.extractFileName(input?.file_path as string | undefined)}`;
      case TargetTool.Write:
        return `Writing ${this.extractFileName(input?.file_path as string | undefined)}`;
      case TargetTool.Edit:
      case TargetTool.MultiEdit:
        return `Editing ${this.extractFileName(input?.file_path as string | undefined)}`;
      case TargetTool.Glob:
        return `Searching for ${(input?.pattern as string) || 'files'}`;
      case TargetTool.Grep:
        return `Searching "${(input?.pattern as string) || 'content'}"`;
      case TargetTool.LS:
        return `Listing ${this.extractFileName(input?.path as string | undefined) || 'directory'}`;
      case TargetTool.Bash:
        const cmd = (input?.command as string) || 'command';
        return `Running ${cmd.slice(0, 30)}${cmd.length > 30 ? '...' : ''}`;
      case TargetTool.Task:
        return `Starting ${(input?.description as string) || 'task'}`;
      case TargetTool.TodoWrite:
        return 'Managing tasks';
      default:
        return `Using ${toolName}`;
    }
  }

  /**
   * Format step details (for expandable sections)
   */
  private formatStepDetails(toolName: string, input?: Record<string, unknown>): string | undefined {
    switch (toolName) {
      case TargetTool.Bash:
        return input?.command as string | undefined;
      case TargetTool.Grep:
        return `Pattern: ${input?.pattern}, Path: ${(input?.path as string) || '.'}`;
      default:
        return undefined;
    }
  }

  /**
   * Update summary with result information
   */
  private updateSummaryWithResult(toolName: string, summary: string, result: unknown): string {
    const content = typeof result === 'string' ? result : '';

    switch (toolName) {
      case TargetTool.Glob: {
        const fileCount = content.split('\n').filter((l: string) => l.trim()).length;
        return `Found ${fileCount} file(s)`;
      }
      case TargetTool.Grep: {
        const matchCount = content.split('\n').filter((l: string) => l.trim()).length;
        return `Found ${matchCount} match(es)`;
      }
      default:
        return summary;
    }
  }

  /**
   * Extract filename from path
   */
  private extractFileName(path?: string): string {
    if (!path) return 'file';
    return path.split('/').pop() || 'file';
  }

  /**
   * Format time for display
   */
  private formatTime(seconds: number): string {
    const secs = Math.floor(seconds);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}m ${remainingSecs}s`;
  }

  /**
   * Get visibility level of a tool
   */
  static getToolVisibility(toolName: string): 'high' | 'medium' | 'low' {
    if (ToolVisibility.HIGH.includes(toolName)) return 'high';
    if (ToolVisibility.MEDIUM.includes(toolName)) return 'medium';
    return 'low';
  }
}
