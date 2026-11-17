"""FastAPI backend for the Google Maps business scraper application."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import threading
import time
from typing import Any
import uuid

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app import db, export, scraper

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
EXPORTS_DIR = Path("exports")

_TR_ASCII_MAP = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")

_jobs_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}
_cancel_events: dict[str, threading.Event] = {}
_saved_counts: dict[str, int] = {}
_job_threads: dict[str, threading.Thread] = {}
_shutting_down = False

_batches: dict[str, dict[str, Any]] = {}
_batch_stop_events: dict[str, threading.Event] = {}
_batch_job_ids: set[str] = set()

ACTIVE_FINISHED_BATCH_WINDOW_S = 600.0
SHUTDOWN_JOIN_TIMEOUT_S = 15.0


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_opt(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped if stripped else None


def _slugify(value: str) -> str:
    ascii_text = value.translate(_TR_ASCII_MAP).lower()
    slug = re.sub(r"[^a-z0-9]+", "_", ascii_text).strip("_")
    return slug[:40]


def _build_export_filename(region: str | None, category: str | None) -> str:
    parts = ["isletmeler"]
    if region:
        slug = _slugify(region)
        if slug:
            parts.append(slug)
    if category:
        slug = _slugify(category)
        if slug:
            parts.append(slug)
    parts.append(datetime.now().strftime("%Y%m%d_%H%M%S"))
    return f"{'_'.join(parts)}.xlsx"


def _finish_job(
    job_id: str,
    status: str,
    message: str,
    results_count: int | None = None,
) -> None:
    finished_at = _utc_now_iso()
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        if results_count is not None:
            saved = _saved_counts.get(job_id, 0)
            job["done"] = max(job["done"], results_count, saved)
            job["total"] = max(job["total"], job["done"])
        job["status"] = status
        job["message"] = message
        job["finished_at"] = finished_at


UNLIMITED_MAX_RESULTS_CAP = 1000


def _validate_non_empty_text(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Bu alan boş bırakılamaz.")
    return cleaned


class JobCreateRequest(BaseModel):
    region: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., min_length=1, max_length=200)
    max_results: int | None = Field(default=50, ge=1, le=1000)
    headless: bool = True
    workers: int = Field(default=1, ge=1, le=5)

    @field_validator("region", "category")
    @classmethod
    def _strip_and_validate_non_empty(cls, value: str) -> str:
        return _validate_non_empty_text(value)


class BatchItemRequest(BaseModel):
    region: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., min_length=1, max_length=200)

    @field_validator("region", "category")
    @classmethod
    def _strip_and_validate_non_empty(cls, value: str) -> str:
        return _validate_non_empty_text(value)


class BatchCreateRequest(BaseModel):
    items: list[BatchItemRequest] = Field(..., min_length=1, max_length=200)
    max_results: int | None = Field(default=50, ge=1, le=1000)
    headless: bool = True
    workers: int = Field(default=1, ge=1, le=5)
    label: str | None = Field(default=None, max_length=200)

    @field_validator("label")
    @classmethod
    def _clean_label(cls, value: str | None) -> str | None:
        return _clean_opt(value)


def _check_start_conflict_locked() -> None:
    """Raise 503 on shutdown or 409 if any job/batch is running or paused. Caller must hold _jobs_lock."""
    if _shutting_down:
        raise HTTPException(
            status_code=503,
            detail="Sunucu kapatılıyor, yeni tarama başlatılamaz.",
        )
    if any(job["status"] == "running" for job in _jobs.values()) or any(
        batch["status"] == "running" for batch in _batches.values()
    ):
        raise HTTPException(
            status_code=409,
            detail="Halihazırda çalışan bir tarama işi veya toplu tarama var. Lütfen tamamlanmasını bekleyin veya iptal edin.",
        )
    if any(batch["status"] == "paused" for batch in _batches.values()):
        raise HTTPException(
            status_code=409,
            detail="Duraklatılmış bir toplu tarama var. Yeni tarama başlatmadan önce mevcut toplu taramaya devam edin veya iptal edin.",
        )


def _mark_remaining_items_skipped_locked(batch: dict[str, Any]) -> None:
    """Mark all pending/paused items in a batch as skipped. Caller must hold _jobs_lock."""
    for item in batch["items"]:
        if item["status"] in ("pending", "paused"):
            item["status"] = "skipped"


def _register_job_locked(
    job_id: str,
    region: str,
    category: str,
    max_results: int | None,
    headless: bool,
    workers: int,
    cancel_event: threading.Event,
    started_at: str,
    is_batch_child: bool = False,
) -> None:
    """Register a newly started scrape job in shared state. Caller must hold _jobs_lock."""
    _cancel_events[job_id] = cancel_event
    _saved_counts[job_id] = 0
    if is_batch_child:
        _batch_job_ids.add(job_id)
    _jobs[job_id] = {
        "job_id": job_id,
        "region": region,
        "category": category,
        "max_results": max_results,
        "headless": headless,
        "workers": workers,
        "status": "running",
        "done": 0,
        "total": 0,
        "message": f"'{region}' için '{category}' taraması başlatılıyor...",
        "started_at": started_at,
        "finished_at": None,
    }


def _finish_batch_locked(
    batch: dict[str, Any],
    status: str,
    message: str,
) -> None:
    """Finalize a batch entry. Caller must hold _jobs_lock."""
    now_dt = datetime.now(timezone.utc)
    batch["status"] = status
    batch["message"] = message
    batch["finished_at"] = now_dt.isoformat()
    batch["finished_at_dt"] = now_dt
    batch["current_job_id"] = None
    batch["waiting_until"] = None


def _finish_batch(batch_id: str, status: str, message: str) -> None:
    with _jobs_lock:
        batch = _batches.get(batch_id)
        if batch is not None:
            _finish_batch_locked(batch, status, message)


def _serialize_batch_locked(batch: dict[str, Any]) -> dict[str, Any]:
    """Build a JSON-safe snapshot of batch state. Caller must hold _jobs_lock."""
    items_out = [
        {
            "region": item["region"],
            "category": item["category"],
            "status": item["status"],
            "done": int(item["done"]),
        }
        for item in batch["items"]
    ]

    current_obj: dict[str, Any] | None = None
    idx = int(batch["current_index"])
    if batch["status"] == "running" and 0 <= idx < len(items_out):
        cur_job_id = batch.get("current_job_id")
        if cur_job_id is not None and cur_job_id in _jobs:
            live_done = int(_jobs[cur_job_id].get("done") or 0)
            items_out[idx]["done"] = max(items_out[idx]["done"], live_done)
        current_obj = {
            "region": items_out[idx]["region"],
            "category": items_out[idx]["category"],
            "job_id": cur_job_id,
            "done": items_out[idx]["done"],
        }

    total_saved = sum(item["done"] for item in items_out)
    total_items = int(batch["total_items"])
    completed_items = int(batch["completed_items"])
    durations: list[float] = batch["completed_durations"]
    remaining = max(0, total_items - completed_items)

    eta_seconds: int | None = None
    if batch["status"] == "running" and durations:
        avg_duration = sum(durations) / len(durations)
        eta_seconds = max(0, int(round(avg_duration * remaining)))

    return {
        "batch_id": batch["batch_id"],
        "label": batch["label"],
        "status": batch["status"],
        "workers": int(batch.get("workers", 1)),
        "total_items": total_items,
        "completed_items": completed_items,
        "current_index": idx,
        "current": current_obj,
        "items": items_out,
        "total_saved": total_saved,
        "started_at": batch["started_at"],
        "finished_at": batch["finished_at"],
        "eta_seconds": eta_seconds,
        "message": batch["message"],
        "waiting_until": None,
    }


def _run_scrape_job(
    job_id: str,
    region: str,
    category: str,
    max_results: int,
    headless: bool,
    workers: int,
    cancel_event: threading.Event,
) -> None:
    """Execute sync Playwright scraper inside a dedicated background thread."""

    def on_item(item: dict[str, Any]) -> None:
        record = dict(item)
        if not record.get("search_region"):
            record["search_region"] = region
        if not record.get("search_category"):
            record["search_category"] = category
        if not record.get("scraped_at"):
            record["scraped_at"] = _utc_now_iso()

        db.upsert_business(record)

        with _jobs_lock:
            saved = _saved_counts.get(job_id, 0) + 1
            _saved_counts[job_id] = saved
            job = _jobs.get(job_id)
            if job is not None and job["status"] == "running":
                job["done"] = max(job["done"], saved)

    def on_progress(done: int, total_found: int, message: str) -> None:
        with _jobs_lock:
            job = _jobs.get(job_id)
            if job is None or job["status"] != "running":
                return
            saved = _saved_counts.get(job_id, 0)
            job["done"] = max(done, saved)
            job["total"] = max(job["total"], total_found)
            if message:
                job["message"] = message

    def should_stop() -> bool:
        return cancel_event.is_set()

    try:
        results = scraper.scrape(
            region=region,
            category=category,
            max_results=max_results,
            headless=headless,
            on_item=on_item,
            on_progress=on_progress,
            should_stop=should_stop,
            workers=workers,
        )
        result_count = len(results) if isinstance(results, list) else 0
        with _jobs_lock:
            job = _jobs.get(job_id)
            effective_count = max(
                result_count,
                _saved_counts.get(job_id, 0),
                job["done"] if job else 0,
            )

        _finish_job(
            job_id,
            "done",
            f"Tarama tamamlandı: {effective_count} işletme kaydedildi.",
            results_count=result_count,
        )
    except scraper.CaptchaDetected as exc:
        detail = str(exc).strip()
        msg = (
            f"Google Maps doğrulama (CAPTCHA) algılandı: {detail}"
            if detail
            else (
                "Google Maps doğrulama (CAPTCHA) algılandı. "
                "Görünmez tarayıcı (headless) seçeneğini kapatıp tekrar deneyin."
            )
        )
        _finish_job(job_id, "captcha", msg)
    except scraper.ScrapeCancelled:
        with _jobs_lock:
            job = _jobs.get(job_id)
            saved = max(_saved_counts.get(job_id, 0), job["done"] if job else 0)
        _finish_job(
            job_id,
            "cancelled",
            f"Tarama kullanıcı tarafından iptal edildi ({saved} işletme kaydedildi).",
        )
    except Exception as exc:
        detail = str(exc).strip() or type(exc).__name__
        _finish_job(job_id, "error", f"Tarama sırasında hata oluştu: {detail}")
    finally:
        with _jobs_lock:
            _job_threads.pop(job_id, None)


def _record_batch_item_outcome_locked(
    batch: dict[str, Any],
    idx: int,
    job_id: str,
    job_status: str,
    job_done: int,
    item_duration: float,
    run_generation: int,
) -> None:
    """Persist a finished child job's count and status on its batch item. Caller must hold _jobs_lock."""
    if 0 <= idx < len(batch["items"]):
        item_entry = batch["items"][idx]
        item_entry["done"] = max(int(item_entry["done"]), job_done)
        if job_status == "done":
            if item_entry["status"] != "done":
                item_entry["status"] = "done"
                batch["completed_items"] += 1
                batch["completed_durations"].append(item_duration)
        elif job_status in ("captcha", "error"):
            item_entry["status"] = job_status
        else:
            if batch["status"] == "cancelled" or batch.get("stop_intent") == "cancel":
                if item_entry["status"] != "skipped":
                    item_entry["status"] = "cancelled"
            elif (
                batch["run_generation"] != run_generation
                or batch.get("stop_intent") == "pause"
                or batch["status"] == "paused"
            ):
                if item_entry["status"] in ("running", "paused"):
                    item_entry["status"] = "paused"
            else:
                item_entry["status"] = "cancelled"

    if batch.get("current_job_id") == job_id:
        batch["current_job_id"] = None


def _run_batch(
    batch_id: str,
    start_index: int,
    run_generation: int,
    stop_event: threading.Event,
    prev_thread: threading.Thread | None = None,
) -> None:
    """Execute batch items sequentially back-to-back with pause/resume/cancel."""
    try:
        if prev_thread is not None and prev_thread.is_alive():
            prev_thread.join()

        with _jobs_lock:
            batch = _batches.get(batch_id)
            if batch is None or batch["run_generation"] != run_generation:
                return
            if _shutting_down or stop_event.is_set() or batch["status"] != "running":
                if (
                    batch["status"] == "running"
                    and batch.get("stop_intent") != "pause"
                    and (_shutting_down or stop_event.is_set() or batch.get("stop_intent") == "cancel")
                ):
                    _mark_remaining_items_skipped_locked(batch)
                    total_saved = sum(int(it["done"]) for it in batch["items"])
                    _finish_batch_locked(
                        batch,
                        "cancelled",
                        f"Toplu tarama iptal edildi ({total_saved} işletme kaydedildi).",
                    )
                return
            total_items = int(batch["total_items"])
            max_results = batch["max_results"]
            effective_max_results = int(batch["effective_max_results"])
            headless = bool(batch["headless"])
            workers = int(batch.get("workers", 1))

        for idx in range(start_index, total_items):
            with _jobs_lock:
                batch = _batches.get(batch_id)
                if batch is None or batch["run_generation"] != run_generation:
                    return
                if batch["status"] in ("done", "cancelled", "captcha", "error"):
                    return
                if batch["stop_intent"] == "pause" or batch["status"] == "paused":
                    return
                if _shutting_down or stop_event.is_set() or batch["stop_intent"] == "cancel":
                    _mark_remaining_items_skipped_locked(batch)
                    total_saved = sum(int(it["done"]) for it in batch["items"])
                    _finish_batch_locked(
                        batch,
                        "cancelled",
                        f"Toplu tarama iptal edildi ({total_saved} işletme kaydedildi).",
                    )
                    return
                if batch["status"] != "running":
                    return

                item = batch["items"][idx]
                if item["status"] == "done":
                    continue

                region = item["region"]
                category = item["category"]
                job_id = uuid.uuid4().hex[:12]
                job_cancel_event = threading.Event()
                job_started_at = _utc_now_iso()

                worker = threading.Thread(
                    target=_run_scrape_job,
                    args=(
                        job_id,
                        region,
                        category,
                        effective_max_results,
                        headless,
                        workers,
                        job_cancel_event,
                    ),
                    name=f"batch-{batch_id}-job-{job_id}",
                    daemon=True,
                )
                _register_job_locked(
                    job_id=job_id,
                    region=region,
                    category=category,
                    max_results=max_results,
                    headless=headless,
                    workers=workers,
                    cancel_event=job_cancel_event,
                    started_at=job_started_at,
                    is_batch_child=True,
                )
                _job_threads[job_id] = worker
                item["done"] = 0
                item["status"] = "running"
                batch["current_index"] = idx
                batch["current_job_id"] = job_id
                batch["waiting_until"] = None
                batch["message"] = f"{idx + 1}/{total_items}: {region} — {category} taranıyor..."
                item_start_mono = time.monotonic()
                worker.start()

            worker.join()
            item_duration = max(0.0, time.monotonic() - item_start_mono)

            with _jobs_lock:
                job = _jobs.get(job_id)
                job_status = job["status"] if job else "error"
                job_done = int(job["done"]) if job else 0
                job_message = job["message"] if job else "Tarama sırasında hata oluştu."
                if job_status == "running":
                    job_status = "error"
                    job_message = "Tarama beklenmedik şekilde sonlandı."

                batch = _batches.get(batch_id)
                if batch is None:
                    return

                _record_batch_item_outcome_locked(
                    batch,
                    idx,
                    job_id,
                    job_status,
                    job_done,
                    item_duration,
                    run_generation,
                )

                if batch["run_generation"] != run_generation:
                    return
                if batch["status"] in ("done", "cancelled", "captcha", "error"):
                    return

                stop_intent = batch.get("stop_intent")
                if stop_intent == "pause" or batch["status"] == "paused":
                    batch["status"] = "paused"
                    batch["waiting_until"] = None
                    return

                if _shutting_down or stop_intent == "cancel" or job_status == "cancelled" or stop_event.is_set():
                    _mark_remaining_items_skipped_locked(batch)
                    total_saved = sum(int(it["done"]) for it in batch["items"])
                    _finish_batch_locked(
                        batch,
                        "cancelled",
                        f"Toplu tarama iptal edildi ({total_saved} işletme kaydedildi).",
                    )
                    return

                if job_status in ("captcha", "error"):
                    _finish_batch_locked(batch, job_status, job_message)
                    return

                total_saved = sum(int(it["done"]) for it in batch["items"])

                next_pending_idx = None
                for look_idx in range(idx + 1, total_items):
                    if batch["items"][look_idx]["status"] != "done":
                        next_pending_idx = look_idx
                        break

                if next_pending_idx is None:
                    _finish_batch_locked(
                        batch,
                        "done",
                        f"Toplu tarama tamamlandı: {total_items} arama, {total_saved} işletme kaydedildi.",
                    )
                    return

                batch["current_index"] = next_pending_idx
                batch["waiting_until"] = None

        with _jobs_lock:
            batch = _batches.get(batch_id)
            if (
                batch is not None
                and batch["run_generation"] == run_generation
                and batch["status"] == "running"
            ):
                total_items = int(batch["total_items"])
                total_saved = sum(int(it["done"]) for it in batch["items"])
                _finish_batch_locked(
                    batch,
                    "done",
                    f"Toplu tarama tamamlandı: {total_items} arama, {total_saved} işletme kaydedildi.",
                )
    except Exception as exc:
        detail = str(exc).strip() or type(exc).__name__
        _finish_batch(batch_id, "error", f"Toplu tarama sırasında hata oluştu: {detail}")


def _shutdown_workers(timeout_s: float = SHUTDOWN_JOIN_TIMEOUT_S) -> None:
    """Signal all running jobs/batches to cancel and join active threads before exit."""
    global _shutting_down
    with _jobs_lock:
        _shutting_down = True
        for ev in _batch_stop_events.values():
            ev.set()
        for ev in _cancel_events.values():
            ev.set()

        threads_to_join: list[threading.Thread] = []
        seen_ids: set[int] = set()
        for thread in _job_threads.values():
            if thread.is_alive() and id(thread) not in seen_ids:
                seen_ids.add(id(thread))
                threads_to_join.append(thread)
        for batch in _batches.values():
            thread = batch.get("runner_thread")
            if isinstance(thread, threading.Thread) and thread.is_alive() and id(thread) not in seen_ids:
                seen_ids.add(id(thread))
                threads_to_join.append(thread)

    deadline = time.monotonic() + timeout_s
    for thread in threads_to_join:
        if not thread.is_alive():
            continue
        remaining = max(0.0, deadline - time.monotonic())
        if remaining <= 0.0:
            break
        thread.join(timeout=remaining)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _shutting_down
    with _jobs_lock:
        _shutting_down = False
    db.init_db()
    try:
        yield
    finally:
        _shutdown_workers(SHUTDOWN_JOIN_TIMEOUT_S)


app = FastAPI(title="Google Maps İşletme Toplayıcı", lifespan=lifespan)


@app.get("/", include_in_schema=False)
def read_index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/jobs")
def create_job(payload: JobCreateRequest) -> dict[str, str]:
    job_id = uuid.uuid4().hex[:12]
    cancel_event = threading.Event()
    started_at = _utc_now_iso()
    effective_max_results = (
        payload.max_results
        if payload.max_results is not None
        else UNLIMITED_MAX_RESULTS_CAP
    )

    worker = threading.Thread(
        target=_run_scrape_job,
        args=(
            job_id,
            payload.region,
            payload.category,
            effective_max_results,
            payload.headless,
            payload.workers,
            cancel_event,
        ),
        name=f"scrape-{job_id}",
        daemon=True,
    )

    with _jobs_lock:
        _check_start_conflict_locked()

        _register_job_locked(
            job_id=job_id,
            region=payload.region,
            category=payload.category,
            max_results=payload.max_results,
            headless=payload.headless,
            workers=payload.workers,
            cancel_event=cancel_event,
            started_at=started_at,
            is_batch_child=False,
        )
        _job_threads[job_id] = worker
        worker.start()

    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Tarama işi bulunamadı.")
        return dict(job)


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict[str, Any]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        cancel_event = _cancel_events.get(job_id)
        if job is None or cancel_event is None:
            raise HTTPException(status_code=404, detail="Tarama işi bulunamadı.")
        cancel_event.set()
        if job["status"] == "running":
            job["message"] = "Tarama iptal ediliyor, mevcut işlem sonlandırılıyor..."
        return {
            "job_id": job_id,
            "status": job["status"],
            "cancelling": True,
        }


@app.post("/api/batches")
def create_batch(payload: BatchCreateRequest) -> dict[str, str]:
    batch_id = uuid.uuid4().hex[:12]
    stop_event = threading.Event()
    started_at = _utc_now_iso()
    items_data = [{"region": item.region, "category": item.category} for item in payload.items]
    effective_max_results = (
        payload.max_results
        if payload.max_results is not None
        else UNLIMITED_MAX_RESULTS_CAP
    )

    worker = threading.Thread(
        target=_run_batch,
        args=(batch_id, 0, 1, stop_event, None),
        name=f"batch-{batch_id}",
        daemon=True,
    )

    with _jobs_lock:
        _check_start_conflict_locked()

        _batch_stop_events[batch_id] = stop_event
        _batches[batch_id] = {
            "batch_id": batch_id,
            "label": payload.label,
            "status": "running",
            "total_items": len(items_data),
            "completed_items": 0,
            "current_index": 0,
            "current_job_id": None,
            "max_results": payload.max_results,
            "effective_max_results": effective_max_results,
            "headless": payload.headless,
            "workers": payload.workers,
            "run_generation": 1,
            "stop_intent": None,
            "runner_thread": worker,
            "items": [
                {
                    "region": item["region"],
                    "category": item["category"],
                    "status": "pending",
                    "done": 0,
                }
                for item in items_data
            ],
            "started_at": started_at,
            "finished_at": None,
            "finished_at_dt": None,
            "completed_durations": [],
            "message": f"Toplu tarama başlatılıyor ({len(items_data)} arama)...",
            "waiting_until": None,
        }
        worker.start()

    return {"batch_id": batch_id}


@app.get("/api/batches/{batch_id}")
def get_batch(batch_id: str) -> dict[str, Any]:
    with _jobs_lock:
        batch = _batches.get(batch_id)
        if batch is None:
            raise HTTPException(status_code=404, detail="Toplu tarama bulunamadı.")
        return _serialize_batch_locked(batch)


@app.post("/api/batches/{batch_id}/pause")
def pause_batch(batch_id: str) -> dict[str, Any]:
    with _jobs_lock:
        batch = _batches.get(batch_id)
        if batch is None:
            raise HTTPException(status_code=404, detail="Toplu tarama bulunamadı.")

        if batch["status"] == "paused":
            return _serialize_batch_locked(batch)
        if batch["status"] != "running":
            raise HTTPException(
                status_code=409,
                detail="Yalnızca çalışan bir toplu tarama duraklatılabilir.",
            )

        batch["stop_intent"] = "pause"
        batch["status"] = "paused"
        batch["waiting_until"] = None
        batch["message"] = "Toplu tarama duraklatıldı."

        stop_event = _batch_stop_events.get(batch_id)
        if stop_event is not None:
            stop_event.set()

        cur_job_id = batch.get("current_job_id")
        if cur_job_id is not None:
            idx = int(batch["current_index"])
            cur_job = _jobs.get(cur_job_id)
            if cur_job is not None:
                if 0 <= idx < len(batch["items"]):
                    batch["items"][idx]["done"] = max(
                        int(batch["items"][idx]["done"]),
                        int(cur_job.get("done") or 0),
                    )
                if cur_job["status"] == "running":
                    cur_job["message"] = "Toplu tarama duraklatılıyor, mevcut işlem durduruluyor..."
            if 0 <= idx < len(batch["items"]) and batch["items"][idx]["status"] == "running":
                batch["items"][idx]["status"] = "paused"

            job_cancel_event = _cancel_events.get(cur_job_id)
            if job_cancel_event is not None:
                job_cancel_event.set()
            batch["current_job_id"] = None

        return _serialize_batch_locked(batch)


@app.post("/api/batches/{batch_id}/resume")
def resume_batch(batch_id: str) -> dict[str, Any]:
    worker: threading.Thread | None = None
    snapshot: dict[str, Any]

    with _jobs_lock:
        if _shutting_down:
            raise HTTPException(
                status_code=503,
                detail="Sunucu kapatılıyor, toplu tarama devam ettirilemez.",
            )

        batch = _batches.get(batch_id)
        if batch is None:
            raise HTTPException(status_code=404, detail="Toplu tarama bulunamadı.")

        if any(job["status"] == "running" for job in _jobs.values()) or any(
            b["status"] == "running" for b in _batches.values()
        ):
            raise HTTPException(
                status_code=409,
                detail="Halihazırda çalışan bir tarama işi veya toplu tarama var. Lütfen tamamlanmasını bekleyin veya iptal edin.",
            )

        if batch["status"] != "paused":
            raise HTTPException(
                status_code=409,
                detail="Yalnızca duraklatılmış bir toplu tarama devam ettirilebilir.",
            )

        resume_idx = None
        for idx, item in enumerate(batch["items"]):
            if item["status"] != "done":
                resume_idx = idx
                break

        if resume_idx is None:
            total_saved = sum(int(it["done"]) for it in batch["items"])
            _finish_batch_locked(
                batch,
                "done",
                f"Toplu tarama tamamlandı: {batch['total_items']} arama, {total_saved} işletme kaydedildi.",
            )
            return _serialize_batch_locked(batch)

        new_gen = int(batch["run_generation"]) + 1
        new_stop_event = threading.Event()
        prev_thread = batch.get("runner_thread")

        batch["run_generation"] = new_gen
        batch["stop_intent"] = None
        batch["status"] = "running"
        batch["waiting_until"] = None
        batch["current_index"] = resume_idx
        batch["current_job_id"] = None
        next_item = batch["items"][resume_idx]
        batch["message"] = (
            f"Toplu tarama devam ediyor ({resume_idx + 1}/{batch['total_items']}: "
            f"{next_item['region']} — {next_item['category']})..."
        )
        _batch_stop_events[batch_id] = new_stop_event

        worker = threading.Thread(
            target=_run_batch,
            args=(batch_id, resume_idx, new_gen, new_stop_event, prev_thread),
            name=f"batch-{batch_id}-r{new_gen}",
            daemon=True,
        )
        batch["runner_thread"] = worker
        snapshot = _serialize_batch_locked(batch)
        worker.start()

    return snapshot


@app.post("/api/batches/{batch_id}/cancel")
def cancel_batch(batch_id: str) -> dict[str, Any]:
    with _jobs_lock:
        batch = _batches.get(batch_id)
        if batch is None:
            raise HTTPException(status_code=404, detail="Toplu tarama bulunamadı.")

        if batch["status"] == "paused":
            batch["stop_intent"] = "cancel"
            stop_event = _batch_stop_events.get(batch_id)
            if stop_event is not None:
                stop_event.set()
            _mark_remaining_items_skipped_locked(batch)
            total_saved = sum(int(it["done"]) for it in batch["items"])
            _finish_batch_locked(
                batch,
                "cancelled",
                f"Toplu tarama iptal edildi ({total_saved} işletme kaydedildi).",
            )
            return {
                "batch_id": batch_id,
                "status": "cancelled",
                "cancelling": True,
            }

        if batch["status"] != "running":
            return {
                "batch_id": batch_id,
                "status": batch["status"],
                "cancelling": False,
            }

        batch["stop_intent"] = "cancel"
        stop_event = _batch_stop_events.get(batch_id)
        if stop_event is not None:
            stop_event.set()

        cur_job_id = batch.get("current_job_id")
        if cur_job_id is not None:
            idx = int(batch["current_index"])
            cur_job = _jobs.get(cur_job_id)
            if cur_job is not None:
                if 0 <= idx < len(batch["items"]):
                    batch["items"][idx]["done"] = max(
                        int(batch["items"][idx]["done"]),
                        int(cur_job.get("done") or 0),
                    )
                if cur_job["status"] == "running":
                    cur_job["message"] = "Tarama iptal ediliyor, mevcut işlem sonlandırılıyor..."
            job_cancel_event = _cancel_events.get(cur_job_id)
            if job_cancel_event is not None:
                job_cancel_event.set()
            batch["message"] = "Toplu tarama iptal ediliyor, mevcut işlem sonlandırılıyor..."
        else:
            _mark_remaining_items_skipped_locked(batch)
            total_saved = sum(int(it["done"]) for it in batch["items"])
            _finish_batch_locked(
                batch,
                "cancelled",
                f"Toplu tarama iptal edildi ({total_saved} işletme kaydedildi).",
            )

        return {
            "batch_id": batch_id,
            "status": batch["status"],
            "cancelling": True,
        }


@app.get("/api/active")
def get_active() -> dict[str, Any]:
    now_dt = datetime.now(timezone.utc)
    cutoff_dt = now_dt - timedelta(seconds=ACTIVE_FINISHED_BATCH_WINDOW_S)

    with _jobs_lock:
        active_job: dict[str, Any] | None = None
        for job_id, job in _jobs.items():
            if job["status"] == "running" and job_id not in _batch_job_ids:
                active_job = dict(job)
                break

        active_batch: dict[str, Any] | None = None
        for batch in _batches.values():
            if batch["status"] in ("running", "paused"):
                active_batch = _serialize_batch_locked(batch)
                break

        if active_batch is None:
            latest_batch: dict[str, Any] | None = None
            latest_finished_dt: datetime | None = None
            for batch in _batches.values():
                fin_dt = batch.get("finished_at_dt")
                if fin_dt is not None and fin_dt >= cutoff_dt:
                    if latest_finished_dt is None or fin_dt > latest_finished_dt:
                        latest_finished_dt = fin_dt
                        latest_batch = batch
            if latest_batch is not None:
                active_batch = _serialize_batch_locked(latest_batch)

        return {
            "job": active_job,
            "batch": active_batch,
        }


class BusinessStatusUpdateRequest(BaseModel):
    durum: str
    note: str | None = Field(default=None, alias="not")

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("durum")
    @classmethod
    def _validate_durum(cls, value: str) -> str:
        cleaned = value.strip()
        if cleaned not in db.VALID_DURUMLAR:
            raise ValueError(
                f"Geçersiz durum değeri. Geçerli değerler: {', '.join(db.VALID_DURUMLAR)}"
            )
        return cleaned


@app.get("/api/businesses")
def list_businesses(
    region: str | None = Query(default=None),
    category: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    return db.list_businesses(
        region=_clean_opt(region),
        category=_clean_opt(category),
    )


@app.patch("/api/businesses/{place_id}/status")
def update_business_status(
    place_id: str,
    payload: BusinessStatusUpdateRequest,
) -> dict[str, Any]:
    updated = db.update_status(place_id, payload.durum, note=payload.note)
    if updated is None:
        raise HTTPException(status_code=404, detail="İşletme bulunamadı.")
    return updated


@app.delete("/api/businesses")
def delete_all_businesses() -> dict[str, int]:
    deleted = db.delete_all()
    return {"deleted": deleted}


@app.get("/api/searches")
def list_searches() -> list[dict[str, Any]]:
    return db.list_searches()


class ExportRequest(BaseModel):
    ids: list[str] | None = None
    region: str | None = None
    category: str | None = None


def _parse_ids_query(raw_ids: str | None) -> list[str] | None:
    cleaned_raw = _clean_opt(raw_ids)
    if cleaned_raw is None:
        return None
    parsed = [part.strip() for part in cleaned_raw.split(",") if part.strip()]
    return parsed if parsed else None


def _build_xlsx_response(
    region: str | None,
    category: str | None,
    id_list: list[str] | None = None,
) -> FileResponse:
    clean_region = _clean_opt(region)
    clean_category = _clean_opt(category)
    rows = db.list_businesses(region=clean_region, category=clean_category)
    if id_list is not None:
        order = {pid: idx for idx, pid in enumerate(id_list)}
        rows = [row for row in rows if row.get("place_id") in order]
        rows.sort(key=lambda row: order[row["place_id"]])
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    filename = _build_export_filename(clean_region, clean_category)
    saved_path = export.export_xlsx(rows, str(EXPORTS_DIR / filename))
    resolved = Path(saved_path)
    return FileResponse(
        path=str(resolved),
        filename=resolved.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.get("/api/export.xlsx")
def export_businesses_xlsx(
    region: str | None = Query(default=None),
    category: str | None = Query(default=None),
    ids: str | None = Query(default=None),
) -> FileResponse:
    return _build_xlsx_response(region, category, _parse_ids_query(ids))


@app.post("/api/export.xlsx")
def export_businesses_xlsx_post(
    payload: ExportRequest | None = Body(default=None),
    region: str | None = Query(default=None),
    category: str | None = Query(default=None),
) -> FileResponse:
    effective_region = payload.region if payload and payload.region is not None else region
    effective_category = payload.category if payload and payload.category is not None else category
    id_list = (
        [pid.strip() for pid in payload.ids if pid and pid.strip()]
        if payload and payload.ids is not None
        else None
    )
    return _build_xlsx_response(effective_region, effective_category, id_list)


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
