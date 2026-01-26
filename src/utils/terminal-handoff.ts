function escapeForDoubleQuotes(value: string): string {
  return value.replace(/(["\\$`])/g, '\\$1');
}

export function buildResumeCommand(options: {
  binaryPath: string;
  sessionId: string;
  projectPath?: string;
}): string {
  const quotedBinary = `"${escapeForDoubleQuotes(options.binaryPath)}"`;
  const resumeCommand = `${quotedBinary} --resume ${options.sessionId}`;

  if (!options.projectPath) {
    return resumeCommand;
  }

  const quotedPath = `"${escapeForDoubleQuotes(options.projectPath)}"`;
  return `cd ${quotedPath} && ${resumeCommand}`;
}

export function formatResumeMessage(command: string): string {
  return `**Resume in Terminal**\n\n\`\`\`\n${command}\n\`\`\`\n\nCopy this command to continue the session in your terminal.`;
}

export function formatRemainingDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0 && seconds > 0) {
    return `${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}
