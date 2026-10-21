export type AgentId =
  | "supervisor"
  | "math"
  | "code"
  | "knowledge"
  | "synthesis";

export type TraceStatus = "pending" | "running" | "complete";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  agents?: string[];
  sources?: SourceItem[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface SourceItem {
  id: string;
  document_id: string;
  title: string;
  excerpt: string;
  score: number;
  chunk_index: number;
}

export interface TraceStep {
  id: string;
  agent: string;
  type: "route" | "tool" | "synthesis";
  title: string;
  detail: string;
  status: TraceStatus;
  durationMs?: number;
}

export interface RouteAgent {
  id: "math" | "code" | "knowledge";
  label: string;
  reason: string;
}

export interface Health {
  status: string;
  provider: string;
  demo_mode: boolean;
  llm_configured: boolean;
  rag: {
    documents: number;
    chunks: number;
    backend: string;
    database?: string;
    embedding: string;
  };
  tools: number;
  graph: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  filename: string;
  chunks: number;
  size: number;
  created_at: string;
}

