import base64
import io
import uuid
import os

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import FileResponse

router = APIRouter()

OUTPUT_DIR = "bg_removed_outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)


@router.post("/api/remove-background")
async def remove_background(file: UploadFile = File(...)):
    """업로드된 상품 이미지의 배경을 제거해 투명 PNG로 반환한다.
    rembg는 첫 호출 시 내부적으로 AI 모델(u2net, 약 170MB)을 자동 다운로드하므로
    첫 요청은 시간이 좀 걸릴 수 있다(이후 요청부터는 빠름)."""
    try:
        from rembg import remove
        from PIL import Image
    except ImportError as e:
        return {"status": "error", "message": f"배경 제거 라이브러리가 설치되지 않았습니다: {e}"}

    try:
        raw = await file.read()
        input_image = Image.open(io.BytesIO(raw)).convert("RGBA")
        output_image = remove(input_image)

        filename = f"{uuid.uuid4().hex}.png"
        output_path = os.path.join(OUTPUT_DIR, filename)
        output_image.save(output_path, format="PNG")

        buf = io.BytesIO()
        output_image.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()

        return {
            "status": "success",
            "filename": filename,
            "image_base64": f"data:image/png;base64,{b64}",
        }
    except Exception as e:
        return {"status": "error", "message": f"배경 제거 처리 실패: {e}"}


@router.get("/api/remove-background/download/{filename}")
def download_removed(filename: str):
    path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(path):
        return {"status": "error", "message": "파일을 찾을 수 없습니다."}
    return FileResponse(path, media_type="image/png", filename=filename)
