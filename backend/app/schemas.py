from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


AgentId = Literal["supervisor", "math", "code", "knowledge", "synthesis"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12_000)
    conversation_id: str = Field(default="local", max_length=120)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)
    preferred_agent: Literal["auto", "math", "code", "knowledge"] = "auto"


class AgentInfo(BaseModel):
    id: AgentId
    name: str
    role: str
    description: str
    color: str
    tools: list[str]


class SourceItem(BaseModel):
    id: str
    title: str
    excerpt: str
    score: float
    document_id: str
    chunk_index: int


class DocumentInfo(BaseModel):
    id: str
    title: str
    filename: str
    chunks: int
    size: int
    created_at: str

