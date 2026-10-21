from __future__ import annotations

import operator
import re
from typing import Annotated, Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from .agents import CodeAgent, KnowledgeAgent, MathAgent
from .llm import llm_service, messages_to_prompt
from .tools import ToolRegistry


class AgentState(TypedDict, total=False):
    question: str
    history: list[dict[str, str]]
    preferred_agent: str
    routes: list[str]
    route_reasons: dict[str, str]
    current_index: int
    results: Annotated[list[dict[str, Any]], operator.add]
    answer: str


ROUTE_LABELS = {
    "math": "数学 Agent",
    "code": "代码 Agent",
    "knowledge": "知识 Agent",
}


def choose_routes(question: str, preferred: str = "auto") -> tuple[list[str], dict[str, str]]:
    if preferred in {"math", "code", "knowledge"}:
        return [preferred], {preferred: "用户手动指定了专业 Agent"}

    lowered = question.lower()
    routes: list[str] = []
    reasons: dict[str, str] = {}

    math_score = 0
    if re.search(r"\d+\s*[+\-*/^×÷%]\s*\d+", question):
        math_score += 3
    if any(word in question for word in ("计算", "求值", "等于多少", "方程", "概率", "对数")):
        math_score += 2
    if math_score >= 2:
        routes.append("math")
        reasons["math"] = "检测到数值计算或数学求解意图"

    code_score = 0
    if any(
        word in lowered
        for word in (
            "代码",
            "python",
            "java",
            "typescript",
            "javascript",
            "fastapi",
            "react",
            "函数",
            "算法",
            "报错",
            "sql",
            "接口",
        )
    ):
        code_score += 3
    if code_score >= 2:
        routes.append("code")
        reasons["code"] = "检测到编程、接口或算法相关任务"

    knowledge_words = (
        "知识库",
        "文档",
        "资料",
        "产品",
        "平台",
        "rag",
        "chroma",
        "bge",
        "是什么",
        "如何",
        "怎么",
        "规范",
        "原理",
        "来源",
    )
    if any(word in lowered for word in knowledge_words) or not routes:
        routes.append("knowledge")
        reasons["knowledge"] = (
            "需要检索业务知识并给出可追溯回答"
            if any(word in lowered for word in knowledge_words)
            else "未命中专业工具，使用知识 Agent 进行通用问答"
        )
    return list(dict.fromkeys(routes)), reasons


class AgentOrchestrator:
    def __init__(self, tools: ToolRegistry) -> None:
        self.tools = tools
        self.math_agent = MathAgent(tools)
        self.code_agent = CodeAgent(tools)
        self.knowledge_agent = KnowledgeAgent()
        self.graph = self._build_graph()

    def _supervisor(self, state: AgentState) -> dict[str, Any]:
        routes, reasons = choose_routes(
            state["question"], state.get("preferred_agent", "auto")
        )
        return {
            "routes": routes,
            "route_reasons": reasons,
            "current_index": 0,
            "results": [],
        }

    def _route_next(self, _: AgentState) -> dict[str, Any]:
        return {}

    def _choose_next(self, state: AgentState) -> str:
        index = state.get("current_index", 0)
        routes = state.get("routes", [])
        if index >= len(routes):
            return "synthesis"
        return routes[index]

    async def _math(self, state: AgentState) -> dict[str, Any]:
        result = await self.math_agent.run(state["question"], state.get("history", []))
        return {
            "results": [result.as_dict()],
            "current_index": state.get("current_index", 0) + 1,
        }

    async def _code(self, state: AgentState) -> dict[str, Any]:
        result = await self.code_agent.run(state["question"], state.get("history", []))
        return {
            "results": [result.as_dict()],
            "current_index": state.get("current_index", 0) + 1,
        }

    async def _knowledge(self, state: AgentState) -> dict[str, Any]:
        result = await self.knowledge_agent.run(state["question"], state.get("history", []))
        return {
            "results": [result.as_dict()],
            "current_index": state.get("current_index", 0) + 1,
        }

    async def _synthesis(self, state: AgentState) -> dict[str, Any]:
        results = state.get("results", [])
        if not results:
            return {"answer": "未能生成有效结果，请换一种方式描述问题。"}
        if len(results) == 1:
            answer = results[0]["answer"]
        else:
            sections = [
                f"### {result['label']}\n\n{result['answer']}" for result in results
            ]
            answer = (
                "我已协调多个专业 Agent 共同处理这个问题：\n\n"
                + "\n\n---\n\n".join(sections)
            )
        if llm_service.enabled and len(results) > 1:
            try:
                synthesis_input = "\n\n".join(
                    f"{item['label']}：{item['answer']}" for item in results
                )
                answer = await llm_service.complete(
                    "合并多个专业 Agent 的回答，消除重复，保留关键数据与来源标注。",
                    f"用户问题：{state['question']}\n\n各 Agent 结果：\n{synthesis_input}",
                )
            except Exception:
                pass
        return {"answer": answer}

    def _build_graph(self) -> Any:
        graph = StateGraph(AgentState)
        graph.add_node("supervisor", self._supervisor)
        graph.add_node("route_next", self._route_next)
        graph.add_node("math", self._math)
        graph.add_node("code", self._code)
        graph.add_node("knowledge", self._knowledge)
        graph.add_node("synthesis", self._synthesis)

        graph.add_edge(START, "supervisor")
        graph.add_edge("supervisor", "route_next")
        graph.add_edge("math", "route_next")
        graph.add_edge("code", "route_next")
        graph.add_edge("knowledge", "route_next")
        graph.add_conditional_edges(
            "route_next",
            self._choose_next,
            {
                "math": "math",
                "code": "code",
                "knowledge": "knowledge",
                "synthesis": "synthesis",
            },
        )
        graph.add_edge("synthesis", END)
        return graph.compile()

    async def run(
        self,
        question: str,
        history: list[dict[str, str]],
        preferred_agent: str = "auto",
    ) -> AgentState:
        initial: AgentState = {
            "question": question,
            "history": history,
            "preferred_agent": preferred_agent,
        }
        return await self.graph.ainvoke(initial)

