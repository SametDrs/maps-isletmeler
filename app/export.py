"""Excel (.xlsx) export utilities for scraped business records."""

import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.db import DURUM_LABELS

EXPORT_COLUMNS: tuple[tuple[str, str], ...] = (
    ("name", "İşletme Adı"),
    ("category", "Kategori"),
    ("address", "Adres"),
    ("phone", "Telefon"),
    ("website", "Web Sitesi"),
    ("rating", "Puan"),
    ("review_count", "Yorum Sayısı"),
    ("hours", "Çalışma Saatleri"),
    ("lat", "Enlem"),
    ("lng", "Boylam"),
    ("place_id", "Place ID"),
    ("maps_url", "Google Maps URL"),
    ("search_region", "Arama Bölgesi"),
    ("search_category", "Arama Türü"),
    ("scraped_at", "Çekilme Zamanı"),
    ("durum", "Durum"),
    ("not", "Not"),
)

TURKISH_WEEKDAY_ORDER: tuple[str, ...] = (
    "Pazartesi",
    "Salı",
    "Çarşamba",
    "Perşembe",
    "Cuma",
    "Cumartesi",
    "Pazar",
)


def _format_hours(raw_hours: object) -> str | None:
    if raw_hours is None or raw_hours == "":
        return None

    parsed: object = raw_hours
    if isinstance(raw_hours, str):
        try:
            parsed = json.loads(raw_hours)
        except json.JSONDecodeError:
            return raw_hours

    if not isinstance(parsed, dict) or not parsed:
        return str(raw_hours) if raw_hours else None

    order_map = {day.casefold(): idx for idx, day in enumerate(TURKISH_WEEKDAY_ORDER)}
    ordered_items = sorted(
        parsed.items(),
        key=lambda kv: (order_map.get(str(kv[0]).casefold(), len(TURKISH_WEEKDAY_ORDER)), str(kv[0])),
    )
    lines = [f"{day}: {hours}" for day, hours in ordered_items if hours]
    return "\n".join(lines) if lines else None


def export_xlsx(rows: list[dict], path: str) -> str:
    """Export business dicts to a formatted Turkish-header Excel file and return path."""
    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    wb = Workbook()
    ws = wb.active
    ws.title = "İşletmeler"

    header_font = Font(bold=True)
    header_fill = PatternFill(start_color="E9EEF5", end_color="E9EEF5", fill_type="solid")
    header_align = Alignment(vertical="center", horizontal="left")
    cell_align = Alignment(vertical="top", horizontal="left")
    wrap_align = Alignment(vertical="top", horizontal="left", wrap_text=True)

    headers = [header for _, header in EXPORT_COLUMNS]
    ws.append(headers)
    for col_idx in range(1, len(EXPORT_COLUMNS) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align

    ws.freeze_panes = "A2"

    col_widths = [len(header) for header in headers]

    for row_idx, row in enumerate(rows, start=2):
        for col_idx, (key, _) in enumerate(EXPORT_COLUMNS, start=1):
            value = row.get(key)
            if key == "hours":
                value = _format_hours(value)
            elif key == "durum":
                value = DURUM_LABELS.get(value or "yeni", str(value) if value else "Yeni")

            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            if isinstance(value, str) and value.startswith("="):
                cell.data_type = "s"
            cell.alignment = wrap_align if key in ("hours", "not") else cell_align

            if value is not None:
                max_line = max((len(line) for line in str(value).splitlines()), default=0)
                if max_line > col_widths[col_idx - 1]:
                    col_widths[col_idx - 1] = max_line

    for col_idx, max_len in enumerate(col_widths, start=1):
        col_letter = get_column_letter(col_idx)
        ws.column_dimensions[col_letter].width = min(max(max_len + 3, 10), 50)

    wb.save(out_path)
    return path
