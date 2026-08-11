import json
import os
import traceback
import uuid
from datetime import date, datetime, timedelta
from threading import Lock

import pymysql
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

REORDER_CONFIG_FILE = "reorder_products.json"  # 상품별 리드타임/안전재고 수동 설정
ESANGIN_BACKUP_FILE = "esangin_backup.json"    # EsanginStock 탭을 열 때마다 server.py가 덮어쓰는 실 재고 백업

# E상인 saleticketlist(실 판매내역) 조회용 — server.py의 다른 E상인 연동 엔드포인트와 동일한 접속 정보
# connect_timeout을 짧게 걸어두는 이유: 방화벽이 SYN 패킷을 그냥 버리는(DROP) 경우
# 기본 OS TCP 타임아웃(수십~백수십 초)까지 요청이 그대로 멈춰버려서, 폴백이 있어도
# /api/reorder-alerts 자체가 사실상 "먹통"처럼 느껴진다. 5초면 충분히 빨리 포기하고 폴백으로 넘어간다.
ESANGIN_DB_CONFIG = dict(
    host="112.168.103.43",
    port=3306,
    user="root",
    password="softclass",
    db="essedata",
    charset="utf8mb4",
    connect_timeout=5,
)

_lock = Lock()

DEFAULT_LEAD_TIME_DAYS = 3
DEFAULT_SAFETY_STOCK_DAYS = 7

# 박스/묶음 단위로 몰아서 나가는 상품은 30일 고정으로 일평균을 내면 (예: 한 달에 한 번 대량 주문)
# 비정상적으로 높은 값이 나온다. 상품별로 실제 발주 주기에 맞는 기간을 고를 수 있게 한다.
SALES_CYCLE_OPTIONS = [7, 14, 30]
DEFAULT_SALES_CYCLE_DAYS = 14

# 재고 리스트에 섞여 있는 부자재/수수료성 항목 (다른 E상인 연동 탭들과 동일한 제외 기준)
EXCLUDED_NAME_KEYWORDS = ['택배비', '배송비', '아이스팩', '스티로폼', '광고비', '수수료', '정산', '기타']

SOLD_OUT_STALE_DAYS = 30  # 품절 + 이 기간 넘게 안 팔렸으면 알림 대신 데드스톡으로 분류
SLOW_MOVING_DAYS = 60     # 재고 있음 + 이 기간 넘게 안 팔렸으면 데드스톡으로 분류
SALES_LOOKBACK_DAYS = max(SALES_CYCLE_OPTIONS)  # saleticketlist 조회 시 미리 긁어올 최대 기간 (30일)


class ReorderConfigIn(BaseModel):
    product_name: str
    lead_time_days: float = DEFAULT_LEAD_TIME_DAYS
    safety_stock_days: float = DEFAULT_SAFETY_STOCK_DAYS
    sales_cycle_days: int = DEFAULT_SALES_CYCLE_DAYS


class ReorderConfigUpdate(BaseModel):
    product_name: str | None = None
    lead_time_days: float | None = None
    safety_stock_days: float | None = None
    sales_cycle_days: int | None = None


def _load_configs() -> list[dict]:
    if not os.path.exists(REORDER_CONFIG_FILE):
        return []
    try:
        with open(REORDER_CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[ERR] reorder config load failed: {e}")
        return []


def _save_configs(configs: list[dict]):
    with open(REORDER_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(configs, f, ensure_ascii=False, indent=2)


# ==========================================
# ⚙️ 상품별 리드타임 / 안전재고 설정 CRUD
# ==========================================
@router.get("/api/reorder/products")
def list_reorder_configs():
    with _lock:
        return {"status": "success", "data": _load_configs()}


@router.post("/api/reorder/products")
def create_reorder_config(payload: ReorderConfigIn):
    name = payload.product_name.strip()
    if not name:
        return {"status": "error", "message": "상품명을 입력해주세요."}
    with _lock:
        configs = _load_configs()
        cycle_days = payload.sales_cycle_days if payload.sales_cycle_days in SALES_CYCLE_OPTIONS else DEFAULT_SALES_CYCLE_DAYS
        config = {
            "id": uuid.uuid4().hex,
            "product_name": name,
            "lead_time_days": payload.lead_time_days,
            "safety_stock_days": payload.safety_stock_days,
            "sales_cycle_days": cycle_days,
        }
        configs.append(config)
        _save_configs(configs)
    return {"status": "success", "data": config}


@router.put("/api/reorder/products/{config_id}")
def update_reorder_config(config_id: str, payload: ReorderConfigUpdate):
    with _lock:
        configs = _load_configs()
        target = next((c for c in configs if c.get("id") == config_id), None)
        if not target:
            return {"status": "error", "message": "설정을 찾을 수 없습니다."}

        updates = payload.model_dump(exclude_unset=True)
        if "product_name" in updates:
            cleaned = str(updates["product_name"]).strip()
            if not cleaned:
                return {"status": "error", "message": "상품명을 입력해주세요."}
            updates["product_name"] = cleaned
        if "sales_cycle_days" in updates and updates["sales_cycle_days"] not in SALES_CYCLE_OPTIONS:
            return {"status": "error", "message": f"판매 주기는 {SALES_CYCLE_OPTIONS} 중 하나여야 합니다."}

        target.update(updates)
        _save_configs(configs)
    return {"status": "success", "data": target}


@router.delete("/api/reorder/products/{config_id}")
def delete_reorder_config(config_id: str):
    with _lock:
        configs = _load_configs()
        remaining = [c for c in configs if c.get("id") != config_id]
        if len(remaining) == len(configs):
            return {"status": "error", "message": "설정을 찾을 수 없습니다."}
        _save_configs(remaining)
    return {"status": "success"}


def _match_config(name: str, configs: list[dict]) -> dict:
    for c in configs:
        if c.get("product_name") == name:
            return c
    for c in configs:
        cname = c.get("product_name", "")
        if cname and (cname in name or name in cname):
            return c
    return {}


def _parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except Exception:
        return None


def _is_excluded(name: str) -> bool:
    return any(kw in name for kw in EXCLUDED_NAME_KEYWORDS)


def _safe_decode(val) -> str:
    if val is None:
        return ""
    if isinstance(val, bytes):
        try:
            return val.decode("cp949").strip()
        except Exception:
            return val.decode("utf-8", errors="ignore").strip()
    return str(val).strip()


def _load_esangin_items() -> tuple[list[dict] | None, str | None]:
    """esangin_backup.json을 읽어온다. 실패/부재 시 (None, 안내메시지)를 돌려준다."""
    if not os.path.exists(ESANGIN_BACKUP_FILE):
        return None, "E상인 데이터 없음. 재고 탭을 먼저 열어주세요"
    try:
        with open(ESANGIN_BACKUP_FILE, "r", encoding="utf-8") as f:
            items = json.load(f)
    except Exception as e:
        return None, f"E상인 데이터 읽기 실패: {e}"
    if not items:
        return None, "E상인 데이터 없음. 재고 탭을 먼저 열어주세요"
    return items, None


def _esangin_last_updated() -> str:
    return datetime.fromtimestamp(os.path.getmtime(ESANGIN_BACKUP_FILE)).strftime("%Y-%m-%d %H:%M:%S")


# ==========================================
# 📋 E상인 상품 목록 (재발주 설정 화면 드롭다운용)
# ==========================================
@router.get("/api/reorder/esangin-products")
def list_esangin_products():
    items, error = _load_esangin_items()
    if error:
        return {"status": "error", "message": error, "data": []}

    seen = set()
    products = []
    for item in items:
        name = str(item.get("name", "")).strip()
        if not name or name in seen or _is_excluded(name):
            continue
        seen.add(name)
        products.append({"name": name, "spec": item.get("spec", "")})

    products.sort(key=lambda p: p["name"])
    return {"status": "success", "data": products, "last_updated": _esangin_last_updated()}


def _fetch_recent_sales_from_db() -> dict[str, list[tuple[date, float]]] | None:
    """
    saleticketlist에서 최근 SALES_LOOKBACK_DAYS일(=지원하는 판매주기 중 가장 긴 기간)
    (판매일, 수량) 목록을 상품명별로 모아서 반환한다. 상품별 판매주기(7/14/30일)에 맞는
    합계·일평균은 호출부(_compute_alerts_from_db_sales)에서 계산한다.
    DB 접속/조회가 실패하면 None을 돌려주고, 호출부는 esangin_backup.json 기반 추정치로 폴백한다.
    """
    conn_target = f"{ESANGIN_DB_CONFIG['host']}:{ESANGIN_DB_CONFIG['port']}/{ESANGIN_DB_CONFIG['db']}"
    started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        conn = pymysql.connect(**ESANGIN_DB_CONFIG)
    except Exception as e:
        print(
            f"[ERR][{started_at}] saleticketlist DB 접속 실패 → 추정치 폴백으로 전환\n"
            f"  대상: {conn_target} (connect_timeout={ESANGIN_DB_CONFIG['connect_timeout']}s)\n"
            f"  예외 타입: {type(e).__name__}\n"
            f"  메시지: {e}\n"
            f"  트레이스백:\n{traceback.format_exc()}"
        )
        return None

    try:
        with conn.cursor() as cursor:
            try:
                cursor.execute(
                    "SELECT STLJPName, STLJPSu, STLDate FROM `saleticketlist` "
                    "WHERE STLJPName IS NOT NULL AND STLJPName != '' "
                    "ORDER BY STLDate DESC LIMIT 30000"
                )
            except Exception:
                cursor.execute(
                    "SELECT STLJPName, STLSu, STLDate FROM `saleticketlist` "
                    "WHERE STLJPName IS NOT NULL AND STLJPName != '' "
                    "ORDER BY STLDate DESC LIMIT 30000"
                )
            rows = cursor.fetchall()
    except Exception as e:
        print(
            f"[ERR][{started_at}] saleticketlist 조회 실패 → 추정치 폴백으로 전환\n"
            f"  대상: {conn_target}\n"
            f"  예외 타입: {type(e).__name__}\n"
            f"  메시지: {e}\n"
            f"  트레이스백:\n{traceback.format_exc()}"
        )
        return None
    finally:
        conn.close()

    print(f"[OK][{started_at}] saleticketlist 조회 성공: {conn_target}, {len(rows)}건 로드")

    cutoff_int = int((date.today() - timedelta(days=SALES_LOOKBACK_DAYS)).strftime("%Y%m%d"))
    dated_sales: dict[str, list[tuple[date, float]]] = {}

    for raw_name, raw_qty, raw_date in rows:
        name = _safe_decode(raw_name)
        if not name or _is_excluded(name):
            continue

        date_str = _safe_decode(raw_date).replace("-", "").replace(".", "").replace("/", "")
        try:
            if int(date_str[:8]) < cutoff_int:
                continue
            row_date = datetime.strptime(date_str[:8], "%Y%m%d").date()
        except Exception:
            continue

        try:
            qty = float(_safe_decode(raw_qty).replace(",", ""))
        except Exception:
            qty = 0

        if qty > 0:
            dated_sales.setdefault(name, []).append((row_date, qty))

    return dated_sales


def _compute_alerts_from_db_sales(
    stock_items: list[dict],
    dated_sales_by_name: dict[str, list[tuple[date, float]]],
    configs: list[dict],
) -> list[dict]:
    """실제 saleticketlist 판매량 기반 (요구사항 1~5): 최근 30일 판매 없는 상품은 알림 대상에서 제외."""
    stock_by_name: dict[str, float] = {}
    spec_by_name: dict[str, str] = {}
    for item in stock_items:
        name = str(item.get("name", "")).strip()
        if not name or _is_excluded(name):
            continue
        try:
            stock = float(item.get("stock", 0) or 0)
        except (TypeError, ValueError):
            stock = 0
        stock_by_name[name] = stock_by_name.get(name, 0) + stock
        if not spec_by_name.get(name) and item.get("spec"):
            spec_by_name[name] = item.get("spec", "")

    today = date.today()
    alerts = []
    for name, dated_qtys in dated_sales_by_name.items():
        if name not in stock_by_name:
            continue  # 재고 매칭 안 되면 소진일수 계산 불가 → 알림 제외

        # 항상 최근 30일 총 판매량은 표시용으로 따로 계산 (판매주기 설정과 무관하게 참고 정보)
        sales_30d = sum(qty for _, qty in dated_qtys)

        # 일평균은 상품별로 설정한 판매주기(기본 14일) 기준으로 계산한다.
        # 30일 고정으로 나누면 몰아서 나가는(박스단위) 상품이 비정상적으로 높은 일평균을 갖게 된다.
        config = _match_config(name, configs)
        cycle_days = config.get("sales_cycle_days", DEFAULT_SALES_CYCLE_DAYS)
        if cycle_days not in SALES_CYCLE_OPTIONS:
            cycle_days = DEFAULT_SALES_CYCLE_DAYS

        cycle_cutoff = today - timedelta(days=cycle_days)
        cycle_sales = sum(qty for d, qty in dated_qtys if d >= cycle_cutoff)

        daily_avg = cycle_sales / cycle_days
        if daily_avg <= 0:
            continue

        stock = stock_by_name[name]
        days_remaining = stock / daily_avg

        if days_remaining <= 3:
            urgency = "urgent"
        elif days_remaining <= 7:
            urgency = "warning"
        elif days_remaining <= 14:
            urgency = "notice"
        else:
            continue  # 재고 여유 충분, 알림 대상 아님

        alerts.append({
            "id": name,
            "product_name": name,
            "spec": spec_by_name.get(name, ""),
            "current_stock": stock,
            "sales_30d": round(sales_30d, 1),
            "sales_cycle_days": cycle_days,
            "daily_avg_sales": round(daily_avg, 2),
            "days_remaining": round(days_remaining, 1),
            "urgency": urgency,
        })

    return alerts


def _compute_alerts_fallback_estimate(stock_items: list[dict], configs: list[dict]) -> list[dict]:
    """
    saleticketlist DB 접속이 안 될 때 쓰는 폴백: esangin_backup.json의 lastSalesDate/lastInDate로
    판매 빈도를 추정한다 (요구사항 6 폴백, 2/3 강화).

    - lastSalesDate가 없으면 lastInDate라도 '최근 움직임' 신호로 사용한다 (커버리지 확대).
    - 그 신호(판매일 또는 입고일)가 상품별 판매주기(sales_cycle_days, 기본 14일)보다 오래됐으면
      추정 신뢰도가 낮다고 보고 알림 대상에서 제외한다 (DB 모드와 동일하게 판매주기 설정을 따른다).
    - 일평균 판매량은 "재고 ÷ 30"처럼 그대로 되돌려 소진일수를 계산하면 항상 정확히 30일이
      나오는 순환계산이 되어(재고를 그 값으로 다시 나누면 늘 30) 사실상 어떤 상품도 경고가
      안 뜨는 결과가 나온다. 대신 "최근 신호로부터 경과일수"를 분모로 써서(재입고 직후 과대추정
      방지용 최소값은 유지) 실제로 재고량에 따라 달라지는 값을 낸다.
    """
    today = date.today()
    alerts = []

    for item in stock_items:
        name = str(item.get("name", "")).strip()
        if not name or _is_excluded(name):
            continue

        try:
            stock = float(item.get("stock", 0) or 0)
        except (TypeError, ValueError):
            stock = 0

        spec = item.get("spec", "")
        last_sales_date = _parse_date(item.get("lastSalesDate"))
        last_in_date = _parse_date(item.get("lastInDate"))

        config = _match_config(name, configs)
        lead_time = float(config.get("lead_time_days", DEFAULT_LEAD_TIME_DAYS) or DEFAULT_LEAD_TIME_DAYS)
        safety_days = float(config.get("safety_stock_days", DEFAULT_SAFETY_STOCK_DAYS) or DEFAULT_SAFETY_STOCK_DAYS)
        cycle_days = config.get("sales_cycle_days", DEFAULT_SALES_CYCLE_DAYS)
        if cycle_days not in SALES_CYCLE_OPTIONS:
            cycle_days = DEFAULT_SALES_CYCLE_DAYS

        base_entry = {
            "id": f"{name}_{spec}",
            "product_name": name,
            "spec": spec,
            "current_stock": stock,
            "sales_30d": None,  # 폴백 모드에선 실판매량을 모름 (추정치만 제공)
            "sales_cycle_days": cycle_days,
        }

        if stock <= 0:
            if last_sales_date and (today - last_sales_date).days <= SOLD_OUT_STALE_DAYS:
                alerts.append({**base_entry, "daily_avg_sales": None, "days_remaining": 0, "urgency": "urgent"})
            continue  # 오래 안 팔린 품절 상품은 데드스톡 쪽에서 별도 처리

        # 판매일도 입고일도 없으면 판매 빈도를 추정할 근거가 전혀 없음 → 판단 보류
        if not last_sales_date and not last_in_date:
            alerts.append({**base_entry, "daily_avg_sales": None, "days_remaining": None, "urgency": "notice"})
            continue

        if last_sales_date and (today - last_sales_date).days >= SLOW_MOVING_DAYS:
            continue  # 데드스톡 대상, 알림 아님

        # 최근 판매일을 우선 사용하고, 없으면 입고일을 '최근 움직임' 근거로 대체 (요구사항 2)
        anchor_date = last_sales_date or last_in_date
        days_since_anchor = (today - anchor_date).days

        # 마지막 활동(판매/입고)이 상품별 판매주기보다 오래됐으면 추정 신뢰도가 낮으므로 제외
        if days_since_anchor > cycle_days:
            continue

        # 재입고 직후(days_since_anchor가 작음)엔 재고÷경과일이 비정상적으로 부풀려지므로
        # (리드타임+안전재고일수) 미만으로는 내려가지 않게 완충한다.
        min_days_elapsed = max(lead_time + safety_days, 1)
        days_elapsed = max(days_since_anchor, min_days_elapsed)
        daily_avg = stock / days_elapsed
        reorder_point = daily_avg * (lead_time + safety_days)

        if stock <= reorder_point:
            urgency = "warning"
        elif stock <= reorder_point * 2:
            urgency = "notice"
        else:
            continue  # 재고 여유 충분, 알림 대상 아님

        alerts.append({
            **base_entry,
            "daily_avg_sales": round(daily_avg, 2),
            "days_remaining": round(stock / daily_avg, 1),
            "urgency": urgency,
        })

    return alerts


def _compute_deadstocks(stock_items: list[dict]) -> list[dict]:
    """esangin_backup.json의 lastSalesDate만으로 판정하는 데드스톡 목록 (DB 성공/폴백 여부와 무관하게 항상 동일)."""
    today = date.today()
    deadstocks = []

    for item in stock_items:
        name = str(item.get("name", "")).strip()
        if not name or _is_excluded(name):
            continue

        try:
            stock = float(item.get("stock", 0) or 0)
        except (TypeError, ValueError):
            stock = 0

        spec = item.get("spec", "")
        last_sales_date = _parse_date(item.get("lastSalesDate"))

        base_entry = {
            "id": f"{name}_{spec}",
            "product_name": name,
            "spec": spec,
            "current_stock": stock,
            "last_sales_date": item.get("lastSalesDate", "") or "",
        }

        if stock <= 0:
            if not (last_sales_date and (today - last_sales_date).days <= SOLD_OUT_STALE_DAYS):
                days_since_sale = (today - last_sales_date).days if last_sales_date else None
                deadstocks.append({
                    **base_entry,
                    "reason": "sold_out_stale" if last_sales_date else "no_sales_record",
                    "days_since_last_sale": days_since_sale,
                })
            continue

        if last_sales_date:
            days_since_sale = (today - last_sales_date).days
            if days_since_sale >= SLOW_MOVING_DAYS:
                deadstocks.append({**base_entry, "reason": "slow_moving", "days_since_last_sale": days_since_sale})

    deadstocks.sort(key=lambda d: -(d["days_since_last_sale"] if d["days_since_last_sale"] is not None else 10**9))
    return deadstocks


# ==========================================
# 🔔 재발주 알림 (saleticketlist 실판매 + esangin_backup.json 재고 연동)
# ==========================================
@router.get("/api/reorder-alerts")
def get_reorder_alerts():
    stock_items, error = _load_esangin_items()
    if error:
        return {"error": error}

    last_updated = _esangin_last_updated()

    with _lock:
        configs = _load_configs()

    dated_sales_by_name = _fetch_recent_sales_from_db()

    if dated_sales_by_name is not None:
        data_source = "db"
        alerts = _compute_alerts_from_db_sales(stock_items, dated_sales_by_name, configs)
    else:
        data_source = "fallback"
        alerts = _compute_alerts_fallback_estimate(stock_items, configs)

    deadstocks = _compute_deadstocks(stock_items)

    urgency_rank = {"urgent": 0, "warning": 1, "notice": 2}

    def _alert_sort_key(a):
        dr = a.get("days_remaining")
        return (urgency_rank.get(a["urgency"], 9), dr if dr is not None else 9999)

    alerts.sort(key=_alert_sort_key)

    return {
        "last_updated": last_updated,
        "data_source": data_source,
        "alerts": alerts,
        "deadstocks": deadstocks,
    }
