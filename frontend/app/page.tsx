"use client";

import {
  Activity,
  ArrowUp,
  BookOpen,
  Bot,
  BrainCircuit,
  Calculator,
  Check,
  ChevronDown,
  CircleStop,
  Code2,
  Command,
  Cpu,
  FileText,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  UploadCloud,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Sidebar } from "@/components/Sidebar";
import { TracePanel } from "@/components/TracePanel";
import {
  deleteDocument,
  fetchDocuments,
  fetchHealth,
  streamChat,
  uploadDocument,
} from "@/lib/api";
import type {
  ChatMessage,
  Conversation,
  Health,
  KnowledgeDocument,
  RouteAgent,
  SourceItem,
  TraceStep,
} from "@/lib/types";

const STORAGE_KEY = "nexus-agent-conversations-v1";

const emptyConversation = (): Conversation => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
};

const suggestions = [
  {
    icon: Search,
    eyebrow: "RAG KNOWLEDGE",
    title: "介绍平台能力",
    prompt: "请结合知识库介绍一下 Nexus Agent 的核心能力，并给出来源。",
    tone: "green",
  },
  {
    icon: Calculator,
    eyebrow: "REASONING + TOOL",
    title: "验证复杂计算",
    prompt: "请计算 (128 * 7 + 36) / 4，并解释工具调用过程。",
    tone: "orange",
  },
  {
    icon: Code2,
    eyebrow: "CODE AGENT",
    title: "生成工程代码",
    prompt: "用 Python 写一个快速排序函数，要求包含类型标注和边界测试。",
    tone: "blue",
  },
];

const agentMeta: Record<string, { label: string; color: string }> = {
  math: { label: "数学 Agent", color: "orange" },
  code: { label: "代码 Agent", color: "blue" },
  knowledge: { label: "知识 Agent", color: "green" },
  synthesis: { label: "多 Agent 综合", color: "violet" },
};

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState("");
  const [preferredAgent, setPreferredAgent] = useState<
    "auto" | "math" | "code" | "knowledge"
  >("auto");
  const [isStreaming, setIsStreaming] = useState(false);
  const [routes, setRoutes] = useState<RouteAgent[]>([]);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeId),
    [conversations, activeId],
  );
  const messages = activeConversation?.messages ?? [];

  useEffect(() => {
    let restored: Conversation[] = [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      restored = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(restored)) restored = [];
    } catch {
      restored = [];
    }
    if (restored.length === 0) {
      const conversation = emptyConversation();
      restored = [conversation];
      setActiveId(conversation.id);
    } else {
      setActiveId(restored[0].id);
    }
    setConversations(restored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations, hydrated]);

  const refreshKnowledge = useCallback(async () => {
    try {
      setDocuments(await fetchDocuments());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "知识库读取失败");
    }
  }, []);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() =>
        setHealth({
          status: "offline",
          provider: "后端未连接",
          demo_mode: true,
          llm_configured: false,
          rag: {
            documents: 0,
            chunks: 0,
            backend: "offline",
            database: "-",
            embedding: "-",
          },
          tools: 0,
          graph: "langgraph",
        }),
      );
    refreshKnowledge();
  }, [refreshKnowledge]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: isStreaming ? "auto" : "smooth",
    });
  }, [messages, isStreaming]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const updateConversation = useCallback(
    (id: string, updater: (conversation: Conversation) => Conversation) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === id ? updater(conversation) : conversation,
        ),
      );
    },
    [],
  );

  const appendToAssistant = useCallback(
    (conversationId: string, messageId: string, delta: string) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        updatedAt: new Date().toISOString(),
        messages: conversation.messages.map((message) =>
          message.id === messageId
            ? { ...message, content: message.content + delta }
            : message,
        ),
      }));
    },
    [updateConversation],
  );

  const submit = async (override?: string) => {
    const content = (override ?? input).trim();
    if (!content || isStreaming || !activeConversation) return;
    setInput("");
    setAgentMenuOpen(false);
    setRoutes([]);
    setSteps([]);
    setSources([]);
    setInspectorOpen(true);
    setIsStreaming(true);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      agents: [],
      sources: [],
    };
    const previousHistory = messages
      .filter((message) => message.content)
      .slice(-8)
      .map(({ role, content: text }) => ({ role, content: text }));
    const conversationId = activeConversation.id;

    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      title:
        conversation.messages.length === 0
          ? content.length > 22
            ? `${content.slice(0, 22)}…`
            : content
          : conversation.title,
      updatedAt: new Date().toISOString(),
      messages: [...conversation.messages, userMessage, assistantMessage],
    }));

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        {
          message: content,
          conversation_id: conversationId,
          history: previousHistory,
          preferred_agent: preferredAgent,
        },
        {
          onRoute: ({ agents }) => {
            setRoutes(agents);
            setSteps((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                agent: "supervisor",
                type: "route",
                title: "Supervisor 完成意图分析",
                detail: `已调度 ${agents.map((agent) => agent.label).join("、")}`,
                status: "complete",
                durationMs: 8,
              },
            ]);
          },
          onStep: (step) => {
            setSteps((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                agent: step.agent,
                type: "tool",
                title: `${step.title} 执行完成`,
                detail: step.detail,
                status: "complete",
                durationMs: step.duration_ms,
              },
            ]);
          },
          onSources: ({ sources: nextSources }) => {
            setSources(nextSources);
            updateConversation(conversationId, (conversation) => ({
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, sources: nextSources }
                  : message,
              ),
            }));
          },
          onToken: ({ delta }) => {
            appendToAssistant(conversationId, assistantMessage.id, delta);
          },
          onDone: ({ agents, duration_ms }) => {
            setSteps((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                agent: "synthesis",
                type: "synthesis",
                title: "Synthesis 完成结果汇总",
                detail: `已合并 ${agents.length} 个 Agent 的输出`,
                status: "complete",
                durationMs: duration_ms,
              },
            ]);
            updateConversation(conversationId, (conversation) => ({
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, agents }
                  : message,
              ),
            }));
          },
          onError: (message) => {
            appendToAssistant(
              conversationId,
              assistantMessage.id,
              `\n\n> 生成中断：${message}`,
            );
          },
        },
        controller.signal,
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        appendToAssistant(
          conversationId,
          assistantMessage.id,
          `\n\n> 无法连接后端服务。请确认 FastAPI 已在 8000 端口启动。`,
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const selectConversation = (id: string) => {
    if (isStreaming) return;
    const selected = conversations.find((conversation) => conversation.id === id);
    setActiveId(id);
    setRoutes([]);
    setSteps([]);
    setSources(selected?.messages.at(-1)?.sources ?? []);
    setInspectorOpen(false);
  };

  const newConversation = () => {
    if (isStreaming) abortRef.current?.abort();
    const conversation = emptyConversation();
    setConversations((current) => [conversation, ...current]);
    setActiveId(conversation.id);
    setRoutes([]);
    setSteps([]);
    setSources([]);
    setInspectorOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const removeConversation = (id: string) => {
    const next = conversations.filter((conversation) => conversation.id !== id);
    if (next.length === 0) {
      const replacement = emptyConversation();
      setConversations([replacement]);
      setActiveId(replacement.id);
    } else {
      setConversations(next);
      if (id === activeId) setActiveId(next[0].id);
    }
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadDocument(file);
      await refreshKnowledge();
      setUploadOpen(false);
      setNotice(`“${file.name}” 已加入知识库`);
      fetchHealth().then(setHealth).catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (id: string) => {
    try {
      await deleteDocument(id);
      await refreshKnowledge();
      setNotice("文档已从知识库移除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    }
  };

  const agentOptions = [
    { id: "auto" as const, label: "智能调度", icon: Sparkles },
    { id: "knowledge" as const, label: "知识 Agent", icon: Search },
    { id: "code" as const, label: "代码 Agent", icon: Code2 },
    { id: "math" as const, label: "数学 Agent", icon: Calculator },
  ];
  const selectedAgent =
    agentOptions.find((option) => option.id === preferredAgent) ?? agentOptions[0];
  const SelectedAgentIcon = selectedAgent.icon;
  const providerLabel = (health?.provider ?? "正在连接").replaceAll("本地", "");

  return (
    <main className="app-shell">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((value) => !value)}
        onNew={newConversation}
        onSelect={selectConversation}
        onDelete={removeConversation}
      />

      <section className="chat-shell">
        <header className="chat-header">
          <div className="header-copy">
            <div className="header-title-row">
              <h1>{activeConversation?.title ?? "新对话"}</h1>
              <span className="mode-pill">
                <span className="pulse-dot" />
                {health?.demo_mode === false ? "LIVE" : "DEMO"}
              </span>
            </div>
            <p>
              {health?.status === "offline"
                ? "后端服务未连接"
                : `${providerLabel} · ${health?.tools ?? 0} 个工具已就绪`}
            </p>
          </div>
          <div className="header-actions">
            <button
              className="icon-button quiet responsive-inspector"
              onClick={() => setInspectorOpen(true)}
              title="打开观察台"
            >
              <PanelRightOpen size={18} />
            </button>
            <button
              className="icon-button quiet"
              onClick={() => setSettingsOpen(true)}
              title="运行设置"
            >
              <Settings2 size={18} />
            </button>
            <div className="avatar" aria-label="个人账户">
              <UserRound size={16} />
            </div>
          </div>
        </header>

        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-kicker">
                <span>
                  <Sparkles size={14} />
                </span>
                MULTI-AGENT WORKSPACE
              </div>
              <h2>
                不止回答，
                <br />
                <span>更聪明地协作。</span>
              </h2>
              <p className="welcome-description">
                Supervisor 会理解你的意图，调度专业 Agent、调用工具并检索知识库。
                整个过程实时可见，每个结论都有迹可循。
              </p>
              <div className="capability-row">
                <span>
                  <BrainCircuit size={15} /> 智能路由
                </span>
                <span>
                  <Zap size={15} /> SSE 流式
                </span>
                <span>
                  <BookOpen size={15} /> RAG 引用
                </span>
                <span>
                  <Code2 size={15} /> 工具调用
                </span>
              </div>
              <div className="suggestion-grid">
                {suggestions.map((suggestion) => {
                  const Icon = suggestion.icon;
                  return (
                    <button
                      className={`suggestion-card ${suggestion.tone}`}
                      key={suggestion.title}
                      onClick={() => void submit(suggestion.prompt)}
                    >
                      <span className="suggestion-icon">
                        <Icon size={18} />
                      </span>
                      <span className="suggestion-eyebrow">
                        {suggestion.eyebrow}
                      </span>
                      <strong>{suggestion.title}</strong>
                      <span className="suggestion-text">{suggestion.prompt}</span>
                      <span className="suggestion-arrow">
                        <ArrowUp size={15} className="rotate-45" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message, index) => {
                const isLast = index === messages.length - 1;
                const waiting =
                  isStreaming && isLast && message.role === "assistant" && !message.content;
                return (
                  <article className={`message-row ${message.role}`} key={message.id}>
                    <div className="message-avatar">
                      {message.role === "user" ? (
                        <UserRound size={15} />
                      ) : (
                        <Sparkles size={17} />
                      )}
                    </div>
                    <div className="message-body">
                      <div className="message-meta">
                        <strong>{message.role === "user" ? "你" : "Nexus"}</strong>
                        {message.role === "assistant" && (
                          <span className="assistant-tag">Agent Team</span>
                        )}
                        <time>
                          {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      {waiting ? (
                        <div className="thinking-line">
                          <span className="thinking-orbit">
                            <Cpu size={16} />
                          </span>
                          <div>
                            <strong>正在协调 Agent</strong>
                            <span>分析意图并准备执行链路…</span>
                          </div>
                          <div className="thinking-dots">
                            <i />
                            <i />
                            <i />
                          </div>
                        </div>
                      ) : message.role === "assistant" ? (
                        <>
                          <MarkdownContent content={message.content} />
                          {message.agents && message.agents.length > 0 && (
                            <div className="message-agent-row">
                              {message.agents.map((agent) => (
                                <span
                                  className={`message-agent-tag ${
                                    agentMeta[agent]?.color ?? "violet"
                                  }`}
                                  key={agent}
                                >
                                  <Bot size={12} />
                                  {agentMeta[agent]?.label ?? agent}
                                </span>
                              ))}
                            </div>
                          )}
                          {message.sources && message.sources.length > 0 && (
                            <div className="message-sources">
                              <BookOpen size={13} />
                              引用了 {message.sources.length} 个知识片段
                              <button onClick={() => setInspectorOpen(true)}>
                                查看来源
                              </button>
                            </div>
                          )}
                          {isLast && !isStreaming && (
                            <div className="message-tools">
                              <button onClick={() => void submit(message.content)}>
                                <RotateCcw size={13} />
                                重新生成
                              </button>
                              <button
                                onClick={() => {
                                  void navigator.clipboard.writeText(message.content);
                                  setNotice("回答已复制");
                                }}
                              >
                                <FileText size={13} />
                                复制
                              </button>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="user-content">{message.content}</div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {isStreaming && (
            <button
              className="stop-button"
              onClick={() => abortRef.current?.abort()}
            >
              <CircleStop size={14} />
              停止生成
            </button>
          )}
          <form className="composer" onSubmit={onSubmit}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="向 Agent 团队描述你的任务…"
              rows={1}
              disabled={isStreaming}
            />
            <div className="composer-bar">
              <div className="composer-left">
                <div className="agent-select-wrap">
                  <button
                    type="button"
                    className="agent-select"
                    onClick={() => setAgentMenuOpen((value) => !value)}
                  >
                    <SelectedAgentIcon size={14} />
                    {selectedAgent.label}
                    <ChevronDown size={13} />
                  </button>
                  {agentMenuOpen && (
                    <div className="agent-menu">
                      {agentOptions.map((option) => {
                        const Icon = option.icon;
                        return (
                          <button
                            type="button"
                            key={option.id}
                            className={option.id === preferredAgent ? "active" : ""}
                            onClick={() => {
                              setPreferredAgent(option.id);
                              setAgentMenuOpen(false);
                            }}
                          >
                            <Icon size={14} />
                            {option.label}
                            {option.id === preferredAgent && <Check size={13} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="composer-tool"
                  onClick={() => setUploadOpen(true)}
                >
                  <Plus size={15} />
                  知识库
                </button>
              </div>
              <span className="composer-hint">
                <Command size={12} /> Enter 发送
              </span>
              <button
                className="send-button"
                type="submit"
                disabled={!input.trim() || isStreaming}
                title="发送"
              >
                <ArrowUp size={18} />
              </button>
            </div>
          </form>
          <p className="composer-disclaimer">
            Nexus Agent 可能产生不准确内容，请核验重要信息。
          </p>
        </div>
      </section>

      <div className={`inspector-desktop ${inspectorOpen ? "mobile-open" : ""}`}>
        <TracePanel
          routes={routes}
          steps={steps}
          sources={sources}
          documents={documents}
          streaming={isStreaming}
          onUpload={() => setUploadOpen(true)}
          onDeleteDocument={handleDeleteDocument}
          onClose={() => setInspectorOpen(false)}
        />
      </div>

      {uploadOpen && (
        <div className="modal-backdrop" onMouseDown={() => setUploadOpen(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">KNOWLEDGE INGESTION</span>
                <h2>导入知识文档</h2>
              </div>
              <button className="icon-button quiet" onClick={() => setUploadOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <label
              className={`upload-zone ${uploading ? "uploading" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleFile(event.dataTransfer.files[0]);
              }}
            >
              <input
                type="file"
                accept=".pdf,.docx,.md,.txt,.csv"
                onChange={(event) => void handleFile(event.target.files?.[0])}
                disabled={uploading}
              />
              <span className="upload-icon">
                {uploading ? <Activity size={26} /> : <UploadCloud size={26} />}
              </span>
              <strong>{uploading ? "正在切片与向量化…" : "拖放文件到这里"}</strong>
              <span>或点击选择文件</span>
              <small>支持 PDF、DOCX、Markdown、TXT、CSV，最大 8 MB</small>
            </label>
            <div className="upload-info">
              <FileText size={16} />
              <p>
                文档会被切分为带重叠的语义片段，写入当前知识库。回答时自动召回并展示引用。
              </p>
            </div>
            <div className="document-grid">
              {documents.slice(0, 6).map((document) => (
                <div className="document-card" key={document.id}>
                  <FileText size={16} />
                  <div>
                    <strong>{document.title}</strong>
                    <span>{document.chunks} 个片段</span>
                  </div>
                  <button onClick={() => handleDeleteDocument(document.id)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <div className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">RUNTIME STATUS</span>
                <h2>平台运行状态</h2>
              </div>
              <button className="icon-button quiet" onClick={() => setSettingsOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <div className="runtime-card">
              <div
                className={`runtime-status ${
                  health?.status === "ok" ? "online" : "offline"
                }`}
              >
                <span />
                {health?.status === "ok" ? "API 服务正常" : "API 服务离线"}
              </div>
              <div className="runtime-grid">
                <div>
                  <span>模型引擎</span>
                  <strong>{providerLabel}</strong>
                </div>
                <div>
                  <span>编排框架</span>
                  <strong>LangGraph</strong>
                </div>
                <div>
                  <span>RAG 存储</span>
                  <strong>
                    {health?.rag.backend ?? "-"}
                    {health?.rag.database ? ` · ${health.rag.database}` : ""}
                  </strong>
                </div>
                <div>
                  <span>嵌入模型</span>
                  <strong>{health?.rag.embedding ?? "-"}</strong>
                </div>
                <div>
                  <span>知识片段</span>
                  <strong>{health?.rag.chunks ?? 0}</strong>
                </div>
                <div>
                  <span>注册工具</span>
                  <strong>{health?.tools ?? 0}</strong>
                </div>
              </div>
            </div>
            <div className="config-note">
              <Cpu size={17} />
              <div>
                <strong>
                  {health?.demo_mode ? "当前为离线演示模式" : "当前为真实模型模式"}
                </strong>
                <p>
                  {health?.demo_mode
                    ? "完整 Agent 链路可用，无需 API Key。在 .env 中配置 LLM_API_KEY 后会切换为真实大模型。"
                    : "后端已连接 OpenAI 兼容模型接口，Agent 输出由真实模型生成。"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="toast">
          <Check size={15} />
          {notice}
        </div>
      )}
    </main>
  );
}

