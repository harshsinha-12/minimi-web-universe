import type { EvidenceAudit } from "./ai/claim-audit";
export type Citation = {
  url: string;
  title: string;
  start: number;
  end: number;
};
export type Source = { url: string; title: string };
export type Trace = { at: number; stage: string; detail: string };
export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: string;
  citations: Citation[];
  sources: Source[];
  runId: string | null;
  evidence?: EvidenceAudit;
};
export type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};
export type Memory = {
  id: string;
  kind: string;
  text: string;
  sources: { messageId: string; quote: string }[];
  validUntil: string | null;
  createdAt: string;
  version: number;
  userEdited?: boolean;
};
export type Run = {
  id: string;
  conversationId: string;
  status: string;
  trace: Trace[];
  metrics: Record<string, unknown>;
  startedAt: string;
  error: string | null;
};
export type StreamEvent = {
  type: string;
  runId?: string;
  [key: string]: unknown;
};
