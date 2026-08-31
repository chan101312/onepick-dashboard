import json
import os
import uuid
from datetime import date
from threading import Lock

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

ITEMS_FILE = "checklist_items.json"    # 체크리스트 항목 목록(불끄기, 문단속 등) — 항목 자체는 매일 동일
STATUS_FILE = "checklist_status.json"  # {"YYYY-MM-DD": {item_id: true/false}} — 날짜별 체크 상태
_lock = Lock()

DEFAULT_ITEMS = [
    {"id": "default-lights", "text": "불 끄기"},
    {"id": "default-doorlock", "text": "문단속"},
]


class ChecklistItemIn(BaseModel):
    text: str


class ChecklistToggle(BaseModel):
    item_id: str
    done: bool
    target_date: str | None = None  # 생략하면 오늘


def _load_items() -> list[dict]:
    if not os.path.exists(ITEMS_FILE):
        _save_items(DEFAULT_ITEMS)
        return DEFAULT_ITEMS
    try:
        with open(ITEMS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return DEFAULT_ITEMS


def _save_items(items: list[dict]):
    with open(ITEMS_FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def _load_status() -> dict:
    if not os.path.exists(STATUS_FILE):
        return {}
    try:
        with open(STATUS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_status(status: dict):
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)


@router.get("/api/checklist")
def get_checklist(target_date: str | None = None):
    """항목 목록 + 지정한 날짜(생략 시 오늘)의 체크 상태를 함께 반환.
    날짜가 바뀌면 status에 그 날짜 키가 아직 없어서 자동으로 전부 미체크 상태가 된다."""
    with _lock:
        items = _load_items()
        status = _load_status()
        d = target_date or date.today().isoformat()
        day_status = status.get(d, {})
        return {
            "status": "success",
            "date": d,
            "items": [{**item, "done": bool(day_status.get(item["id"], False))} for item in items],
        }


@router.post("/api/checklist/items")
def add_checklist_item(payload: ChecklistItemIn):
    text = payload.text.strip()
    if not text:
        return {"status": "error", "message": "항목 내용을 입력해주세요."}
    with _lock:
        items = _load_items()
        item = {"id": uuid.uuid4().hex, "text": text}
        items.append(item)
        _save_items(items)
    return {"status": "success", "data": item}


@router.delete("/api/checklist/items/{item_id}")
def delete_checklist_item(item_id: str):
    with _lock:
        items = _load_items()
        remaining = [i for i in items if i.get("id") != item_id]
        if len(remaining) == len(items):
            return {"status": "error", "message": "항목을 찾을 수 없습니다."}
        _save_items(remaining)
        # 해당 항목의 과거 체크 기록도 같이 정리
        status = _load_status()
        for day_status in status.values():
            day_status.pop(item_id, None)
        _save_status(status)
    return {"status": "success"}


@router.put("/api/checklist/toggle")
def toggle_checklist(payload: ChecklistToggle):
    with _lock:
        status = _load_status()
        d = payload.target_date or date.today().isoformat()
        day_status = status.setdefault(d, {})
        day_status[payload.item_id] = payload.done
        _save_status(status)
    return {"status": "success"}
