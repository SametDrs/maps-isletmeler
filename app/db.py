"""SQLite persistence layer for scraped Google Maps businesses."""

from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import threading

DB_PATH = "data/isletmeler.db"
_write_lock = threading.Lock()

VALID_DURUMLAR: tuple[str, ...] = ("yeni", "bekleniyor", "onaylandi", "reddedildi")
DURUM_LABELS: dict[str, str] = {
    "yeni": "Yeni",
    "bekleniyor": "Geri dönüş bekleniyor",
    "onaylandi": "Onaylandı",
    "reddedildi": "Reddedildi",
}

BUSINESS_COLUMNS = (
    "place_id",
    "name",
    "address",
    "lat",
    "lng",
    "category",
    "phone",
    "website",
    "rating",
    "review_count",
    "hours",
    "maps_url",
    "search_region",
    "search_category",
    "scraped_at",
)

STATUS_COLUMNS = (
    "durum",
    "not",
    "durum_guncellendi",
)

SELECT_COLUMNS = (*BUSINESS_COLUMNS, *STATUS_COLUMNS)

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id TEXT UNIQUE,
    name TEXT,
    address TEXT,
    lat REAL,
    lng REAL,
    category TEXT,
    phone TEXT,
    website TEXT,
    rating REAL,
    review_count INTEGER,
    hours TEXT,
    maps_url TEXT,
    search_region TEXT,
    search_category TEXT,
    scraped_at TEXT,
    durum TEXT NOT NULL DEFAULT 'yeni',
    "not" TEXT,
    durum_guncellendi TEXT
);
CREATE INDEX IF NOT EXISTS idx_businesses_maps_url
    ON businesses (maps_url);
CREATE INDEX IF NOT EXISTS idx_businesses_search
    ON businesses (search_region, search_category);
"""


def _resolve_path(path: str | None) -> str:
    return DB_PATH if path is None else path


def _connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn


def _row_to_dict(row: sqlite3.Row) -> dict:
    item = dict(row)
    if not item.get("durum"):
        item["durum"] = "yeni"
    return item


def _migrate_columns(conn: sqlite3.Connection) -> None:
    existing_cols = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(businesses)").fetchall()
    }
    migrations = (
        ("durum", "ALTER TABLE businesses ADD COLUMN durum TEXT NOT NULL DEFAULT 'yeni'"),
        ("not", 'ALTER TABLE businesses ADD COLUMN "not" TEXT'),
        ("durum_guncellendi", "ALTER TABLE businesses ADD COLUMN durum_guncellendi TEXT"),
    )
    for col_name, alter_sql in migrations:
        if col_name not in existing_cols:
            conn.execute(alter_sql)


def init_db(path: str | None = None) -> None:
    """Create database directory and businesses table if they do not exist."""
    resolved_path = _resolve_path(path)
    if resolved_path != ":memory:":
        Path(resolved_path).parent.mkdir(parents=True, exist_ok=True)
    with closing(_connect(resolved_path)) as conn:
        if resolved_path != ":memory:":
            conn.execute("PRAGMA journal_mode=WAL;")
        conn.executescript(_SCHEMA_SQL)
        with conn:
            _migrate_columns(conn)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_businesses_durum ON businesses (durum)"
            )


def _normalize_business_values(b: dict) -> list[object]:
    values: list[object] = []
    for col in BUSINESS_COLUMNS:
        val = b.get(col)
        if col == "place_id" and val == "":
            val = None
        elif col == "maps_url" and val == "":
            val = None
        elif col == "hours" and isinstance(val, dict):
            val = json.dumps(val, ensure_ascii=False)
        values.append(val)
    return values


def _find_existing_id(
    conn: sqlite3.Connection, place_id: object, maps_url: object
) -> int | None:
    if place_id is not None:
        row = conn.execute(
            "SELECT id FROM businesses WHERE place_id = ?",
            (place_id,),
        ).fetchone()
        if row is not None:
            return int(row["id"])
    if maps_url is not None:
        row = conn.execute(
            "SELECT id FROM businesses WHERE maps_url = ?",
            (maps_url,),
        ).fetchone()
        if row is not None:
            return int(row["id"])
    return None


def upsert_business(b: dict, path: str | None = None) -> None:
    """Insert or update a business record keyed by place_id (fallback: maps_url)."""
    resolved_path = _resolve_path(path)
    values = _normalize_business_values(b)
    place_id = values[0]
    maps_url = values[BUSINESS_COLUMNS.index("maps_url")]

    with _write_lock:
        with closing(_connect(resolved_path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                existing_id = _find_existing_id(conn, place_id, maps_url)
                if existing_id is not None:
                    assignments = ", ".join(
                        'place_id = COALESCE(?, place_id)'
                        if col == "place_id"
                        else f'"{col}" = ?'
                        for col in BUSINESS_COLUMNS
                    )
                    conn.execute(
                        f"UPDATE businesses SET {assignments} WHERE id = ?",
                        (*values, existing_id),
                    )
                else:
                    cols_sql = ", ".join(f'"{col}"' for col in BUSINESS_COLUMNS)
                    placeholders = ", ".join("?" for _ in BUSINESS_COLUMNS)
                    conn.execute(
                        f"INSERT INTO businesses ({cols_sql}) VALUES ({placeholders})",
                        values,
                    )
                conn.commit()
            except Exception:
                conn.rollback()
                raise


def list_businesses(
    region: str | None = None,
    category: str | None = None,
    path: str | None = None,
) -> list[dict]:
    """Return businesses optionally filtered by search_region and search_category."""
    resolved_path = _resolve_path(path)
    if resolved_path != ":memory:" and not Path(resolved_path).exists():
        return []

    clauses: list[str] = []
    params: list[object] = []
    if region:
        clauses.append("search_region = ?")
        params.append(region)
    if category:
        clauses.append("search_category = ?")
        params.append(category)

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    cols_sql = ", ".join(f'"{col}"' for col in SELECT_COLUMNS)
    query = (
        f"SELECT {cols_sql} FROM businesses "
        f"{where_sql} "
        "ORDER BY scraped_at DESC, id DESC"
    )

    with closing(_connect(resolved_path)) as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(row) for row in rows]


def update_status(
    place_id: str,
    durum: str,
    note: str | None = None,
    path: str | None = None,
) -> dict | None:
    """Update a business's follow-up status and optional note by place_id."""
    if durum not in VALID_DURUMLAR:
        raise ValueError(f"Geçersiz durum değeri: {durum!r}")

    resolved_path = _resolve_path(path)
    if resolved_path != ":memory:" and not Path(resolved_path).exists():
        return None

    with _write_lock:
        with closing(_connect(resolved_path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    "SELECT id FROM businesses WHERE place_id = ?",
                    (place_id,),
                ).fetchone()
                if row is None:
                    conn.rollback()
                    return None

                row_id = int(row["id"])
                updated_at = datetime.now(timezone.utc).isoformat()
                if note is not None:
                    conn.execute(
                        'UPDATE businesses SET durum = ?, "not" = ?, durum_guncellendi = ? WHERE id = ?',
                        (durum, note, updated_at, row_id),
                    )
                else:
                    conn.execute(
                        "UPDATE businesses SET durum = ?, durum_guncellendi = ? WHERE id = ?",
                        (durum, updated_at, row_id),
                    )

                cols_sql = ", ".join(f'"{col}"' for col in SELECT_COLUMNS)
                updated_row = conn.execute(
                    f"SELECT {cols_sql} FROM businesses WHERE id = ?",
                    (row_id,),
                ).fetchone()
                conn.commit()
                return _row_to_dict(updated_row) if updated_row is not None else None
            except Exception:
                conn.rollback()
                raise


def delete_all(path: str | None = None) -> int:
    """Delete all business records and return the number of deleted rows."""
    resolved_path = _resolve_path(path)
    if resolved_path != ":memory:" and not Path(resolved_path).exists():
        return 0

    with _write_lock:
        with closing(_connect(resolved_path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                count_row = conn.execute("SELECT COUNT(*) AS cnt FROM businesses").fetchone()
                deleted = int(count_row["cnt"]) if count_row is not None else 0
                conn.execute("DELETE FROM businesses")
                conn.commit()
                return deleted
            except Exception:
                conn.rollback()
                raise


def list_searches(path: str | None = None) -> list[dict]:
    """Return distinct searches with business count and most recent scrape time."""
    resolved_path = _resolve_path(path)
    if resolved_path != ":memory:" and not Path(resolved_path).exists():
        return []

    query = """
        SELECT
            search_region,
            search_category,
            COUNT(*) AS count,
            MAX(scraped_at) AS last_scraped_at
        FROM businesses
        GROUP BY search_region, search_category
        ORDER BY last_scraped_at DESC
    """
    with closing(_connect(resolved_path)) as conn:
        rows = conn.execute(query).fetchall()
    return [dict(row) for row in rows]
