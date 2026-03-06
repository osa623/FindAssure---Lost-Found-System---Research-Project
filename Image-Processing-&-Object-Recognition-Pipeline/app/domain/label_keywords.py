"""
Single source of truth for category keyword vocabularies.

Every consumer (PP1 reranking, PP2 hint inference, detection arbiter,
Florence strong-label derivation) imports from here so the dictionaries
can never drift out of sync.
"""

from typing import Dict, List

# ── Unified keyword vocabulary (superset of all previous per-module dicts) ──

CATEGORY_KEYWORDS: Dict[str, List[str]] = {
    "Helmet": [
        "helmet", "visor", "shield", "chin", "chin strap", "headgear",
        "half-face", "full-face", "motorcycle helmet", "bike helmet",
        "hard hat", "safety helmet", "crash helmet", "open face", "open-face",
    ],
    "Smart Phone": [
        "phone", "smartphone", "screen", "camera", "bezel", "home button",
        "iphone", "samsung", "android", "mobile", "touchscreen", "cellular",
        "mobile phone", "cell phone", "android phone",
    ],
    "Laptop": [
        "laptop", "notebook", "macbook", "ultrabook", "keyboard", "trackpad",
        "thinkpad", "chromebook", "display",
    ],
    "Earbuds - Earbuds case": [
        "earbud", "earbuds", "airpods", "earphone", "earphone case",
        "charging case", "tws", "tws case", "galaxy buds", "ear tip",
        "anc", "pro", "noise cancelling", "wireless earbuds", "bluetooth earbuds",
    ],
    "Wallet": [
        "wallet", "billfold", "card holder", "card slots", "money clip",
        "leather wallet", "bifold", "trifold", "coin purse", "leather fold",
        "card case", "leather", "rfid", "slim wallet",
    ],
    "Handbag": [
        "bag", "handbag", "purse", "tote", "sling bag", "clutch",
        "shoulder bag", "crossbody",
    ],
    "Backpack": [
        "backpack", "rucksack", "knapsack", "school bag", "daypack",
        "hiking pack",
    ],
    "Key": [
        "key", "keys", "keychain", "key ring", "car key", "fob", "key fob",
        "house key", "door key", "yale", "schlage", "deadbolt", "padlock",
        "metal key",
    ],
    "Student ID": [
        "student id", "id card", "school id", "campus card", "identity card",
        "student card", "university id", "university card", "nic", "national id",
        "badge", "identification", "date of issue", "place of birth",
    ],
    "Power Bank": [
        "power bank", "portable charger", "battery pack", "external battery",
        "charging brick", "portable battery", "powerbank", "charging bank",
        "mah", "10000mah", "20000mah", "anker", "baseus",
    ],
    "Headphone": [
        "headphone", "headphones", "headset", "over-ear", "on-ear", "beats",
        "sony headphone", "bose", "wireless headphone", "ear cup", "audio",
    ],
    "Laptop/Mobile chargers & cables": [
        "charger", "cable", "usb", "adapter", "lightning", "type-c", "usb-c",
        "charging cable", "power adapter", "brick", "usb cable", "type-c cable",
        "lightning cable", "watt", "65w", "fast charge", "pd", "gan",
        "micro usb",
    ],
}

# ── Negative keywords (confusion-pair guards) ──────────────────────────────
# If a *caption* matches a negative keyword for a given label the label
# receives a score penalty, reducing false positives from ambiguous text.

NEGATIVE_KEYWORDS: Dict[str, List[str]] = {
    "Helmet": ["headphone", "headset", "earbud",
              "baseball hat", "sun hat", "bucket hat", "cowboy hat",
              "straw hat", "trucker hat", "baseball cap", "snapback", "beanie",
              "phone", "smartphone", "mobile", "touchscreen"],
    "Smart Phone": ["laptop", "tablet", "power bank", "charger", "remote",
                    "helmet", "visor", "chin strap", "headgear",
                    "battery pack", "portable charger"],
    "Laptop": ["phone", "tablet", "keyboard only", "monitor"],
    "Earbuds - Earbuds case": ["headphone", "headset", "over-ear", "speaker",
                                "on-ear", "ear cup", "wireless headphone"],
    "Wallet": ["phone", "phone case", "handbag", "purse", "book", "passport"],
    "Handbag": ["backpack", "rucksack", "wallet", "suitcase", "luggage"],
    "Backpack": ["handbag", "purse", "tote", "sling bag", "suitcase"],
    "Key": ["keyboard", "keystone", "keynote", "key chain light"],
    "Student ID": ["credit card", "debit card", "bank card", "sim card"],
    "Power Bank": ["phone", "laptop", "charger", "speaker", "hard drive",
                    "smartphone", "mobile phone", "tablet"],
    "Headphone": ["earbud", "earbuds", "airpods", "tws", "helmet",
                  "charging case", "ear tip"],
    "Laptop/Mobile chargers & cables": [
        "headphone cable", "audio cable", "aux cable", "earphone",
    ],
}

# ── Shared source weights (used by PP1 reranking; PP2 has its own) ──────────
KEYWORD_SOURCE_WEIGHTS: Dict[str, int] = {
    "caption": 2,
    "ocr": 3,
    "grounding": 1,
}

# Penalty multiplier applied per negative-keyword caption hit
NEGATIVE_KEYWORD_WEIGHT: int = 2
