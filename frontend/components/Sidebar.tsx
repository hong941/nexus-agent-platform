"use client";

import {
  Bot,
  ChevronLeft,
  History,
  MessageSquarePlus,
  PanelLeftClose,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Conversation } from "@/lib/types";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string;
  collapsed: boolean;
  onToggle: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function relativeDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今天";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function Sidebar({
  conversations,
  activeId,
  collapsed,
  onToggle,
  onNew,
  onSelect,
  onDelete,
}: SidebarProps) {
  if (collapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <button className="icon-button sidebar-expand" onClick={onToggle} title="展开侧栏">
          <ChevronLeft size={18} className="rotate-180" />
        </button>
        <button className="brand-mark compact" onClick={onToggle}>
          <Sparkles size={19} />
        </button>
        <button className="icon-button" onClick={onNew} title="新对话">
          <MessageSquarePlus size={19} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={19} />
          </div>
          <div>
            <div className="brand-name">Nexus Agent</div>
            <div className="brand-caption">MULTI-AGENT STUDIO</div>
          </div>
        </div>
        <button className="icon-button quiet" onClick={onToggle} title="收起侧栏">
          <PanelLeftClose size={18} />
        </button>
      </div>

      <button className="new-chat-button" onClick={onNew}>
        <MessageSquarePlus size={18} />
        开始新对话
        <span className="shortcut">N</span>
      </button>

      <div className="sidebar-section-title">
        <History size={14} />
        最近对话
      </div>
      <div className="conversation-list">
        {conversations.length === 0 && (
          <div className="empty-history">你的对话会保存在这里</div>
        )}
        {conversations.map((conversation) => (
          <button
            key={conversation.id}
            className={`conversation-item ${
              activeId === conversation.id ? "active" : ""
            }`}
            onClick={() => onSelect(conversation.id)}
          >
            <span className="conversation-icon">
              <Bot size={15} />
            </span>
            <span className="conversation-copy">
              <span className="conversation-title">{conversation.title}</span>
              <span className="conversation-date">
                {relativeDate(conversation.updatedAt)}
              </span>
            </span>
            <span
              className="conversation-delete"
              role="button"
              tabIndex={0}
              title="删除对话"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(conversation.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") onDelete(conversation.id);
              }}
            >
              <Trash2 size={13} />
            </span>
          </button>
        ))}
      </div>

      <div className="sidebar-bottom">
        <div className="workspace-card">
          <div className="workspace-avatar">N</div>
          <div>
            <div className="workspace-name">个人工作区</div>
            <div className="workspace-plan">数据隐私优先</div>
          </div>
          <span className="online-dot" />
        </div>
      </div>
    </aside>
  );
}

