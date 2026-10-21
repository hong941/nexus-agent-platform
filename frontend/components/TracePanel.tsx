"use client";

import {
  BookOpen,
  BrainCircuit,
  Calculator,
  Check,
  ChevronRight,
  Code2,
  FileText,
  LoaderCircle,
  Network,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type {
  KnowledgeDocument,
  RouteAgent,
  SourceItem,
  TraceStep,
} from "@/lib/types";

interface TracePanelProps {
  routes: RouteAgent[];
  steps: TraceStep[];
  sources: SourceItem[];
  documents: KnowledgeDocument[];
  streaming: boolean;
  onUpload: () => void;
  onDeleteDocument: (id: string) => void;
  onClose: () => void;
}

const agentIcons = {
  supervisor: Network,
  math: Calculator,
  code: Code2,
  knowledge: Search,
  synthesis: Sparkles,
};

function AgentOrbit({
  routes,
  streaming,
}: {
  routes: RouteAgent[];
  streaming: boolean;
}) {
  return (
    <div className="agent-orbit">
      <div className={`orbit-center ${streaming ? "is-working" : ""}`}>
        <BrainCircuit size={21} />
        <span>Supervisor</span>
      </div>
      <div className="orbit-line vertical" />
      <div className="orbit-agents">
        {routes.length === 0 && <span className="orbit-idle">等待任务</span>}
        {routes.map((route) => {
          const Icon = agentIcons[route.id];
          return (
            <div className={`orbit-agent ${route.id}`} key={route.id}>
              <span className="orbit-agent-icon">
                <Icon size={16} />
              </span>
              <span>{route.label}</span>
              {streaming ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <Check size={13} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TracePanel({
  routes,
  steps,
  sources,
  documents,
  streaming,
  onUpload,
  onDeleteDocument,
  onClose,
}: TracePanelProps) {
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <div>
          <div className="eyebrow">AGENT OBSERVATORY</div>
          <h2>执行观察台</h2>
        </div>
        <button className="icon-button quiet mobile-close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <AgentOrbit routes={routes} streaming={streaming} />

      <section className="inspector-section">
        <div className="inspector-title">
          <span>
            <Network size={15} />
            协作轨迹
          </span>
          <span className="count-badge">{steps.length}</span>
        </div>
        <div className="trace-list">
          {steps.length === 0 && (
            <div className="trace-empty">
              发送消息后，这里会展示 Agent 路由与工具调用。
            </div>
          )}
          {steps.map((step, index) => {
            const Icon =
              agentIcons[step.agent as keyof typeof agentIcons] ?? Network;
            return (
              <div className="trace-item" key={step.id}>
                <div className="trace-rail">
                  <span className={`trace-dot ${step.status}`}>
                    {step.status === "complete" ? (
                      <Check size={11} />
                    ) : (
                      <LoaderCircle size={11} className="spin" />
                    )}
                  </span>
                  {index < steps.length - 1 && <span className="trace-line" />}
                </div>
                <div className="trace-copy">
                  <div className="trace-heading">
                    <Icon size={14} />
                    {step.title}
                    {step.durationMs !== undefined && (
                      <span className="trace-time">{step.durationMs} ms</span>
                    )}
                  </div>
                  <p>{step.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="inspector-section source-section">
        <div className="inspector-title">
          <span>
            <BookOpen size={15} />
            引用来源
          </span>
          <span className="count-badge">{sources.length}</span>
        </div>
        <div className="source-list">
          {sources.length === 0 && (
            <div className="trace-empty">知识类回答会在这里陈列检索依据。</div>
          )}
          {sources.map((source, index) => (
            <details className="source-card" key={source.id} open={index === 0}>
              <summary>
                <span className="source-index">{index + 1}</span>
                <span className="source-title">{source.title}</span>
                <span className="source-score">
                  {Math.round(source.score * 100)}%
                </span>
                <ChevronRight size={14} className="source-chevron" />
              </summary>
              <p>{source.excerpt}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="inspector-section knowledge-section">
        <div className="inspector-title">
          <span>
            <FileText size={15} />
            知识库
          </span>
          <button className="mini-action" onClick={onUpload}>
            <Upload size={12} />
            上传
          </button>
        </div>
        <div className="knowledge-list">
          {documents.slice(0, 4).map((document) => (
            <div className="knowledge-item" key={document.id}>
              <span className="file-type">
                {document.filename.split(".").pop()?.slice(0, 3).toUpperCase()}
              </span>
              <div>
                <div className="knowledge-name">{document.title}</div>
                <div className="knowledge-meta">{document.chunks} 个片段</div>
              </div>
              <button
                className="knowledge-delete"
                onClick={() => onDeleteDocument(document.id)}
                title="删除文档"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

