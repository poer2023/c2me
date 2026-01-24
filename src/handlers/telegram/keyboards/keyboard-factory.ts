import { Markup } from 'telegraf';
import { MESSAGES } from '../../../constants/messages';
import { Project } from '../../../models/project';
import { ProgressSettings } from '../../../utils/progress-config';
import { FileBrowsingState } from '../../../models/types';

/**
 * Options for execution control keyboard
 */
export interface ExecutionKeyboardOptions {
  canStop: boolean;
  canExpand: boolean;
  sessionId?: string;
}

export class KeyboardFactory {
  /**
   * Create execution control keyboard for aggregated messages
   */
  static createExecutionKeyboard(options: ExecutionKeyboardOptions): ReturnType<typeof Markup.inlineKeyboard> {
    const buttons = [];

    if (options.canStop) {
      const stopCallback = options.sessionId
        ? `exec:stop:${options.sessionId}`
        : 'exec:stop';
      buttons.push(Markup.button.callback('⏹️ Stop', stopCallback));
    }

    if (options.canExpand) {
      const expandCallback = options.sessionId
        ? `exec:expand:${options.sessionId}`
        : 'exec:expand';
      buttons.push(Markup.button.callback('📋 Details', expandCallback));
    }

    if (buttons.length === 0) {
      return Markup.inlineKeyboard([]);
    }

    return Markup.inlineKeyboard([buttons]);
  }

  static createProjectTypeKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(MESSAGES.BUTTONS.GITHUB_REPO, 'project_type_github'),
        Markup.button.callback(MESSAGES.BUTTONS.LOCAL_DIRECTORY, 'project_type_directory'),
      ],
      [
        Markup.button.callback(MESSAGES.BUTTONS.CANCEL, 'cancel'),
      ],
    ]);
  }

  static createCancelKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
    return Markup.inlineKeyboard([
      Markup.button.callback(MESSAGES.BUTTONS.CANCEL, 'cancel'),
    ]);
  }

  static createCompletionKeyboard(): ReturnType<typeof Markup.removeKeyboard> {
    // 移除危险的常驻按钮，避免误操作
    // 用户需要手动输入 /clear 或 /abort 命令
    return Markup.removeKeyboard();
  }

  static createProjectListKeyboard(projects: Project[]): ReturnType<typeof Markup.inlineKeyboard> {
    const keyboard = [];
    
    // Add project buttons, 2 per row
    for (let i = 0; i < projects.length; i += 2) {
      const row = [];
      const project1 = projects[i];
      const project2 = projects[i + 1];
      
      if (project1) {
        row.push(Markup.button.callback(
          `${project1.type === 'git' ? '🔗' : '📂'} ${project1.name}`,
          `project_select_${project1.id}`
        ));
      }
      
      if (project2) {
        row.push(Markup.button.callback(
          `${project2.type === 'git' ? '🔗' : '📂'} ${project2.name}`,
          `project_select_${project2.id}`
        ));
      }
      
      if (row.length > 0) {
        keyboard.push(row);
      }
    }
    
    // Add action buttons
    keyboard.push([
      Markup.button.callback('❌ cancel', 'cancel')
    ]);
    
    return Markup.inlineKeyboard(keyboard);
  }

  static createDirectoryKeyboard(browsingState: FileBrowsingState): ReturnType<typeof Markup.inlineKeyboard> {
    const { currentPage, itemsPerPage, totalItems, items } = browsingState;
    const keyboard = [];

    // Calculate pagination
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const pageItems = items.slice(startIndex, endIndex);

    // Add file/directory buttons (2 per row)
    for (let i = 0; i < pageItems.length; i += 2) {
      const row = [];
      const item1 = pageItems[i];
      const item2 = pageItems[i + 1];

      if (item1) {
        row.push(Markup.button.callback(
          `${item1.icon} ${item1.name}`,
          `${item1.type}:${encodeURIComponent(item1.name)}`
        ));
      }

      if (item2) {
        row.push(Markup.button.callback(
          `${item2.icon} ${item2.name}`,
          `${item2.type}:${encodeURIComponent(item2.name)}`
        ));
      }

      if (row.length > 0) {
        keyboard.push(row);
      }
    }

    // Add navigation buttons
    const navRow = [];
    if (currentPage > 1) {
      navRow.push(Markup.button.callback('⬅️ Previous', `nav:page:${currentPage - 1}`));
    }
    if (browsingState.currentPath !== '/') {
      navRow.push(Markup.button.callback('📂 Parent', 'nav:parent'));
    }
    if (currentPage < totalPages) {
      navRow.push(Markup.button.callback('Next ➡️', `nav:page:${currentPage + 1}`));
    }

    if (navRow.length > 0) {
      keyboard.push(navRow);
    }

    // Add action buttons
    keyboard.push([
      Markup.button.callback('🔄 Refresh', 'nav:refresh'),
      Markup.button.callback('❌ Close', 'nav:close')
    ]);

    return Markup.inlineKeyboard(keyboard);
  }

  /**
   * Create progress settings keyboard
   */
  static createProgressSettingsKeyboard(settings: ProgressSettings): ReturnType<typeof Markup.inlineKeyboard> {
    const enabledIcon = settings.enabled ? '✅' : '❌';
    const toolDetailsIcon = settings.showToolDetails ? '✅' : '❌';
    const elapsedTimeIcon = settings.showElapsedTime ? '✅' : '❌';
    const autoPauseIcon = settings.autoPauseOnRateLimit ? '✅' : '❌';
    const dynamicIcon = settings.dynamicIntervalAdjustment ? '✅' : '❌';

    return Markup.inlineKeyboard([
      [
        Markup.button.callback(`${enabledIcon} Progress Tracking`, 'progress:toggle:enabled'),
      ],
      [
        Markup.button.callback(`${toolDetailsIcon} Tool Details`, 'progress:toggle:toolDetails'),
        Markup.button.callback(`${elapsedTimeIcon} Elapsed Time`, 'progress:toggle:elapsedTime'),
      ],
      [
        Markup.button.callback(`${autoPauseIcon} Auto Pause`, 'progress:toggle:autoPause'),
        Markup.button.callback(`${dynamicIcon} Dynamic Interval`, 'progress:toggle:dynamic'),
      ],
      [
        Markup.button.callback('⏱️ Intervals', 'progress:intervals'),
        Markup.button.callback('📊 Statistics', 'progress:stats'),
      ],
      [
        Markup.button.callback('🛡️ Safe', 'progress:preset:safe'),
        Markup.button.callback('⚖️ Balanced', 'progress:preset:balanced'),
        Markup.button.callback('🚀 Aggressive', 'progress:preset:aggressive'),
      ],
      [
        Markup.button.callback('🔄 Reset', 'progress:reset'),
        Markup.button.callback('❌ Close', 'progress:close'),
      ],
    ]);
  }

  /**
   * Create progress intervals adjustment keyboard
   */
  static createProgressIntervalsKeyboard(settings: ProgressSettings): ReturnType<typeof Markup.inlineKeyboard> {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback(`Edit Interval: ${settings.minEditInterval / 1000}s`, 'progress:interval:edit'),
      ],
      [
        Markup.button.callback('➖', 'progress:edit:decrease'),
        Markup.button.callback('➕', 'progress:edit:increase'),
      ],
      [
        Markup.button.callback(`Heartbeat: ${settings.heartbeatInterval / 1000}s`, 'progress:interval:heartbeat'),
      ],
      [
        Markup.button.callback('➖', 'progress:heartbeat:decrease'),
        Markup.button.callback('➕', 'progress:heartbeat:increase'),
      ],
      [
        Markup.button.callback(`Status Update: ${settings.statusUpdateInterval / 1000}s`, 'progress:interval:status'),
      ],
      [
        Markup.button.callback('➖', 'progress:status:decrease'),
        Markup.button.callback('➕', 'progress:status:increase'),
      ],
      [
        Markup.button.callback('⬅️ Back', 'progress:back'),
      ],
    ]);
  }

  /**
   * Create progress statistics keyboard
   */
  static createProgressStatsKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🔄 Refresh', 'progress:stats:refresh'),
        Markup.button.callback('🗑️ Reset Stats', 'progress:stats:reset'),
      ],
      [
        Markup.button.callback('⬅️ Back', 'progress:back'),
      ],
    ]);
  }

  /**
   * Create model selection keyboard
   */
  static createModelSelectionKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🧠 Opus', 'model:opus'),
        Markup.button.callback('⚡ Sonnet', 'model:sonnet'),
        Markup.button.callback('🚀 Haiku', 'model:haiku'),
      ],
      [
        Markup.button.callback('❌ Cancel', 'cancel'),
      ],
    ]);
  }

  /**
   * Create quick permission mode switch keyboard
   */
  static createPermissionSwitchKeyboard(currentMode?: string): ReturnType<typeof Markup.inlineKeyboard> {
    const modes = [
      { label: '🛡️ Default', callback: 'perm:default', mode: 'default' },
      { label: '✏️ AcceptEdits', callback: 'perm:acceptedits', mode: 'acceptEdits' },
      { label: '📋 Plan', callback: 'perm:plan', mode: 'plan' },
      { label: '⚡ Bypass', callback: 'perm:bypass', mode: 'bypassPermissions' },
    ];

    return Markup.inlineKeyboard([
      modes.map(m => Markup.button.callback(
        currentMode === m.mode ? `[${m.label}]` : m.label,
        m.callback
      )),
    ]);
  }

  /**
   * Create completion keyboard with permission switch
   */
  static createCompletionWithPermKeyboard(): ReturnType<typeof Markup.keyboard> {
    return Markup.keyboard([
      ['/compact', '/undo', '/abort'],
      ['/default', '/acceptedits', '/plan', '/bypass']
    ]).resize();
  }
}