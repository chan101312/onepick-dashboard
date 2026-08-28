import json
import os
import uuid
from datetime import datetime
from threading import Lock

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

FREEFORM_FILE = "memo_freeform.json"  # 자유메모장(긴 텍스트 하나)
MEMOS_FILE = "memo_cards.json"        # 개별 메모 카드 여러 개
_lock = Lock()


class FreeformIn(BaseModel):
    text: str


class MemoStyle(BaseModel):
    font_size: int | None = None       # 텍스트 크기(px)
    color: str | None = None           # 텍스트 색상(hex)
    align: str | None = None           # "left" | "center" | "right"
    width: int | None = None           # 카드 너비(px)
    height: int | None = None          # 카드 높이(px)


class MemoIn(BaseModel):
    text: str


class MemoUpdate(BaseModel):
    text: str


class MemoStyleUpdate(BaseModel):
    style: MemoStyle


class MemoOrderUpdate(BaseModel):
    ordered_ids: list[str]  # 새로운 순서대로 나열된 메모 id 목록


def _load_freeform() -> str:
    if not os.path.exists(FREEFORM_FILE):
        return ""
    try:
        with open(FREEFORM_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("text", "")
    except Exception:
        return ""


def _save_freeform(text: str):
    with open(FREEFORM_FILE, "w", encoding="utf-8") as f:
        json.dump({"text": text}, f, ensure_ascii=False, indent=2)


def _load_memos() -> list[dict]:
    if not os.path.exists(MEMOS_FILE):
        return []
    try:
        with open(MEMOS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_memos(memos: list[dict]):
    with open(MEMOS_FILE, "w", encoding="utf-8") as f:
        json.dump(memos, f, ensure_ascii=False, indent=2)


@router.get("/api/memos/freeform")
def get_freeform():
    with _lock:
        return {"status": "success", "text": _load_freeform()}


@router.put("/api/memos/freeform")
def save_freeform(payload: FreeformIn):
    with _lock:
        _save_freeform(payload.text)
    return {"status": "success"}


@router.get("/api/memos")
def list_memos():
    with _lock:
        memos = _load_memos()
    memos.sort(key=lambda m: m.get("order", 10**9))
    return {"status": "success", "data": memos}


@router.post("/api/memos")
def create_memo(payload: MemoIn):
    text = payload.text.strip()
    if not text:
        return {"status": "error", "message": "메모 내용을 입력해주세요."}
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with _lock:
        memos = _load_memos()
        max_order = max((m.get("order", 0) for m in memos), default=-1)
        memo = {
            "id": uuid.uuid4().hex, "text": text, "created_at": now, "updated_at": now,
            "order": max_order + 1,
            "style": {"font_size": 13, "color": None, "align": "left", "width": None, "height": None},
        }
        memos.append(memo)
        _save_memos(memos)
    return {"status": "success", "data": memo}


@router.put("/api/memos/reorder")
def reorder_memos(payload: "MemoOrderUpdate"):
    """드래그앤드롭으로 재배치된 순서를 한번에 저장한다.
    ordered_ids에 나열된 순서대로 order 필드를 0,1,2...로 다시 매긴다."""
    with _lock:
        memos = _load_memos()
        by_id = {m["id"]: m for m in memos}
        for idx, memo_id in enumerate(payload.ordered_ids):
            if memo_id in by_id:
                by_id[memo_id]["order"] = idx
        # ordered_ids에 없는(누락된) 메모는 맨 뒤로 밀어서 순서 유지
        missing = [m for m in memos if m["id"] not in payload.ordered_ids]
        next_order = len(payload.ordered_ids)
        for m in missing:
            m["order"] = next_order
            next_order += 1
        _save_memos(memos)
    return {"status": "success"}


@router.put("/api/memos/{memo_id}")
def update_memo(memo_id: str, payload: MemoUpdate):
    text = payload.text.strip()
    if not text:
        return {"status": "error", "message": "메모 내용을 입력해주세요."}
    with _lock:
        memos = _load_memos()
        target = next((m for m in memos if m.get("id") == memo_id), None)
        if not target:
            return {"status": "error", "message": "메모를 찾을 수 없습니다."}
        target["text"] = text
        target["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        _save_memos(memos)
    return {"status": "success", "data": target}


@router.delete("/api/memos/{memo_id}")
def delete_memo(memo_id: str):
    with _lock:
        memos = _load_memos()
        remaining = [m for m in memos if m.get("id") != memo_id]
        if len(remaining) == len(memos):
            return {"status": "error", "message": "메모를 찾을 수 없습니다."}
        _save_memos(remaining)
    return {"status": "success"}

@router.put("/api/memos/{memo_id}/style")
def update_memo_style(memo_id: str, payload: "MemoStyleUpdate"):
    """메모 카드의 크기/텍스트 크기/색깔/정렬만 업데이트한다(내용은 안 건드림)."""
    with _lock:
        memos = _load_memos()
        target = next((m for m in memos if m.get("id") == memo_id), None)
        if not target:
            return {"status": "error", "message": "메모를 찾을 수 없습니다."}
        existing_style = target.get("style") or {}
        new_style = payload.style.model_dump(exclude_unset=True)
        existing_style.update(new_style)
        target["style"] = existing_style
        target["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        _save_memos(memos)
    return {"status": "success", "data": target}


