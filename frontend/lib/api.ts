import type {
  ChatMessage,
  Health,
  KnowledgeDocument,
  RouteAgent,
  SourceItem,
} from "./types";

export interface StreamCallbacks {
  onMeta?: (data: {
    conversation_id: string;
    provider: string;
    demo_mode: boolean;
  }) => void;
  onRoute?: (data: { agents: RouteAgent[] }) => void;
  onStep?: (data: {
    agent: string;
    type: string;
    title: string;
    detail: string;
    duration_ms?: number;
    status?: string;
  }) => void;
  onSources?: (data: { sources: SourceItem[] }) => void;
  onToken?: (data: { delta: string }) => void;
  onDone?: (data: {
    agents: string[];
    tools: number;
    sources: number;
    duration_ms: number;
  }) => void;
  onError?: (message: string) => void;
}

interface ChatPayload {
  message: string;
  conversation_id: string;
  history: Pick<ChatMessage, "role" | "content">[];
  preferred_agent: "auto" | "math" | "code" | "knowledge";
}

function parseEvent(block: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export async function streamChat(
  payload: ChatPayload,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `请求失败 (${response.status})`);
  }
  if (!response.body) throw new Error("浏览器不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseEvent(block);
      if (parsed) {
        const data = parsed.data as Record<string, unknown>;
        if (parsed.event === "meta") callbacks.onMeta?.(data as never);
        if (parsed.event === "route") callbacks.onRoute?.(data as never);
        if (parsed.event === "step") callbacks.onStep?.(data as never);
        if (parsed.event === "sources") callbacks.onSources?.(data as never);
        if (parsed.event === "token") callbacks.onToken?.(data as never);
        if (parsed.event === "done") callbacks.onDone?.(data as never);
        if (parsed.event === "error") {
          callbacks.onError?.(String(data.message ?? "未知错误"));
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export async function fetchHealth(): Promise<Health> {
  const response = await fetch("/api/health", { cache: "no-store" });
  if (!response.ok) throw new Error("服务连接失败");
  return response.json();
}

export async function fetchDocuments(): Promise<KnowledgeDocument[]> {
  const response = await fetch("/api/knowledge/documents", { cache: "no-store" });
  if (!response.ok) throw new Error("知识库读取失败");
  return response.json();
}

export async function uploadDocument(file: File): Promise<KnowledgeDocument> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/knowledge/upload", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    let message = "上传失败";
    try {
      const body = await response.json();
      message = body.detail ?? message;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await fetch(`/api/knowledge/documents/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("删除失败");
}

