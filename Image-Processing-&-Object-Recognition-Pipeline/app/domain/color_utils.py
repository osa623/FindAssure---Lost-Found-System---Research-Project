"""
Shared color vocabulary, normalization, bucketing, and caption extraction.

Used across PP1, PP2, Florence service, fusion, and verifier to ensure
consistent color handling throughout the pipeline.
"""

import re
from typing import Optional

# ── Canonical base colors ──────────────────────────────────────────
CANONICAL_COLORS = frozenset({
    "black", "white", "red", "blue", "green", "yellow", "orange",
    "purple", "pink", "brown", "gray", "silver", "gold", "beige",
    "teal", "multicolor",
})

# ── Alias map: variant → canonical ─────────────────────────────────
COLOR_ALIAS_MAP = {
    # Black family
    "matte black": "black",
    "jet black": "black",
    "glossy black": "black",
    "dark black": "black",
    # White family
    "off white": "white",
    "off-white": "white",
    "cream": "beige",
    "ivory": "beige",
    "eggshell": "beige",
    # Gray family
    "charcoal": "gray",
    "dark gray": "gray",
    "light gray": "gray",
    "slate": "gray",
    "gunmetal": "gray",
    "metallic gray": "gray",
    "ash": "gray",
    # Blue family
    "navy": "blue",
    "navy blue": "blue",
    "dark blue": "blue",
    "light blue": "blue",
    "sky blue": "blue",
    "royal blue": "blue",
    "cobalt": "blue",
    "cobalt blue": "blue",
    "midnight blue": "blue",
    "steel blue": "blue",
    # Red family
    "maroon": "red",
    "burgundy": "red",
    "wine": "red",
    "dark red": "red",
    "crimson": "red",
    "scarlet": "red",
    "cherry": "red",
    "ruby": "red",
    # Green family
    "olive": "green",
    "army green": "green",
    "dark green": "green",
    "forest green": "green",
    "lime": "green",
    "lime green": "green",
    "mint": "green",
    "mint green": "green",
    "sage": "green",
    "sage green": "green",
    "emerald": "green",
    "khaki green": "green",
    # Brown family
    "tan": "brown",
    "khaki": "brown",
    "camel": "brown",
    "chocolate": "brown",
    "dark brown": "brown",
    "light brown": "brown",
    "espresso": "brown",
    "mocha": "brown",
    "rust": "brown",
    "copper": "brown",
    "bronze": "brown",
    "chestnut": "brown",
    # Purple family
    "lavender": "purple",
    "violet": "purple",
    "lilac": "purple",
    "plum": "purple",
    "mauve": "purple",
    "indigo": "purple",
    # Pink family
    "rose": "pink",
    "coral": "pink",
    "salmon": "pink",
    "hot pink": "pink",
    "magenta": "pink",
    "fuchsia": "pink",
    "blush": "pink",
    # Yellow / Orange family
    "mustard": "yellow",
    "amber": "orange",
    "peach": "orange",
    "tangerine": "orange",
    "burnt orange": "orange",
    # Metal family
    "chrome": "silver",
    "platinum": "silver",
    "metallic silver": "silver",
    "golden": "gold",
    "brass": "gold",
    # Teal family
    "cyan": "teal",
    "turquoise": "teal",
    "aqua": "teal",
    "aquamarine": "teal",
}

# Qualifier prefixes to strip before alias lookup
_QUALIFIER_RE = re.compile(
    r"^(?:matte|glossy|metallic|satin|shiny|bright|pale|deep|vivid|neon)\s+",
    re.IGNORECASE,
)

# Build regex for caption color extraction — longest-first to match "navy blue" before "navy"
_ALL_COLOR_WORDS = sorted(
    set(CANONICAL_COLORS) | set(COLOR_ALIAS_MAP.keys()),
    key=lambda w: -len(w),
)
_COLOR_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(c) for c in _ALL_COLOR_WORDS) + r")\b",
    re.IGNORECASE,
)


def normalize_color(raw: str) -> str:
    """
    Normalize a raw color string to a canonical color name.

    Steps: lowercase → strip → grey→gray → collapse spaces → strip qualifier
    prefixes → alias lookup → return canonical or cleaned string.
    """
    if not isinstance(raw, str):
        return ""
    s = raw.lower().strip()
    s = s.replace("-", " ").replace("_", " ")
    s = s.replace("grey", "gray")
    s = re.sub(r"\s+", " ", s).strip()

    if s in {"", "unknown", "n/a", "none", "null"}:
        return ""

    # Direct alias hit (before stripping qualifiers)
    if s in COLOR_ALIAS_MAP:
        return COLOR_ALIAS_MAP[s]
    if s in CANONICAL_COLORS:
        return s

    # Strip qualifier prefix and retry
    stripped = _QUALIFIER_RE.sub("", s).strip()
    if stripped in COLOR_ALIAS_MAP:
        return COLOR_ALIAS_MAP[stripped]
    if stripped in CANONICAL_COLORS:
        return stripped

    # Return cleaned string as-is (don't discard unrecognized colors)
    return stripped or s


def bucket_color(raw: str) -> str:
    """
    Map a raw color string to its canonical bucket.

    Returns the canonical color name, or the normalized string if no
    canonical match is found.
    """
    return normalize_color(raw)


def extract_color_from_text(text: str) -> Optional[str]:
    """
    Scan a text (e.g. Florence caption) for color words and return the
    first canonical color found, or None.

    Matches longest color phrases first (e.g. "navy blue" before "navy").
    """
    if not isinstance(text, str) or not text.strip():
        return None
    m = _COLOR_PATTERN.search(text.lower())
    if m:
        return normalize_color(m.group(1))
    return None
