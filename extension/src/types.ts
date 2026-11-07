export type Category = string;
export interface CustomLabel {id: string; name: string; description: string;}
export interface Observation {
  id: string; account: string; conversation: string; revision: string; reliable: boolean; session: string;
  sender: string; sender_name: string; subject: string; preview: string; metadata: string[];
  messages: { sender: string; recipients: string; text: string; outgoing: boolean }[];
  evidence: 'preview' | 'body';
  mailbox: 'inbox' | 'spam' | 'trash' | 'unknown';
}
export interface Result {
  id: string; label?: Category; choice?: Category; error?: string;
  probabilities?: Record<Category, number> | null; confidence?: number | null;
  actions?: Record<ActionGroup, ActionSignal>;
  action_error?: string;
  evidence?: string; truncated?: boolean; model?: string; cached?: boolean; source?: string;
  latency_ms?: number; usage?: Record<string, number>;
}
export interface Preferences {
  custom_labels?: CustomLabel[];
  category_descriptions: Record<Category, string>;
  priorities: string; rules: {kind: 'address' | 'domain'; value: string; category: Category}[];
  batch_size: 1 | 4 | 8;
}
export type ActionGroup = 'todo' | 'deadline' | 'waiting';
export interface ActionSignal {
  probability: number | null;
  state: 'positive' | 'negative' | 'uncertain' | 'needs_context' | 'unavailable';
}
