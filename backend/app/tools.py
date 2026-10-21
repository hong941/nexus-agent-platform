from __future__ import annotations

import ast
import math
import operator
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable


ToolHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass(slots=True)
class ToolSpec:
    name: str
    display_name: str
    description: str
    agent: str
    handler: ToolHandler


@dataclass(slots=True)
class ToolResult:
    name: str
    display_name: str
    output: str
    duration_ms: int
    data: dict[str, Any]


class ToolRegistry:
    """Small, explicit tool registry used by the specialist agents."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"Tool already registered: {spec.name}")
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec:
        try:
            return self._tools[name]
        except KeyError as exc:
            raise KeyError(f"Unknown tool: {name}") from exc

    def for_agent(self, agent: str) -> list[dict[str, str]]:
        return [
            {"name": tool.name, "display_name": tool.display_name, "description": tool.description}
            for tool in self._tools.values()
            if tool.agent == agent
        ]

    def all(self) -> list[ToolSpec]:
        return list(self._tools.values())

    async def invoke(self, name: str, args: dict[str, Any]) -> ToolResult:
        tool = self.get(name)
        started = time.perf_counter()
        data = await tool.handler(args)
        duration = max(1, round((time.perf_counter() - started) * 1000))
        output = str(data.get("summary") or data.get("output") or "工具调用完成")
        return ToolResult(
            name=tool.name,
            display_name=tool.display_name,
            output=output,
            duration_ms=duration,
            data=data,
        )


_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_BINARY = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_SAFE_FUNCTIONS = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sum": sum,
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log,
    "log10": math.log10,
    "exp": math.exp,
    "pi": math.pi,
    "e": math.e,
}


def _eval_expression(node: ast.AST) -> int | float:
    if isinstance(node, ast.Expression):
        return _eval_expression(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_eval_expression(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        left, right = _eval_expression(node.left), _eval_expression(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("指数过大")
        return _BINARY[type(node.op)](left, right)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        function = _SAFE_FUNCTIONS.get(node.func.id)
        if not callable(function):
            raise ValueError(f"不允许的函数: {node.func.id}")
        if node.keywords:
            raise ValueError("不允许关键字参数")
        return function(*(_eval_expression(arg) for arg in node.args))
    if isinstance(node, ast.Name) and node.id in _SAFE_FUNCTIONS:
        value = _SAFE_FUNCTIONS[node.id]
        if not isinstance(value, (int, float)):
            raise ValueError(f"常量不可直接使用: {node.id}")
        return value
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_eval_expression(item) for item in node.elts]  # type: ignore[return-value]
    raise ValueError("表达式包含不支持的语法")


def calculate_expression(expression: str) -> tuple[str, float]:
    normalized = (
        expression.replace("×", "*")
        .replace("÷", "/")
        .replace("^", "**")
        .replace("，", ",")
        .strip()
    )
    tree = ast.parse(normalized, mode="eval")
    value = _eval_expression(tree)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("结果不是有限数值")
        display = f"{value:.10g}"
    else:
        display = str(value)
    return display, float(value)


async def calculator_handler(args: dict[str, Any]) -> dict[str, Any]:
    expression = str(args.get("expression", "")).strip()
    if not expression:
        raise ValueError("缺少 expression 参数")
    display, value = calculate_expression(expression)
    return {
        "expression": expression,
        "result": value,
        "display": display,
        "summary": f"{expression} = {display}",
    }


async def datetime_handler(_: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now().astimezone()
    formatted = now.strftime("%Y年%m月%d日 %H:%M:%S %Z")
    return {"datetime": formatted, "summary": formatted}


async def code_inspector_handler(args: dict[str, Any]) -> dict[str, Any]:
    code = str(args.get("code", ""))
    issues: list[str] = []
    if "\t" in code:
        issues.append("检测到 Tab 缩进，建议统一为 4 个空格")
    if len(code.splitlines()) > 80:
        issues.append("代码超过 80 行，建议按职责拆分")
    if "except:" in code:
        issues.append("避免裸 except，请捕获明确异常")
    if not issues:
        issues.append("未发现明显的结构性风险")
    return {
        "issues": issues,
        "line_count": len(code.splitlines()),
        "summary": "；".join(issues),
    }


def build_tool_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="calculator",
            display_name="安全计算器",
            description="计算算术、幂、三角与对数表达式",
            agent="math",
            handler=calculator_handler,
        )
    )
    registry.register(
        ToolSpec(
            name="current_time",
            display_name="时间工具",
            description="获取当前时区时间",
            agent="math",
            handler=datetime_handler,
        )
    )
    registry.register(
        ToolSpec(
            name="code_inspector",
            display_name="代码检查器",
            description="对生成代码执行轻量结构与安全规则检查",
            agent="code",
            handler=code_inspector_handler,
        )
    )
    return registry


tool_registry = build_tool_registry()

