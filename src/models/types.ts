export enum UserState {
  Idle = 'idle',
  WaitingProjectType = 'waiting_project_type',
  WaitingRepo = 'waiting_repo',
  WaitingDirectory = 'waiting_directory',
  InSession = 'in_session',
}

export enum ProjectType {
  GitHub = 'github',
  Directory = 'directory',
}

export enum TargetTool {
  Task = 'Task',
  Bash = 'Bash',
  Glob = 'Glob',
  Grep = 'Grep',
  LS = 'LS',
  ExitPlanMode = 'ExitPlanMode',
  Read = 'Read',
  Edit = 'Edit',
  MultiEdit = 'MultiEdit',
  Write = 'Write',
  TodoWrite = 'TodoWrite',
}

/**
 * Tool visibility classification for message aggregation
 * Determines how tools are displayed in aggregated messages
 */
export const ToolVisibility = {
  // High visibility - write operations, always show complete steps
  HIGH: [TargetTool.Edit, TargetTool.MultiEdit, TargetTool.Write, TargetTool.Bash] as TargetTool[],

  // Medium visibility - read operations, show in step counter but collapse details
  MEDIUM: [TargetTool.Read, TargetTool.Glob, TargetTool.Grep, TargetTool.LS] as TargetTool[],

  // Low visibility - internal operations, only count without individual display
  LOW: [TargetTool.TodoWrite, TargetTool.Task] as TargetTool[],
} as const;

/**
 * Get visibility level of a tool
 */
export function getToolVisibilityLevel(toolName: string): 'high' | 'medium' | 'low' {
  if (ToolVisibility.HIGH.includes(toolName as TargetTool)) return 'high';
  if (ToolVisibility.MEDIUM.includes(toolName as TargetTool)) return 'medium';
  return 'low';
}

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  repoUrl?: string;
  localPath: string;
  created: Date;
  lastUsed: Date;
  status: string;
}

export interface User {
  chat_id: number;
  state: UserState;
  projects: Map<string, Project>;
  activeProject: string;
  currentInput: string;
  lastActivity: Date;
}


export interface RepoInfo {
  name: string;
  description: string;
  language: string;
  size: string;
  updatedAt: string;
  private: boolean;
  url: string;
}

export enum PermissionMode {
  Default = 'default',
  AcceptEdits = 'acceptEdits',
  Plan = 'plan',
  BypassPermissions = 'bypassPermissions'
}

export interface UserStats {
  totalUsers: number;
  activeUsers: number;
  totalProjects: number;
  activeSessions: number;
}

export interface DirectoryItem {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: Date;
  icon: string;
}

export interface FileBrowsingState {
  currentPath: string;
  basePath: string;
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  items: DirectoryItem[];
  messageId?: number;
}