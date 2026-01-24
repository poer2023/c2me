/**
 * Available Claude models for selection
 * SDK accepts short names (opus/sonnet/haiku) and maps to full IDs internally
 */
export const AVAILABLE_MODELS = [
  { id: 'opus', label: '🧠 Opus', description: 'Most capable, best for complex tasks' },
  { id: 'sonnet', label: '⚡ Sonnet', description: 'Balanced performance and speed' },
  { id: 'haiku', label: '🚀 Haiku', description: 'Fastest, best for simple tasks' },
] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id'];
export const VALID_MODEL_IDS: ModelId[] = AVAILABLE_MODELS.map(m => m.id);
