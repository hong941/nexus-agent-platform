from __future__ import annotations

import sqlite3

import pytest

from app.agents import KnowledgeAgent
from app.knowledge import DATABASE_PATH, knowledge_base
from app.llm import llm_service
from app.math_parser import normalize_math_expression
from app.orchestrator import AgentOrchestrator, choose_routes
from app.tools import build_tool_registry, calculate_expression


def test_math_routes_and_tool() -> None:
    routes, _ = choose_routes("请计算 (128 * 7 + 36) / 4")
    assert "math" in routes
    display, value = calculate_expression("(128 * 7 + 36) / 4")
    assert value == 233
    assert display == "233"


def test_code_routes() -> None:
    routes, reasons = choose_routes("用 Python 写一个快速排序函数")
    assert routes == ["code"]
    assert reasons["code"]


def test_combined_task_routes_to_multiple_agents() -> None:
    routes, reasons = choose_routes("用 Python 写一个函数，计算 (128 * 7 + 36) / 4")
    assert routes == ["math", "code"]
    assert set(reasons) == {"math", "code"}


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("五的11次方", 48_828_125),
        ("二的十次方", 1024),
        ("三加五乘二", 13),
        ("根号九", 3),
        ("四分之八", 2),
    ],
)
def test_natural_language_math(question: str, expected: int) -> None:
    expression = normalize_math_expression(question)
    _, value = calculate_expression(expression)
    assert value == expected


def test_knowledge_search_returns_sources() -> None:
    sources = knowledge_base.search("Nexus Agent 如何支持 RAG 和来源引用", top_k=3)
    assert sources
    assert sources[0]["title"]
    assert sources[0]["excerpt"]
    assert knowledge_base.stats()["backend"] == "sqlite"
    assert DATABASE_PATH.is_file()
    with sqlite3.connect(DATABASE_PATH) as connection:
        document_count = connection.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        chunk_count = connection.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
    assert document_count >= 3
    assert chunk_count >= 3


@pytest.mark.asyncio
async def test_graph_runs_end_to_end() -> None:
    orchestrator = AgentOrchestrator(build_tool_registry())
    state = await orchestrator.run("计算 19 * 23 + 6", [], preferred_agent="auto")
    assert "math" in state["routes"]
    assert state["results"][0]["agent"] == "math"
    assert "443" in state["answer"]


@pytest.mark.asyncio
async def test_chinese_power_question_routes_to_math_agent() -> None:
    orchestrator = AgentOrchestrator(build_tool_registry())
    state = await orchestrator.run("五的11次方", [], preferred_agent="auto")
    assert state["routes"] == ["math"]
    assert state["results"][0]["agent"] == "math"
    assert "48828125" in state["answer"]


@pytest.mark.asyncio
async def test_knowledge_agent_answers_without_rag_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    async def fake_complete(
        system: str,
        user: str,
        **_: object,
    ) -> str:
        captured["system"] = system
        captured["user"] = user
        return "> 知识库未命中，以下为通用知识回答。\n\n量子计算利用量子比特完成并行计算。"

    monkeypatch.setattr(llm_service, "enabled", True)
    monkeypatch.setattr(llm_service, "complete", fake_complete)
    monkeypatch.setattr(knowledge_base, "search", lambda *_args, **_kwargs: [])

    result = await KnowledgeAgent().run("量子计算的基本原理是什么？", [])

    assert result.sources == []
    assert result.answer.startswith("> 知识库未命中")
    assert "通用知识" in captured["system"]
    assert "不要声称资料中没有答案" in captured["system"]
    assert "知识库未命中" in result.tools[0]["summary"]


@pytest.mark.asyncio
async def test_knowledge_agent_uses_history_for_follow_up(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    async def fake_complete(system: str, user: str, **_: object) -> str:
        captured["system"] = system
        captured["user"] = user
        return "RAG 的优势包括引用可追溯和降低幻觉。"

    monkeypatch.setattr(llm_service, "enabled", True)
    monkeypatch.setattr(llm_service, "complete", fake_complete)
    monkeypatch.setattr(knowledge_base, "search", lambda *_args, **_kwargs: [])

    history = [{"role": "user", "content": "请介绍一下 RAG"}]
    await KnowledgeAgent().run("它有什么优点？", history)

    assert "请介绍一下 RAG 它有什么优点？" in captured["user"]

