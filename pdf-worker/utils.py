"""
Shared utility functions for the WeasyPrint PDF generator.
"""

import re


# ─────────────────────────────────────────────────────────────────────────────
# Dummy / placeholder helpers
# ─────────────────────────────────────────────────────────────────────────────

def dummy(label: str = "القيمة") -> str:
    """Return a styled 'not found' placeholder."""
    return f"[{label} غير متوفر]"


# ─────────────────────────────────────────────────────────────────────────────
# Number / money formatting
# ─────────────────────────────────────────────────────────────────────────────

def parse_num(v) -> float:
    if v is None:
        return 0.0
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return 0.0


def fmt_num(n: float, decimals: int = 2) -> str:
    if not isinstance(n, (int, float)) or n != n:
        return "—"
    return f"{n:,.{decimals}f}"


def fmt_money(v) -> str:
    """Format a monetary value as comma-separated with 2 decimal places."""
    n = parse_num(v)
    if n == 0.0:
        return "—"
    return f"{n:,.2f}"


def fmt_value(v, fallback: str = "—") -> str:
    """Return string value or fallback."""
    if v is None or str(v).strip() == "":
        return fallback
    return str(v).strip()


# ─────────────────────────────────────────────────────────────────────────────
# Label-map lookup
# ─────────────────────────────────────────────────────────────────────────────

def lookup(label_maps: dict, mapping: str, key, fallback: str = "—") -> str:
    m = label_maps.get(mapping, {})
    return m.get(str(key), fallback) if key else fallback


# ─────────────────────────────────────────────────────────────────────────────
# HTML escaping
# ─────────────────────────────────────────────────────────────────────────────

_HTML_ESCAPE = str.maketrans({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
})


def esc(text) -> str:
    if text is None:
        return ""
    return str(text).translate(_HTML_ESCAPE)
