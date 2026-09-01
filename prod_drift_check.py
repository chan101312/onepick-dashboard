"""
prod 서버(server.py, 루트 .py, apis/*.py)가 git(GitHub)의 "정답" 브랜치와
실제로 같은 코드를 돌리고 있는지 주기적으로 확인하는 드리프트 감시 스크립트.

배경: memos.py / product-mapping API / Counter 매칭 / todos.py·checklist.py·
bgremove.py 라우터 등록 — 전부 "prod에 SSH로 직접 수정하고 git에는 반영 안 함"
패턴으로 발생한 사고였다. 이 스크립트는 그 패턴을 사후에 고치는 게 아니라
사고 나는 즉시(다음 cron 실행 시) 알아채기 위한 안전망이다.

정답 소스: GitHub의 main 브랜치 (2026-09-01 feat/fee-analysis-tab을 main으로
fast-forward 병합 완료 — 그 전까지는 feat/fee-analysis-tab을 정답으로 썼었다).

fee_analysis 기능은 2026-09-01 Task 9로 prod에 실제 배포 완료 — 더 이상
예외 처리 안 하고 다른 파일과 똑같이 감시한다(fee_analysis.py 제외 및
server.py의 "fee_analysis" 줄 스킵 로직은 배포 완료 후 제거함). 여전히
비교 대상에서 완전히 빼는 건 자체 문서화된 1회성 디버그 스크립트
(verify_coupang_option.py 등, "확인 끝나면 삭제해도 됨"이라고 써있음)뿐이다.

실행: cron으로 주기 실행 (crontab 설정은 이 프로젝트의 배포 문서 참고).
출력: PROJECT_ROOT/prod_drift_status.json 에 결과를 기록한다. server.py의
GET /api/prod-drift-status가 이 파일을 읽어서 프론트 배너에 반영한다.
"""
import json
import os
import sys
from datetime import datetime, timezone, timedelta

import requests

GITHUB_REPO = "chan101312/onepick-dashboard"
GITHUB_REF = "main"
GITHUB_API = f"https://api.github.com/repos/{GITHUB_REPO}/contents"

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
STATUS_FILE = os.path.join(PROJECT_ROOT, "prod_drift_status.json")
KST = timezone(timedelta(hours=9))

# 완전히 비교 대상에서 빼는 파일 — git엔 있지만 prod에 없어도(또는 그 반대여도)
# 정상인 것들. 자체 선언된 1회성 디버그 스크립트만 해당(기능 파일은 전부 배포됨).
EXCLUDED_FILES = {
    "verify_coupang_option.py",
    "verify_naver_option.py",
    "patch6.py",
    "patch7.py",
    "test_coupang_orders.py",
    "test_token_match.py",
}

# git엔 없는 게 당연한 파일(비밀값 파일 등) — "prod 전용 미스터리 파일" 탐지에서 제외.
KNOWN_PROD_ONLY = {
    "config.py",
}

# 대상 디렉토리: (로컬 경로, GitHub API 경로) — 둘 다 "루트 기준 .py 파일만" 본다.
# 하위 디렉토리(예: _archive/)는 재귀적으로 안 본다 — 배포 대상이 아니므로.
CHECK_DIRS = [
    ("", ""),        # 프로젝트 루트
    ("apis", "apis"),  # apis/ 디렉토리
]

def _github_list_py_files(api_path):
    url = f"{GITHUB_API}/{api_path}?ref={GITHUB_REF}" if api_path else f"{GITHUB_API}?ref={GITHUB_REF}"
    res = requests.get(url, timeout=15, headers={"Accept": "application/vnd.github+json"})
    res.raise_for_status()
    items = res.json()
    return {
        item["name"]: item["sha"]
        for item in items
        if item.get("type") == "file" and item["name"].endswith(".py")
    }


def _github_fetch_raw(display_path):
    """파일 내용을 raw.githubusercontent.com이 아니라 Contents API를 raw 미디어
    타입으로 호출해서 받는다 — raw.githubusercontent.com은 Fastly CDN을 거치는데
    엣지 노드별로 push 직후 캐시 갱신이 늦어서(특히 prod가 있는 리전에서) 방금
    push한 내용을 못 보고 옛날 버전과 비교해 오탐하는 걸 실제로 겪었다. api.github.com은
    캐시를 안 타서 항상 최신이다."""
    url = f"{GITHUB_API}/{display_path}?ref={GITHUB_REF}"
    res = requests.get(url, timeout=15, headers={"Accept": "application/vnd.github.raw"})
    res.raise_for_status()
    return res.text


def _normalize(text):
    """줄바꿈 차이(CRLF vs LF)는 실제 코드 차이가 아니므로 비교 전에 통일한다 —
    Windows에서 git checkout 시 autocrlf로 CRLF 변환된 로컬 파일과 GitHub에
    LF로 저장된 blob을 그대로 바이트 비교하면 내용이 같아도 다르다고 오탐한다."""
    return text.replace("\r\n", "\n")


def _check_one_dir(local_dir, api_path, findings):
    remote_files = _github_list_py_files(api_path)  # {filename: git_blob_sha}
    local_full_dir = os.path.join(PROJECT_ROOT, local_dir) if local_dir else PROJECT_ROOT
    local_py_files = set()
    if os.path.isdir(local_full_dir):
        local_py_files = {f for f in os.listdir(local_full_dir) if f.endswith(".py")}

    display_prefix = f"{local_dir}/" if local_dir else ""

    # 1) git 기준으로 있어야 할 파일들이 prod에 실제로 있고 내용도 같은지.
    # (blob sha로 다운로드 없이 비교하는 방법도 있지만, Windows에서 만든 파일이
    # 섞여 있으면 CRLF/LF 차이로 오탐할 수 있어 텍스트를 정규화해서 직접 비교한다.)
    for filename, _sha in remote_files.items():
        if filename in EXCLUDED_FILES:
            continue
        display_name = f"{display_prefix}{filename}"
        local_path = os.path.join(local_full_dir, filename)
        if not os.path.exists(local_path):
            findings["missing_on_prod"].append(display_name)
            continue

        with open(local_path, "r", encoding="utf-8", errors="replace") as f:
            local_text = _normalize(f.read())

        remote_text = _normalize(_github_fetch_raw(display_name))

        if local_text != remote_text:
            findings["content_mismatch"].append(display_name)

    # 2) prod에는 있는데 git 목록에도, 알려진 예외 목록에도 없는 "미스터리 파일"
    #    — todos.py/checklist.py/bgremove.py가 이런 식으로 몇 주째 숨어있었다.
    for filename in local_py_files:
        if filename in remote_files or filename in EXCLUDED_FILES or filename in KNOWN_PROD_ONLY:
            continue
        findings["prod_only_mystery_files"].append(f"{display_prefix}{filename}")


def run_check():
    findings = {
        "content_mismatch": [],
        "missing_on_prod": [],
        "prod_only_mystery_files": [],
    }
    error = None
    try:
        for local_dir, api_path in CHECK_DIRS:
            _check_one_dir(local_dir, api_path, findings)
    except Exception as e:
        error = f"{type(e).__name__}: {e}"

    ok = error is None and not any(findings.values())
    status = {
        "checked_at": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S %z"),
        "ok": ok,
        "compared_ref": f"{GITHUB_REPO}@{GITHUB_REF}",
        "error": error,
        **findings,
    }
    with open(STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(status, f, ensure_ascii=False, indent=2)
    return status


if __name__ == "__main__":
    result = run_check()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result["ok"] else 1)
