"""Sync Playwright Google Maps business scraper."""

from datetime import datetime, timezone
import json
import logging
import os
import queue
import re
import threading
import time
from typing import Callable
from urllib.parse import parse_qs, quote, unquote, urlencode, urljoin, urlsplit, urlunsplit

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright

logger = logging.getLogger(__name__)

# --- CSS Selectors (centralized for Google Maps DOM updates) ---
BODY_SELECTOR = "body"
CONSENT_BUTTON_SELECTORS = (
    "button[aria-label*='Tümünü kabul et']",
    "button[aria-label*='Accept all']",
    "button:has-text('Tümünü kabul et')",
    "button:has-text('Accept all')",
    "button:has-text('Kabul ediyorum')",
    "button:has-text('I agree')",
    "input[type='submit'][value*='Tümünü kabul et']",
    "input[type='submit'][value*='Accept all']",
    "form[action*='consent'] button:has-text('kabul')",
)
CAPTCHA_SELECTORS = (
    "form#captcha-form",
    "iframe[src*='recaptcha']",
    "#recaptcha",
)
FEED_SELECTOR = "div[role='feed']"
PLACE_LINK_SELECTOR = "a[href*='/maps/place/']"
# Direct result cards of the feed: feed > wrapper > card > a (excludes nested/other links).
FEED_RESULT_LINK_SELECTOR = ":scope > div > div > a[href*='/maps/place/']"
MAIN_PANE_SELECTOR = "div[role='main']"
NAME_SELECTOR = "div[role='main'] h1, h1"
CATEGORY_SELECTOR = "button[jsaction*='category'], button.DkEaL"
ADDRESS_SELECTOR = "button[data-item-id='address']"
PHONE_SELECTOR = "button[data-item-id^='phone:tel:']"
WEBSITE_SELECTOR = "a[data-item-id='authority']"
ITEM_TEXT_INNER_SELECTOR = ".Io6YTe"
HEADER_RATING_CONTAINER_SELECTOR = "div.F7nice"
RATING_ARIA_SELECTOR = (
    "div.F7nice span[role='img'][aria-label], "
    "div[role='main'] span[role='img'][aria-label*='yıldız'], "
    "div[role='main'] span[role='img'][aria-label*='star']"
)
REVIEW_COUNT_ARIA_SELECTOR = (
    "div.F7nice span[aria-label], "
    "div.F7nice button[aria-label], "
    "div[role='main'] span[aria-label*='yorum'], "
    "div[role='main'] button[aria-label*='yorum'], "
    "div[role='main'] span[aria-label*='review'], "
    "div[role='main'] button[aria-label*='review']"
)
HOURS_TOGGLE_SELECTOR = (
    "button[data-item-id='oh'], "
    "div[jsaction*='openhours'] [role='button'], "
    "div[jsaction*='openhours'] button, "
    "div.OMl5r[aria-expanded]"
)
HOURS_TABLE_ROW_SELECTOR = (
    "table.eK4R0e tr, "
    "div[jsaction*='openhours'] table tr, "
    "table.WgFkxc tr"
)
HOURS_ROW_CELL_SELECTOR = "td, th"
HEADER_REVIEW_TEXT_SELECTOR = "div.F7nice, div.F7nice + div"

# --- Browser ---
# Installed browser channel used by Playwright ("msedge", "chrome"). Empty string = bundled Chromium.
BROWSER_CHANNEL = os.environ.get("MAPS_BROWSER_CHANNEL", "msedge")

# --- Scraper behavior constants ---
END_OF_LIST_PHRASES = (
    "listenin sonuna ulaştınız",
    "you've reached the end of the list",
    "end of the list",
)
NO_RESULTS_PHRASES = (
    "sonuç bulunamadı",
    "no results found",
    "google maps can't find",
    "bulamadı",
)
CAPTCHA_BODY_PHRASES = (
    "unusual traffic",
    "olağandışı trafik",
    "not a robot",
    "robot olmadığınızı",
    "automated queries",
    "otomatik sorgular",
)
SPONSORED_LABELS = frozenset({"sponsorlu", "sponsored", "reklam"})
FEED_SETTLE_POLL_S = 0.6
FEED_SETTLE_STABLE_POLLS = 3
FEED_SETTLE_MAX_S = 10.0
MAX_STAGNANT_SCROLLS = 5
VOLATILE_QUERY_PARAMS = frozenset({"authuser", "rclk", "hl", "entry", "g_ep", "ttu"})

_RE_PUA = re.compile(r"[\ue000-\uf8ff]")
_RE_PIN_COORDS = re.compile(r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)")
_RE_AT_COORDS = re.compile(r"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)")
_RE_PLACE_ID_19S = re.compile(r"!19s(ChIJ[A-Za-z0-9_-]+)")
_RE_PLACE_ID_1S = re.compile(r"!1s((?:ChIJ[A-Za-z0-9_-]+)|(?:0x[0-9a-fA-F]+:0x[0-9a-fA-F]+))")
_RE_PLACE_ID_HEX = re.compile(r"(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)")
_RE_PLACE_ID_CHIJ = re.compile(r"(ChIJ[A-Za-z0-9_-]{10,})")
_RE_RATING = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:yıldız|stars?)?", re.IGNORECASE)
_RE_REVIEW_WITH_WORD = re.compile(
    r"(\d[\d.,]*)\s*(bin|b|k|m)?\s*(?:yorum|reviews?)", re.IGNORECASE
)
_RE_REVIEW_PAREN = re.compile(r"^\(\s*(\d[\d.,]*)\s*(bin|b|k|m)?\s*\)$", re.IGNORECASE)
_RE_REVIEW_PAREN_ANYWHERE = re.compile(r"\(\s*(\d[\d.,]*)\s*(bin|b|k|m)?\s*\)", re.IGNORECASE)
_RE_WS_VARIANTS = re.compile(r"[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]")
_RE_DASH_VARIANTS = re.compile(r"[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]")


class CaptchaDetected(Exception):
    """Raised when Google shows a CAPTCHA or unusual traffic block page."""


class ScrapeCancelled(Exception):
    """Raised when scraping is stopped via should_stop callback."""


def _check_stop(should_stop: Callable[[], bool] | None) -> None:
    if should_stop is not None and should_stop():
        raise ScrapeCancelled("Scraping cancelled by caller.")


def _emit_progress(
    on_progress: Callable[[int, int, str], None] | None,
    done: int,
    total_found: int,
    message: str,
) -> None:
    if on_progress is not None:
        on_progress(done, total_found, message)


def _clean_text(text: str | None) -> str | None:
    if not text:
        return None
    cleaned = _RE_PUA.sub("", text)
    cleaned = " ".join(cleaned.split()).strip()
    return cleaned or None


def _ensure_hl_tr(url: str) -> str:
    parts = urlsplit(url)
    qs = parse_qs(parts.query, keep_blank_values=True)
    qs["hl"] = ["tr"]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(qs, doseq=True), ""))


def _canonical_maps_url(url: str) -> str:
    parts = urlsplit(url)
    qs = parse_qs(parts.query, keep_blank_values=True)
    filtered = {k: v for k, v in qs.items() if k not in VOLATILE_QUERY_PARAMS}
    query = urlencode(filtered, doseq=True)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


def _extract_place_id(url: str | None) -> str | None:
    if not url:
        return None
    decoded = unquote(url)
    # Prefer the stable ChIJ... id (after !19s), then any ChIJ..., then the hex feature id.
    for pattern in (_RE_PLACE_ID_19S, _RE_PLACE_ID_CHIJ):
        match = pattern.search(decoded)
        if match:
            return match.group(1)
    match_1s = _RE_PLACE_ID_1S.search(decoded)
    if match_1s:
        return match_1s.group(1)
    match_hex = _RE_PLACE_ID_HEX.search(decoded)
    if match_hex:
        return match_hex.group(1)
    return None


def _extract_lat_lng(*urls: str | None) -> tuple[float | None, float | None]:
    for url in urls:
        if not url:
            continue
        match = _RE_PIN_COORDS.search(unquote(url))
        if match:
            return float(match.group(1)), float(match.group(2))
    for url in urls:
        if not url:
            continue
        match = _RE_AT_COORDS.search(unquote(url))
        if match:
            return float(match.group(1)), float(match.group(2))
    return None, None


def _parse_rating(label: str | None) -> float | None:
    if not label:
        return None
    match = _RE_RATING.search(label)
    if not match:
        return None
    try:
        val = float(match.group(1).replace(",", "."))
    except ValueError:
        return None
    return val if 0.0 <= val <= 5.0 else None


def _normalize_spaces(text: str) -> str:
    return " ".join(_RE_WS_VARIANTS.sub(" ", text).split())


def _tr_number_to_int(number: str, suffix: str | None = None) -> int | None:
    """Parse Turkish-formatted counts: '1.234' -> 1234, '1,2 B'/'1,2 bin' -> 1200."""
    number = number.strip().strip(".,")
    if not number:
        return None
    multiplier = {"b": 1_000, "bin": 1_000, "k": 1_000, "m": 1_000_000}.get((suffix or "").casefold(), 1)
    if multiplier > 1:
        try:
            return int(round(float(number.replace(",", ".")) * multiplier))
        except ValueError:
            return None
    digits = re.sub(r"[.,\s]", "", number)
    return int(digits) if digits.isdigit() else None


def _parse_review_count(label: str | None) -> int | None:
    """Parse '1.234 yorum', '1,234 reviews' or '(1.234)' into an int."""
    if not label:
        return None
    text = _normalize_spaces(label)
    match = _RE_REVIEW_WITH_WORD.search(text) or _RE_REVIEW_PAREN.search(text)
    if not match:
        return None
    return _tr_number_to_int(match.group(1), match.group(2))


def _check_captcha(page: Page) -> None:
    url_lower = page.url.lower()
    if "/sorry/" in url_lower:
        raise CaptchaDetected(f"Google sorry/CAPTCHA URL detected: {page.url}")

    for selector in CAPTCHA_SELECTORS:
        try:
            if page.locator(selector).count() > 0:
                raise CaptchaDetected(f"CAPTCHA element detected ({selector})")
        except CaptchaDetected:
            raise
        except Exception:
            continue

    try:
        title = page.title().lower()
        if "captcha" in title:
            raise CaptchaDetected("CAPTCHA title detected")
    except CaptchaDetected:
        raise
    except Exception:
        pass

    try:
        body_text = page.locator(BODY_SELECTOR).inner_text(timeout=1500).lower()
        for phrase in CAPTCHA_BODY_PHRASES:
            if phrase in body_text:
                raise CaptchaDetected(f"Unusual traffic / CAPTCHA phrase detected: {phrase}")
    except CaptchaDetected:
        raise
    except Exception:
        pass


def _handle_consent(page: Page) -> bool:
    for selector in CONSENT_BUTTON_SELECTORS:
        try:
            btn = page.locator(selector).first
            if btn.count() > 0 and btn.is_visible(timeout=500):
                logger.info("Consent dialog detected; clicking accept button (%s)", selector)
                btn.click(timeout=5000)
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=10000)
                except PlaywrightTimeoutError:
                    pass
                page.wait_for_timeout(1000)
                return True
        except Exception:
            continue
    return False


def _has_nonempty_place_heading(page: Page) -> bool:
    try:
        headings = page.locator(NAME_SELECTOR)
        for idx in range(min(headings.count(), 5)):
            text = _clean_text(headings.nth(idx).inner_text(timeout=500))
            if text and text.casefold() not in {"sonuçlar", "results"}:
                return True
    except Exception:
        pass
    return False


def _has_no_results(page: Page) -> bool:
    try:
        body_text = page.locator(BODY_SELECTOR).inner_text(timeout=1000).lower()
    except Exception:
        return False
    return any(phrase in body_text for phrase in NO_RESULTS_PHRASES)


def _wait_for_search_state(page: Page, should_stop: Callable[[], bool] | None) -> str:
    start = time.monotonic()
    deadline = start + 15.0

    while time.monotonic() < deadline:
        _check_stop(should_stop)
        _check_captcha(page)
        if _handle_consent(page):
            deadline = max(deadline, time.monotonic() + 12.0)
            continue

        try:
            feed = page.locator(FEED_SELECTOR).first
            if feed.count() > 0 and feed.is_visible(timeout=300):
                return "feed"
        except Exception:
            pass

        if "/maps/place/" in page.url and _has_nonempty_place_heading(page):
            return "single"

        elapsed = time.monotonic() - start
        if elapsed > 4.0:
            try:
                has_place_widgets = (
                    page.locator(ADDRESS_SELECTOR).count() > 0
                    or page.locator(CATEGORY_SELECTOR).count() > 0
                )
                if has_place_widgets and page.locator(FEED_SELECTOR).count() == 0 and _has_nonempty_place_heading(page):
                    return "single"
            except Exception:
                pass

            if (
                page.locator(FEED_SELECTOR).count() == 0
                and page.locator(PLACE_LINK_SELECTOR).count() == 0
                and _has_no_results(page)
            ):
                return "empty"

        page.wait_for_timeout(300)

    _check_captcha(page)
    if page.locator(FEED_SELECTOR).count() > 0:
        return "feed"
    if "/maps/place/" in page.url and _has_nonempty_place_heading(page):
        return "single"
    return "empty"


_FEED_CARDS_JS = """
(feed, args) => {
  const [selector, labels] = args;
  const nl = String.fromCharCode(10);
  const out = [];
  feed.querySelectorAll(selector).forEach(a => {
    const card = a.parentElement;
    const lines = ((card && card.innerText) || '').split(nl).map(t => t.trim().toLowerCase());
    const sponsored = lines.some(t => labels.includes(t));
    out.push({href: a.getAttribute('href'), sponsored: sponsored,
              name: a.getAttribute('aria-label') || ''});
  });
  return out;
}
"""


def _read_feed_cards(feed) -> list[dict]:
    """Direct result cards of the feed, in DOM order, flagged when sponsored."""
    labels = sorted(SPONSORED_LABELS)
    cards = feed.evaluate(_FEED_CARDS_JS, [FEED_RESULT_LINK_SELECTOR, labels])
    if not cards:
        # Layout changed: fall back to any place link inside the feed.
        cards = feed.evaluate(_FEED_CARDS_JS, [PLACE_LINK_SELECTOR, labels])
    return cards or []


def _wait_feed_settled(
    page: Page,
    feed,
    should_stop: Callable[[], bool] | None,
) -> None:
    """Wait until the feed's card list stops changing (ads/late results are injected after load)."""
    deadline = time.monotonic() + FEED_SETTLE_MAX_S
    last: tuple | None = None
    stable = 0
    while time.monotonic() < deadline:
        _check_stop(should_stop)
        try:
            snapshot = tuple((c["href"], c["sponsored"]) for c in _read_feed_cards(feed))
        except Exception:
            snapshot = ()
        if snapshot and snapshot == last:
            stable += 1
            if stable >= FEED_SETTLE_STABLE_POLLS:
                return
        else:
            stable = 0
            last = snapshot
        page.wait_for_timeout(int(FEED_SETTLE_POLL_S * 1000))


def _wait_after_scroll(
    page: Page,
    feed,
    prev_card_count: int,
    should_stop: Callable[[], bool] | None,
) -> None:
    """Wait briefly for newly scrolled feed cards or end-of-list marker to settle."""
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        _check_stop(should_stop)
        try:
            if len(_read_feed_cards(feed)) > prev_card_count:
                return
            feed_text = feed.inner_text(timeout=500).lower()
            if any(phrase in feed_text for phrase in END_OF_LIST_PHRASES):
                return
        except Exception:
            pass
        page.wait_for_timeout(200)


def _collect_place_urls(
    page: Page,
    max_results: int,
    on_progress: Callable[[int, int, str], None] | None,
    should_stop: Callable[[], bool] | None,
) -> list[str]:
    urls: list[str] = []
    seen_keys: set[str] = set()
    stagnant_scrolls = 0
    feed = page.locator(FEED_SELECTOR).first

    _wait_feed_settled(page, feed, should_stop)

    while len(urls) < max_results:
        _check_stop(should_stop)
        _check_captcha(page)

        prev_count = len(urls)
        try:
            cards = _read_feed_cards(feed)
        except Exception as exc:
            logger.warning("Failed reading feed place links: %s", exc)
            cards = []
        prev_card_count = len(cards)

        for card in cards:
            href = card.get("href")
            if not href:
                continue
            if card.get("sponsored"):
                logger.info("Skipping sponsored result: %s", card.get("name"))
                continue
            full_url = urljoin("https://www.google.com", href)
            canon = _canonical_maps_url(full_url)
            dedup_key = _extract_place_id(full_url) or canon
            if dedup_key not in seen_keys:
                seen_keys.add(dedup_key)
                urls.append(_ensure_hl_tr(full_url))
                if len(urls) >= max_results:
                    break

        if len(urls) > prev_count:
            stagnant_scrolls = 0
            _emit_progress(
                on_progress,
                0,
                len(urls),
                f"{len(urls)} işletme bağlantısı bulundu...",
            )
        else:
            stagnant_scrolls += 1

        if len(urls) >= max_results:
            break

        try:
            feed_text = feed.inner_text(timeout=1500).lower()
            if any(phrase in feed_text for phrase in END_OF_LIST_PHRASES):
                logger.info("Reached end of results feed (%d links collected)", len(urls))
                break
        except Exception:
            pass

        if stagnant_scrolls >= MAX_STAGNANT_SCROLLS:
            logger.info(
                "Stopping feed scroll after %d stagnant scrolls (%d links collected)",
                stagnant_scrolls,
                len(urls),
            )
            break

        try:
            feed.evaluate("el => { el.scrollTop = el.scrollHeight; }")
        except Exception as exc:
            logger.warning("Feed scroll failed: %s", exc)
            break

        _wait_after_scroll(page, feed, prev_card_count, should_stop)

    return urls[:max_results]


def _extract_name(page: Page) -> str | None:
    try:
        headings = page.locator(NAME_SELECTOR)
        for idx in range(min(headings.count(), 5)):
            text = _clean_text(headings.nth(idx).inner_text(timeout=1000))
            if text and text.casefold() not in {"sonuçlar", "results"}:
                return text
    except Exception:
        pass
    return None


def _extract_simple_text(page: Page, selector: str) -> str | None:
    try:
        loc = page.locator(selector).first
        if loc.count() == 0:
            return None
        return _clean_text(loc.inner_text(timeout=1500))
    except Exception:
        return None


def _strip_prefixes(text: str, prefixes: tuple[str, ...]) -> str:
    stripped = text.strip()
    lowered = stripped.casefold()
    for prefix in prefixes:
        if lowered.startswith(prefix.casefold()):
            return stripped[len(prefix) :].strip()
    return stripped


def _extract_item_text(
    page: Page, selector: str, prefixes: tuple[str, ...]
) -> str | None:
    try:
        loc = page.locator(selector).first
        if loc.count() == 0:
            return None

        inner = loc.locator(ITEM_TEXT_INNER_SELECTOR).first
        if inner.count() > 0:
            text = _clean_text(inner.inner_text(timeout=1500))
            if text:
                return text

        aria = loc.get_attribute("aria-label")
        if aria:
            cleaned = _clean_text(_strip_prefixes(aria, prefixes))
            if cleaned:
                return cleaned

        raw = _clean_text(loc.inner_text(timeout=1500))
        if raw:
            return _clean_text(_strip_prefixes(raw, prefixes))
    except Exception:
        pass
    return None


def _extract_phone(page: Page) -> str | None:
    phone = _extract_item_text(page, PHONE_SELECTOR, prefixes=("Telefon:", "Phone:"))
    if phone:
        return phone
    try:
        loc = page.locator(PHONE_SELECTOR).first
        if loc.count() > 0:
            item_id = loc.get_attribute("data-item-id") or ""
            if item_id.startswith("phone:tel:"):
                return _clean_text(item_id.removeprefix("phone:tel:"))
    except Exception:
        pass
    return None


def _extract_website(page: Page) -> str | None:
    try:
        loc = page.locator(WEBSITE_SELECTOR).first
        if loc.count() == 0:
            return None
        href = loc.get_attribute("href")
        if not href:
            return None
        parts = urlsplit(href)
        if parts.path == "/url":
            qs = parse_qs(parts.query)
            target = qs.get("q") or qs.get("url")
            if target and target[0]:
                return target[0].strip()
        return href.strip() or None
    except Exception:
        return None


def _extract_rating_and_reviews(page: Page) -> tuple[float | None, int | None]:
    rating: float | None = None
    review_count: int | None = None

    try:
        rating_nodes = page.locator(RATING_ARIA_SELECTOR)
        for idx in range(min(rating_nodes.count(), 10)):
            label = rating_nodes.nth(idx).get_attribute("aria-label")
            if not label:
                continue
            if rating is None:
                rating = _parse_rating(label)
            if review_count is None:
                review_count = _parse_review_count(label)
            if rating is not None and review_count is not None:
                return rating, review_count
    except Exception:
        pass

    try:
        review_nodes = page.locator(REVIEW_COUNT_ARIA_SELECTOR)
        labels: list[str] = []
        for idx in range(min(review_nodes.count(), 15)):
            label = review_nodes.nth(idx).get_attribute("aria-label")
            if label:
                labels.append(label)

        for label in labels:
            lowered = label.casefold()
            if "yorum" in lowered or "review" in lowered:
                parsed = _parse_review_count(label)
                if parsed is not None:
                    review_count = parsed
                    break

        if review_count is None:
            for label in labels:
                lowered = label.casefold()
                if "yıldız" in lowered or "star" in lowered:
                    continue
                parsed = _parse_review_count(label)
                if parsed is not None:
                    review_count = parsed
                    break
    except Exception:
        pass

    if review_count is None:
        try:
            header_nodes = page.locator(HEADER_REVIEW_TEXT_SELECTOR)
            for idx in range(min(header_nodes.count(), 4)):
                header_text = header_nodes.nth(idx).inner_text(timeout=800)
                match = _RE_REVIEW_PAREN_ANYWHERE.search(_normalize_spaces(header_text or ""))
                if match:
                    review_count = _tr_number_to_int(match.group(1), match.group(2))
                    if review_count is not None:
                        break
        except Exception:
            pass

    if rating is None:
        try:
            header_text = _clean_text(
                page.locator(HEADER_RATING_CONTAINER_SELECTOR).first.inner_text(timeout=1000)
            )
            if header_text:
                first_token = header_text.split()[0]
                if "," in first_token or "." in first_token:
                    rating = _parse_rating(first_token)
        except Exception:
            pass

    return rating, review_count


def _normalize_hours_text(text: str) -> str:
    """Dashes -> '-', exotic/narrow no-break spaces -> ' ', whitespace collapsed."""
    return " ".join(_RE_WS_VARIANTS.sub(" ", _RE_DASH_VARIANTS.sub("-", text)).split())


def _clean_hours_value(text: str | None) -> str | None:
    if not text:
        return None
    parts = []
    for line in text.splitlines():
        cleaned = _clean_text(_normalize_hours_text(line))
        if cleaned:
            parts.append(cleaned)
    return ", ".join(parts) if parts else None


def _read_hours_rows(page: Page) -> dict[str, str]:
    hours_map: dict[str, str] = {}
    rows = page.locator(HOURS_TABLE_ROW_SELECTOR)
    for idx in range(rows.count()):
        cells = rows.nth(idx).locator(HOURS_ROW_CELL_SELECTOR)
        if cells.count() < 2:
            continue
        # text_content works for collapsed (hidden) rows where inner_text is empty.
        raw_day = cells.nth(0).text_content(timeout=800)
        raw_hours = cells.nth(1).inner_text(timeout=800) or cells.nth(1).text_content(timeout=800)
        day = _clean_text(_normalize_hours_text(raw_day or ""))
        hours_text = _clean_hours_value(raw_hours)
        if day:
            day = day.rstrip(":").strip()
        if day and hours_text:
            hours_map[day] = hours_text
    return hours_map


def _extract_hours(page: Page) -> dict[str, str] | None:
    try:
        hours_map = _read_hours_rows(page)

        # Collapsed view only lists today; expand to get all 7 weekdays.
        if len(hours_map) < 7:
            toggle = page.locator(HOURS_TOGGLE_SELECTOR).first
            if toggle.count() > 0:
                try:
                    if toggle.get_attribute("aria-expanded") != "true":
                        toggle.click(timeout=2500)
                except Exception:
                    pass
                for _ in range(8):
                    page.wait_for_timeout(300)
                    hours_map = _read_hours_rows(page)
                    if len(hours_map) >= 7:
                        break

        if len(hours_map) < 7:
            logger.info("Only %d/7 weekday rows available for hours", len(hours_map))
        return hours_map or None
    except Exception:
        return None


def _extract_place_details(
    page: Page,
    source_url: str,
    region: str,
    category: str,
) -> dict:
    current_url = page.url
    canonical_src = current_url if "/maps/place/" in current_url else source_url
    maps_url = _canonical_maps_url(canonical_src)
    place_id = (
        _extract_place_id(current_url)
        or _extract_place_id(source_url)
        or maps_url
    )
    lat, lng = _extract_lat_lng(current_url, source_url)
    name = _extract_name(page)
    biz_category = _extract_simple_text(page, CATEGORY_SELECTOR)
    address = _extract_item_text(page, ADDRESS_SELECTOR, prefixes=("Adres:", "Address:"))
    phone = _extract_phone(page)
    website = _extract_website(page)
    rating, review_count = _extract_rating_and_reviews(page)
    hours_dict = _extract_hours(page)
    hours_json = json.dumps(hours_dict, ensure_ascii=False) if hours_dict else None

    return {
        "place_id": place_id,
        "name": name,
        "address": address,
        "lat": lat,
        "lng": lng,
        "category": biz_category,
        "phone": phone,
        "website": website,
        "rating": rating,
        "review_count": review_count,
        "hours": hours_json,
        "maps_url": maps_url,
        "search_region": region,
        "search_category": category,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def _launch_browser_session(playwright_obj, headless: bool):
    browser = None
    context = None
    try:
        browser = playwright_obj.chromium.launch(
            channel=BROWSER_CHANNEL or None,
            headless=headless,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            locale="tr-TR",
            timezone_id="Europe/Istanbul",
            viewport={"width": 1280, "height": 900},
        )
        context.set_default_timeout(15000)
        page = context.new_page()
        return browser, context, page
    except Exception:
        _close_browser_session(context, browser)
        raise


def _close_browser_session(context, browser) -> None:
    if context is not None:
        try:
            context.close()
        except Exception:
            pass
    if browser is not None:
        try:
            browser.close()
        except Exception:
            pass


def _is_target_closed_error(page: Page, exc: BaseException) -> bool:
    try:
        if page.is_closed():
            return True
    except Exception:
        return True
    if type(exc).__name__ == "TargetClosedError":
        return True
    msg = str(exc).lower()
    return (
        "target closed" in msg
        or "target page, context or browser has been closed" in msg
        or "browser has been closed" in msg
        or "connection closed" in msg
        or "page crashed" in msg
    )


def _scrape_place_url(
    page: Page,
    place_url: str,
    region: str,
    category: str,
    check_stop: Callable[[], None],
) -> dict:
    check_stop()
    page.goto(place_url, wait_until="domcontentloaded", timeout=30000)
    check_stop()
    _check_captcha(page)
    _handle_consent(page)
    try:
        page.wait_for_selector(NAME_SELECTOR, state="visible", timeout=12000)
    except PlaywrightTimeoutError:
        logger.warning("Timed out waiting for title on %s", place_url)
    check_stop()
    _check_captcha(page)
    return _extract_place_details(page, place_url, region, category)


def scrape(
    region: str,
    category: str,
    max_results: int = 50,
    headless: bool = True,
    on_item: Callable[[dict], None] | None = None,
    on_progress: Callable[[int, int, str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    workers: int = 1,
) -> list[dict]:
    """Scrape Google Maps businesses for a region and category using sync Playwright."""
    if max_results <= 0:
        return []

    worker_count = max(1, min(5, int(workers or 1)))
    query = f"{category.strip()} {region.strip()}".strip()
    if not query:
        return []

    search_url = f"https://www.google.com/maps/search/{quote(query, safe='')}?hl=tr"
    results: list[dict] = []
    state_lock = threading.Lock()
    stop_event = threading.Event()

    def emit_progress_locked(done: int, total_found: int, message: str) -> None:
        with state_lock:
            _emit_progress(on_progress, done, total_found, message)

    def check_phase2_stop() -> None:
        if stop_event.is_set():
            raise ScrapeCancelled("Scraping stopped.")
        if should_stop is not None and should_stop():
            stop_event.set()
            raise ScrapeCancelled("Scraping cancelled by caller.")

    _check_stop(should_stop)
    emit_progress_locked(0, 0, "Google Maps açılıyor...")

    place_urls: list[str] = []
    effective_workers = 1
    processed_count = 0
    captcha_exc: CaptchaDetected | None = None
    failed_workers = 0
    worker_exc: Exception | None = None

    url_queue: queue.Queue[str] = queue.Queue()

    def next_queued_url() -> str | None:
        try:
            return url_queue.get_nowait()
        except queue.Empty:
            return None

    def process_urls_on_page(page: Page, total: int, worker_label: str) -> None:
        nonlocal processed_count, captcha_exc
        while not stop_event.is_set():
            if should_stop is not None and should_stop():
                stop_event.set()
                break
            place_url = next_queued_url()
            if place_url is None:
                break
            try:
                item = _scrape_place_url(
                    page, place_url, region, category, check_phase2_stop
                )
            except CaptchaDetected as exc:
                with state_lock:
                    if captcha_exc is None:
                        captcha_exc = exc
                    stop_event.set()
                break
            except ScrapeCancelled:
                stop_event.set()
                break
            except Exception as exc:
                if stop_event.is_set() or (
                    should_stop is not None and should_stop()
                ):
                    stop_event.set()
                    break
                if _is_target_closed_error(page, exc):
                    logger.warning(
                        "%s browser/page closed while scraping (%s); re-queueing URL and exiting worker: %s",
                        worker_label,
                        place_url,
                        exc,
                    )
                    url_queue.put(place_url)
                    raise
                logger.exception(
                    "%s error scraping place (%s): %s",
                    worker_label,
                    place_url,
                    exc,
                )
                with state_lock:
                    if not stop_event.is_set():
                        processed_count += 1
                        cur_done = processed_count
                        _emit_progress(
                            on_progress,
                            cur_done,
                            total,
                            f"{cur_done}/{total} atlandı (hata).",
                        )
                continue

            with state_lock:
                if stop_event.is_set() or (
                    should_stop is not None and should_stop()
                ):
                    stop_event.set()
                    break
                if on_item is not None:
                    try:
                        on_item(item)
                    except Exception as exc:
                        logger.exception(
                            "%s error saving place (%s): %s",
                            worker_label,
                            place_url,
                            exc,
                        )
                        if not stop_event.is_set():
                            processed_count += 1
                            cur_done = processed_count
                            _emit_progress(
                                on_progress,
                                cur_done,
                                total,
                                f"{cur_done}/{total} atlandı (kayıt hatası).",
                            )
                        continue
                results.append(item)
                processed_count += 1
                cur_done = processed_count
                _emit_progress(
                    on_progress,
                    cur_done,
                    total,
                    f"{cur_done}/{total} işlendi: {item.get('name') or 'İsimsiz'}",
                )

    with sync_playwright() as p:
        browser = None
        context = None
        try:
            browser, context, page = _launch_browser_session(p, headless)
            logger.info("Navigating to Google Maps search: %s", search_url)
            page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            _check_captcha(page)
            _handle_consent(page)
            _check_captcha(page)

            mode = _wait_for_search_state(page, should_stop)
            logger.info("Detected search result mode: %s", mode)

            if mode == "empty":
                emit_progress_locked(0, 0, "Sonuç bulunamadı.")
                return results

            if mode == "single":
                emit_progress_locked(0, 1, "Tek işletme sayfası açıldı, detaylar çekiliyor...")
                try:
                    page.wait_for_timeout(800)
                    _check_captcha(page)
                    item = _extract_place_details(page, page.url, region, category)
                    with state_lock:
                        if on_item is not None:
                            on_item(item)
                        results.append(item)
                        _emit_progress(
                            on_progress,
                            1,
                            1,
                            f"1/1 işlendi: {item.get('name') or 'İsimsiz'}",
                        )
                except (CaptchaDetected, ScrapeCancelled):
                    raise
                except Exception as exc:
                    logger.exception("Failed extracting single place page: %s", exc)
                return results

            emit_progress_locked(0, 0, "Sonuç listesi taranıyor...")
            place_urls = _collect_place_urls(
                page,
                max_results,
                lambda d, t, m: emit_progress_locked(d, t, m),
                should_stop,
            )
            total = len(place_urls)
            if total == 0:
                emit_progress_locked(0, 0, "Hiç işletme bağlantısı bulunamadı.")
                return results

            for place_url in place_urls:
                url_queue.put(place_url)

            emit_progress_locked(
                0,
                total,
                f"Toplam {total} işletme bulundu, detaylar çekiliyor...",
            )

            effective_workers = min(worker_count, total)
            if effective_workers == 1:
                try:
                    process_urls_on_page(page, total, "Worker 1")
                except Exception as exc:
                    if captcha_exc is not None:
                        raise captcha_exc from exc
                    _check_stop(should_stop)
                    if stop_event.is_set():
                        raise ScrapeCancelled("Scraping cancelled by caller.") from exc
                    raise
                if captcha_exc is not None:
                    raise captcha_exc
                _check_stop(should_stop)
                if stop_event.is_set():
                    raise ScrapeCancelled("Scraping cancelled by caller.")
                emit_progress_locked(
                    total,
                    total,
                    f"Tamamlandı: {len(results)} işletme çekildi.",
                )
                return results
        finally:
            _close_browser_session(context, browser)

    total = len(place_urls)

    def worker_fn(worker_idx: int) -> None:
        nonlocal failed_workers, worker_exc
        try:
            with sync_playwright() as wp:
                w_browser = None
                w_context = None
                try:
                    w_browser, w_context, w_page = _launch_browser_session(wp, headless)
                    process_urls_on_page(w_page, total, f"Worker {worker_idx}")
                finally:
                    _close_browser_session(w_context, w_browser)
        except Exception as exc:
            logger.exception("Worker %d failed: %s", worker_idx, exc)
            with state_lock:
                failed_workers += 1
                if worker_exc is None:
                    worker_exc = exc

    worker_threads: list[threading.Thread] = []
    for idx in range(1, effective_workers + 1):
        thread = threading.Thread(
            target=worker_fn,
            args=(idx,),
            name=f"scrape-worker-{idx}",
            daemon=True,
        )
        worker_threads.append(thread)
        thread.start()

    for thread in worker_threads:
        thread.join()

    if captcha_exc is not None:
        raise captcha_exc
    _check_stop(should_stop)
    if stop_event.is_set():
        raise ScrapeCancelled("Scraping cancelled by caller.")
    if failed_workers >= effective_workers:
        raise worker_exc or RuntimeError("All scraper workers failed.")

    emit_progress_locked(
        total,
        total,
        f"Tamamlandı: {len(results)} işletme çekildi.",
    )
    return results
