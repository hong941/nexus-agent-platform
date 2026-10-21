import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus Agent | 多 Agent 智能对话平台",
  description:
    "基于 LangGraph、FastAPI、SSE 与 RAG 的多 Agent 智能对话平台。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

