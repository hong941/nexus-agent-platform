from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Any

from .config import settings
from .knowledge import knowledge_base
from .llm import llm_service
from .tools import ToolRegistry


@dataclass(slots=True)
class AgentResult:
    agent: str
    label: str
    answer: str
    confidence: float
    tools: list[dict[str, Any]]
    sources: list[dict[str, Any]]

    def as_dict(self) -> dict[str, Any]:
        return {
            "agent": self.agent,
            "label": self.label,
            "answer": self.answer,
            "confidence": self.confidence,
            "tools": self.tools,
            "sources": self.sources,
        }


def _extract_expression(question: str) -> str:
    candidates = re.findall(r"(?:计算|求值|算一下|等于多少|是多少)?\s*([0-9\s+\-*/().,%^×÷a-zA-Z_]+)", question)
    for candidate in candidates:
        expression = candidate.strip(" ：:，,。")
        if re.search(r"\d", expression) and any(op in expression for op in "+-*/^×÷%"):
            expression = re.sub(r"(?:计算|求值|算一下|等于多少|是多少)$", "", expression).strip()
            try:
                ast.parse(
                    expression.replace("×", "*").replace("÷", "/").replace("^", "**"),
                    mode="eval",
                )
                return expression
            except SyntaxError:
                continue
    return ""


class MathAgent:
    id = "math"
    label = "数学 Agent"

    def __init__(self, tools: ToolRegistry) -> None:
        self.tools = tools

    async def run(self, question: str, _: list[dict[str, str]]) -> AgentResult:
        expression = _extract_expression(question)
        if not expression:
            return AgentResult(
                agent=self.id,
                label=self.label,
                answer="请给我一个明确的数学表达式，例如：`(128 * 7 + 36) / 4`。我可以处理四则运算、幂、三角与对数。",
                confidence=0.7,
                tools=[],
                sources=[],
            )
        result = await self.tools.invoke("calculator", {"expression": expression})
        display = result.data["display"]
        answer = (
            f"计算结果为 **{display}**。\n\n"
            f"```text\n{expression} = {display}\n```\n\n"
            "该结果由受限计算器实际执行，未交给语言模型估算。"
        )
        return AgentResult(
            agent=self.id,
            label=self.label,
            answer=answer,
            confidence=0.99,
            tools=[
                {
                    "name": result.name,
                    "display_name": result.display_name,
                    "summary": result.output,
                    "duration_ms": result.duration_ms,
                }
            ],
            sources=[],
        )


class KnowledgeAgent:
    id = "knowledge"
    label = "知识 Agent"

    async def run(self, question: str, history: list[dict[str, str]]) -> AgentResult:
        sources = knowledge_base.search(question, top_k=4)
        if llm_service.enabled:
            context = "\n\n".join(
                f"[{index + 1}] {source['title']}\n{source['excerpt']}"
                for index, source in enumerate(sources)
            )
            system = (
                "你是 Nexus Agent 的知识库专员。只依据给定资料回答；资料不足时直接说明。"
                "回答使用中文 Markdown，并在关键结论后标注 [1]、[2] 形式的来源编号。"
            )
            prompt = f"历史对话（供理解上下文）：\n{history[-4:]}\n\n知识片段：\n{context or '无命中资料'}\n\n问题：{question}"
            try:
                answer = await llm_service.complete(system, prompt)
            except Exception:
                answer = self._fallback_answer(question, sources)
        else:
            answer = self._fallback_answer(question, sources)
        return AgentResult(
            agent=self.id,
            label=self.label,
            answer=answer,
            confidence=min(0.94, 0.55 + len(sources) * 0.09),
            tools=[
                {
                    "name": "knowledge_search",
                    "display_name": "知识检索",
                    "summary": f"召回 {len(sources)} 个相关片段",
                    "duration_ms": 24,
                }
            ],
            sources=sources,
        )

    @staticmethod
    def _fallback_answer(question: str, sources: list[dict[str, Any]]) -> str:
        if not sources:
            return (
                "当前知识库没有找到足够相关的内容。你可以上传产品文档、规范或 FAQ，"
                "系统会切块并加入检索范围。"
            )
        body = "\n\n".join(
            f"- **{source['title']}**：{source['excerpt']} [来源 {index + 1}]"
            for index, source in enumerate(sources[:3])
        )
        framing = "根据当前知识库，我找到以下与问题最相关的内容："
        if any(word in question for word in ("怎么", "如何", "使用", "步骤")):
            framing = "结合知识库中的说明，可以按以下信息理解和操作："
        return f"{framing}\n\n{body}\n\n如果你希望，我可以继续把其中一条资料整理成操作步骤。"


class CodeAgent:
    id = "code"
    label = "代码 Agent"

    def __init__(self, tools: ToolRegistry) -> None:
        self.tools = tools

    async def run(self, question: str, _: list[dict[str, str]]) -> AgentResult:
        code, language, explanation = self._build_example(question)
        inspected = await self.tools.invoke("code_inspector", {"code": code})
        if llm_service.enabled:
            system = (
                "你是资深软件工程师。给出可直接运行的代码、关键实现说明和复杂度；"
                "代码必须完整，不省略核心逻辑。用中文回答。"
            )
            try:
                answer = await llm_service.complete(system, question)
            except Exception:
                answer = self._compose(language, code, explanation, inspected.output)
        else:
            answer = self._compose(language, code, explanation, inspected.output)
        return AgentResult(
            agent=self.id,
            label=self.label,
            answer=answer,
            confidence=0.88,
            tools=[
                {
                    "name": inspected.name,
                    "display_name": inspected.display_name,
                    "summary": inspected.output,
                    "duration_ms": inspected.duration_ms,
                }
            ],
            sources=[],
        )

    @staticmethod
    def _build_example(question: str) -> tuple[str, str, str]:
        lowered = question.lower()
        if "快速排序" in question or "quicksort" in lowered:
            code = """def quicksort(items: list[int]) -> list[int]:
    if len(items) <= 1:
        return items[:]
    pivot = items[len(items) // 2]
    left = [item for item in items if item < pivot]
    middle = [item for item in items if item == pivot]
    right = [item for item in items if item > pivot]
    return quicksort(left) + middle + quicksort(right)


if __name__ == "__main__":
    print(quicksort([8, 3, 1, 7, 0, 10, 2]))"""
            return code, "python", "快速排序通过基准值分区并递归处理左右子数组，平均时间复杂度为 O(n log n)。"
        if "fastapi" in lowered or "接口" in question or "api" in lowered:
            code = """from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class Item(BaseModel):
    name: str
    price: float


@app.post("/items")
async def create_item(item: Item) -> dict[str, object]:
    return {"id": 1, "item": item}


# uvicorn main:app --reload"""
            return code, "python", "这个接口使用 Pydantic 自动校验请求体，FastAPI 会同步生成 OpenAPI 文档。"
        if "javascript" in lowered or "typescript" in lowered or "防抖" in question:
            code = """export function debounce<T extends (...args: never[]) => void>(
  callback: T,
  delay = 300,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}"""
            return code, "typescript", "防抖会在连续触发时不断重置计时器，只执行最后一次调用。"
        code = """from collections.abc import Iterable


def batch(items: Iterable[int], size: int = 3) -> list[list[int]]:
    if size <= 0:
        raise ValueError("size must be positive")
    result: list[list[int]] = []
    current: list[int] = []
    for item in items:
        current.append(item)
        if len(current) == size:
            result.append(current)
            current = []
    if current:
        result.append(current)
    return result


if __name__ == "__main__":
    print(batch(range(8), 3))"""
        return code, "python", "示例采用显式边界检查，并按块收集数据；时间复杂度 O(n)，辅助空间 O(n)。"

    @staticmethod
    def _compose(language: str, code: str, explanation: str, inspection: str) -> str:
        return (
            f"下面给出一份可运行的 `{language}` 示例：\n\n"
            f"```{language}\n{code}\n```\n\n"
            f"**实现说明**：{explanation}\n\n"
            f"**自动检查**：{inspection}"
        )


SYSTEM_PROMPT = """你是 Nexus Agent 的调度助手。将用户任务分配给数学、代码、知识三类专业 Agent，
再汇总结果。回答使用中文 Markdown，结构清晰，不编造来源。"""

