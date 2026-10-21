from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .agents import CodeAgent, KnowledgeAgent, MathAgent
from .config import UPLOAD_DIR, settings
from .knowledge import extract_text, knowledge_base
from .llm import llm_service
from .orchestrator import AgentOrchestrator, ROUTE_LABELS
from .schemas import AgentInfo, ChatRequest, DocumentInfo, SourceItem
from .tools import tool_registry


app = FastAPI(
    title="Nexus Agent API",
    version="1.0.0",
    description="Multi-agent chat platform with LangGraph, tools, RAG and SSE.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
orchestrator = AgentOrchestrator(tool_registry)


AGENTS = [
    AgentInfo(
        id="supervisor",
        name="Supervisor",
        role="任务调度",
        description="识别意图、拆分任务并协调专业 Agent",
        color="#7c6cf2",
        tools=[],
    ),
    AgentInfo(
        id="math",
        name="数学 Agent",
        role="数值计算",
        description="处理算术、幂、三角与对数等可验证计算",
        color="#f2a65a",
        tools=["calculator", "current_time"],
    ),
    AgentInfo(
        id="code",
        name="代码 Agent",
        role="软件开发",
        description="生成代码、解释实现并执行安全静态检查",
        color="#38bdf8",
        tools=["code_inspector"],
    ),
    AgentInfo(
        id="knowledge",
        name="知识 Agent",
        role="知识问答",
        description="融合 RAG 知识库与通用知识回答，并提供可追溯来源",
        color="#39c895",
        tools=["knowledge_search"],
    ),
    AgentInfo(
        id="synthesis",
        name="Synthesis",
        role="结果综合",
        description="合并多个 Agent 的结论并生成最终响应",
        color="#f06a9f",
        tools=[],
    ),
]


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _stream_events(request: ChatRequest) -> AsyncIterator[str]:
    started = time.perf_counter()
    try:
        history = [message.model_dump() for message in request.history]
        initial = {
            "question": request.message,
            "history": history,
            "preferred_agent": request.preferred_agent,
            "current_index": 0,
        }
        yield _sse(
            "meta",
            {
                "conversation_id": request.conversation_id,
                "provider": settings.provider_label,
                "demo_mode": not settings.llm_enabled,
            },
        )
        final_state: dict[str, Any] = {}
        async for update in orchestrator.graph.astream(
            initial, stream_mode="updates"
        ):
            if "supervisor" in update:
                supervisor = update["supervisor"]
                yield _sse(
                    "route",
                    {
                        "agents": [
                            {
                                "id": route,
                                "label": ROUTE_LABELS[route],
                                "reason": supervisor.get("route_reasons", {}).get(route, ""),
                            }
                            for route in supervisor.get("routes", [])
                        ]
                    },
                )
                final_state.update(supervisor)
            for agent_id in ("math", "code", "knowledge"):
                if agent_id not in update:
                    continue
                node_data = update[agent_id]
                final_state["current_index"] = node_data.get("current_index", 0)
                results = node_data.get("results", [])
                final_state.setdefault("results", []).extend(results)
                if results:
                    result = results[0]
                    for tool in result.get("tools", []):
                        yield _sse(
                            "step",
                            {
                                "agent": agent_id,
                                "type": "tool",
                                "title": tool["display_name"],
                                "detail": tool["summary"],
                                "duration_ms": tool["duration_ms"],
                                "status": "complete",
                            },
                        )
                    if result.get("sources"):
                        yield _sse("sources", {"sources": result["sources"]})
            if "synthesis" in update:
                answer = update["synthesis"].get("answer", "")
                final_state["answer"] = answer
                words = list(answer)
                buffer = ""
                for index, character in enumerate(words):
                    buffer += character
                    if len(buffer) >= 5 or character in "。！？\n" or index == len(words) - 1:
                        yield _sse("token", {"delta": buffer})
                        buffer = ""
                        await asyncio.sleep(0.008)

        results = final_state.get("results", [])
        sources: list[dict[str, Any]] = []
        seen = set()
        for result in results:
            for source in result.get("sources", []):
                if source["id"] not in seen:
                    seen.add(source["id"])
                    sources.append(source)
        yield _sse(
            "done",
            {
                "agents": [result["agent"] for result in results],
                "tools": sum(len(result.get("tools", [])) for result in results),
                "sources": len(sources),
                "duration_ms": round((time.perf_counter() - started) * 1000),
            },
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        yield _sse("error", {"message": f"生成回复失败：{exc}"})


@app.get("/api/health")
async def health() -> dict[str, Any]:
    stats = knowledge_base.stats()
    return {
        "status": "ok",
        "service": settings.app_name,
        "provider": settings.provider_label,
        "demo_mode": not settings.llm_enabled,
        "llm_configured": settings.llm_enabled,
        "rag": stats,
        "tools": len(tool_registry.all()),
        "graph": "langgraph",
    }


@app.get("/api/agents", response_model=list[AgentInfo])
async def agents() -> list[AgentInfo]:
    return AGENTS


@app.get("/api/models")
async def models() -> dict[str, Any]:
    return {
        "items": [
            {
                "id": settings.llm_model if settings.llm_enabled else "nexus-demo",
                "name": settings.provider_label,
                "active": True,
                "mode": "live" if settings.llm_enabled else "demo",
            }
        ]
    }


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    return StreamingResponse(
        _stream_events(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/knowledge/documents", response_model=list[DocumentInfo])
async def documents() -> list[dict[str, Any]]:
    return knowledge_base.list_documents()


@app.post("/api/knowledge/upload", response_model=DocumentInfo, status_code=201)
async def upload_document(file: UploadFile = File(...)) -> dict[str, Any]:
    filename = Path(file.filename or "document.txt").name
    payload = await file.read()
    if len(payload) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"文件不能超过 {settings.max_upload_mb} MB")
    if not payload:
        raise HTTPException(400, "文件为空")
    try:
        content = extract_text(filename, payload)
        title = Path(filename).stem
        document = knowledge_base.add_document(title, filename, content)
        safe_name = f"{document.id}_{filename}"
        (UPLOAD_DIR / safe_name).write_bytes(payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "id": document.id,
        "title": document.title,
        "filename": document.filename,
        "chunks": sum(
            1
            for chunk in knowledge_base.chunks.values()
            if chunk.document_id == document.id
        ),
        "size": document.size,
        "created_at": document.created_at,
    }


@app.delete("/api/knowledge/documents/{document_id}")
async def delete_document(document_id: str) -> dict[str, bool]:
    if not knowledge_base.delete_document(document_id):
        raise HTTPException(404, "文档不存在")
    return {"ok": True}


@app.get("/api/knowledge/search")
async def search_knowledge(q: str, limit: int = 5) -> dict[str, Any]:
    limit = max(1, min(limit, 10))
    return {"items": knowledge_base.search(q, top_k=limit)}

