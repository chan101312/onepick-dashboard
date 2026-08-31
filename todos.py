import json
import os
import uuid
from datetime import date
from threading import Lock

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

TODO_FILE = "todos.json"
_lock = Lock()


class TodoIn(BaseModel):
    text: str
    due_date: str


class TodoUpdate(BaseModel):
    text: str | None = None
    due_date: str | None = None
    done: bool | None = None


def _load_todos() -> list[dict]:
    if not os.path.exists(TODO_FILE):
        return []
    try:
        with open(TODO_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_todos(todos: list[dict]):
    with open(TODO_FILE, "w", encoding="utf-8") as f:
        json.dump(todos, f, ensure_ascii=False, indent=2)


@router.get("/api/todos")
def list_todos():
    with _lock:
        return {"status": "success", "data": _load_todos()}


@router.post("/api/todos")
def create_todo(payload: TodoIn):
    text = payload.text.strip()
    if not text:
        return {"status": "error", "message": "할 일 내용을 입력해주세요."}
    try:
        date.fromisoformat(payload.due_date)
    except Exception:
        return {"status": "error", "message": "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)."}
    with _lock:
        todos = _load_todos()
        todo = {
            "id": uuid.uuid4().hex,
            "text": text,
            "due_date": payload.due_date,
            "done": False,
            "created_at": date.today().isoformat(),
        }
        todos.append(todo)
        _save_todos(todos)
    return {"status": "success", "data": todo}


@router.put("/api/todos/{todo_id}")
def update_todo(todo_id: str, payload: TodoUpdate):
    with _lock:
        todos = _load_todos()
        target = next((t for t in todos if t.get("id") == todo_id), None)
        if not target:
            return {"status": "error", "message": "할 일을 찾을 수 없습니다."}
        updates = payload.model_dump(exclude_unset=True)
        if "text" in updates:
            cleaned = str(updates["text"]).strip()
            if not cleaned:
                return {"status": "error", "message": "할 일 내용을 입력해주세요."}
            updates["text"] = cleaned
        if "due_date" in updates:
            try:
                date.fromisoformat(updates["due_date"])
            except Exception:
                return {"status": "error", "message": "날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)."}
        target.update(updates)
        _save_todos(todos)
    return {"status": "success", "data": target}


@router.delete("/api/todos/{todo_id}")
def delete_todo(todo_id: str):
    with _lock:
        todos = _load_todos()
        remaining = [t for t in todos if t.get("id") != todo_id]
        if len(remaining) == len(todos):
            return {"status": "error", "message": "할 일을 찾을 수 없습니다."}
        _save_todos(remaining)
    return {"status": "success"}
