import { query } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger';

/**
 * Tool definition extracted from Claude SDK
 */
export interface ToolDefinition {
  name: string;
  description?: string;
}

/**
 * SDK metadata extracted from init message
 */
export interface SDKMetadata {
  tools: ToolDefinition[];
  slashCommands: string[];
  model?: string;
  extractedAt: Date;
}

/**
 * Cached metadata to avoid repeated extraction
 */
let cachedMetadata: SDKMetadata | null = null;
let extractionPromise: Promise<SDKMetadata> | null = null;

/**
 * Extract SDK metadata by performing a minimal query
 * Uses the SDK's init message to get available tools and commands
 */
export async function extractSDKMetadata(options?: {
  forceRefresh?: boolean;
  binaryPath?: string;
  timeout?: number;
}): Promise<SDKMetadata> {
  const { forceRefresh = false, binaryPath, timeout = 10000 } = options || {};

  // Return cached if available and not forcing refresh
  if (cachedMetadata && !forceRefresh) {
    return cachedMetadata;
  }

  // If extraction is in progress, wait for it
  if (extractionPromise) {
    return extractionPromise;
  }

  extractionPromise = doExtractMetadata(binaryPath, timeout);

  try {
    cachedMetadata = await extractionPromise;
    return cachedMetadata;
  } finally {
    extractionPromise = null;
  }
}

async function doExtractMetadata(binaryPath?: string, timeout: number = 10000): Promise<SDKMetadata> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeout);

  const metadata: SDKMetadata = {
    tools: [],
    slashCommands: [],
    extractedAt: new Date()
  };

  try {
    const sdkQuery = query({
      prompt: 'hello',
      options: {
        allowedTools: ['Bash(echo hello)'], // Minimal tool set
        maxTurns: 1,
        abortController,
        ...(binaryPath ? { pathToClaudeCodeExecutable: binaryPath } : {})
      }
    });

    for await (const message of sdkQuery) {
      // SDK sends 'system' message with subtype 'init' containing tools
      if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
        const initMessage = message as {
          type: 'system';
          subtype: 'init';
          tools?: Array<{ name: string; description?: string }>;
          slash_commands?: string[];
          model?: string;
        };

        if (initMessage.tools) {
          metadata.tools = initMessage.tools.map(t => ({
            name: t.name,
            description: t.description
          }));
        }

        if (initMessage.slash_commands) {
          metadata.slashCommands = initMessage.slash_commands;
        }

        if (initMessage.model) {
          metadata.model = initMessage.model;
        }

        // Got what we need, abort to save API cost
        abortController.abort();
        break;
      }
    }

    logger.info({ toolCount: metadata.tools.length }, 'SDK metadata extracted successfully');
    return metadata;

  } catch (error) {
    // AbortError is expected when we abort after getting metadata
    if (error instanceof Error && error.name === 'AbortError') {
      return metadata;
    }

    logger.error({ err: error }, 'Failed to extract SDK metadata');
    // Return empty metadata on failure
    return metadata;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get tool names as a Set for fast lookup
 */
export function getToolNameSet(): Set<string> {
  if (!cachedMetadata) {
    // Return default tools if metadata not yet extracted
    return new Set([
      'Task', 'Bash', 'Glob', 'Grep', 'LS', 'ExitPlanMode',
      'Read', 'Edit', 'MultiEdit', 'Write', 'TodoWrite'
    ]);
  }
  return new Set(cachedMetadata.tools.map(t => t.name));
}

/**
 * Check if a tool name is valid
 */
export function isValidTool(toolName: string): boolean {
  return getToolNameSet().has(toolName);
}

/**
 * Get cached metadata (may be null if not yet extracted)
 */
export function getCachedMetadata(): SDKMetadata | null {
  return cachedMetadata;
}

/**
 * Clear cached metadata
 */
export function clearMetadataCache(): void {
  cachedMetadata = null;
}
