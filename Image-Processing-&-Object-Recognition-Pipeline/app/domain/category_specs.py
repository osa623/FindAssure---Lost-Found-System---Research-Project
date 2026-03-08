from typing import List, Optional
from functools import lru_cache

ALLOWED_LABELS: List[str] = [
    "Wallet",
    "Handbag",
    "Backpack",
    "Laptop",
    "Smart Phone",
    "Helmet",
    "Key",
    "Power Bank",
    "Laptop/Mobile chargers & cables",
    "Earbuds - Earbuds case",
    "Headphone",
    "Student ID",
    "NIC / National ID Card"
]

def is_allowed_label(label: str) -> bool:
    """Check if a label is in the allowed list."""
    return label in ALLOWED_LABELS

def require_allowed_label(label: str) -> None:
    """Raise ValueError if label is not allowed."""
    if not is_allowed_label(label):
        raise ValueError(f"Label '{label}' is not allowed. Allowed labels are: {', '.join(ALLOWED_LABELS)}")

@lru_cache(maxsize=256)
def canonicalize_label(label: str) -> Optional[str]:
    """
    Best-effort mapping of a raw label to one of the ALLOWED_LABELS.
    Returns None if no match found.
    """
    if not label:
        return None
    
    l = label.strip().lower()
    
    # Direct matches (case-insensitive)
    for allowed in ALLOWED_LABELS:
        if allowed.lower() == l:
            return allowed
            
    # Common aliases / partial matches
    if "phone" in l or "mobile" in l or "cell" in l:
        if "charger" in l or "cable" in l:
            return "Laptop/Mobile chargers & cables"
        return "Smart Phone"
        
    if "laptop" in l or "computer" in l or "notebook" in l:
        if "charger" in l or "cable" in l:
            return "Laptop/Mobile chargers & cables"
        return "Laptop"
        
    if "bag" in l or "purse" in l or "tote" in l:
        return "Handbag"
        
    if "backpack" in l or "rucksack" in l:
        return "Backpack"
        
    if "wallet" in l or "billfold" in l:
        return "Wallet"
        
    if "helmet" in l:
        return "Helmet"
        
    if "key" in l:
        return "Key"
        
    if "earbud" in l or "airpod" in l:
        return "Earbuds - Earbuds case"
        
    if "headphone" in l or "headset" in l:
        return "Headphone"

    if "nic" == l or "national id" in l or "national identity" in l or "identity card" in l or "government id" in l:
        return "NIC / National ID Card"

    if "student id" in l or "school id" in l or "campus card" in l or "university id" in l or "university card" in l or "student card" in l:
        return "Student ID"
        
    if "id" in l or "card" in l:
        return "Student ID"
        
    if "power" in l and "bank" in l:
        return "Power Bank"
        
    if "charger" in l or "cable" in l or "wire" in l:
        return "Laptop/Mobile chargers & cables"

    return None

# Category Specifications for Grounding & Validation
# Used by Florence-2 (Grounding) and Gemini (Reasoning)
CATEGORY_SPECS = {
    "Wallet": {
        "features": ["logo", "brand name", "pattern", "texture", "card slots", "coin pouch", "zipper", "button clasp"],
        "defects": [
            "torn stitch", "frayed edge", "scratch", "scuff marks", "stain", "peeling leather",
            "broken zipper", "zipper jammed", "missing button", "broken clasp", "cracked surface",
            "faded logo", "worn corners", "discoloration"
        ],
        "attachments": ["strap attached", "chain attached", "keyring attached"]
    },
    "Handbag": {
        "features": ["logo", "brand name", "pattern", "texture", "buckle", "zipper", "button clasp", "handle", "strap"],
        "defects": [
            "strap tear", "strap frayed", "broken strap", "handle tear", "broken zipper", "zipper jammed",
            "stain", "scratch", "scuff marks", "peeling", "cracked leather", "torn lining",
            "missing button", "broken clasp", "faded logo", "worn corners"
        ],
        "attachments": ["chain strap attached", "logo tag attached", "charm attached"]
    },
    "Backpack": {
        "features": ["logo", "brand name", "pattern", "reflective strip", "shoulder straps", "top handle", "zippers", "side pockets", "front pocket"],
        "defects": [
            "strap tear", "strap frayed", "broken buckle", "broken zipper", "zipper jammed",
            "torn fabric", "hole", "seam tear", "stain", "scuff marks", "faded logo",
            "broken clip", "damaged pocket", "worn bottom"
        ],
        "attachments": ["luggage tag attached", "keychain charm attached"]
    },
    "Laptop": {
        "features": ["logo", "brand name", "keyboard", "trackpad", "webcam", "ports"],
        "defects": [
            "cracked screen", "screen scratches", "dead pixels", "hinge damage",
            "dent", "scratch", "broken key", "missing keycap", "touchpad damage",
            "broken port", "charging port loose", "burn marks", "swollen battery"
        ],
        "attachments": ["charger attached", "charging cable attached", "laptop sleeve attached", "stickers attached"]
    },
    "Smart Phone": {
        "features": ["logo", "brand name", "camera module", "home button"],
        "defects": [
            "cracked screen", "screen scratches", "back glass crack", "camera lens crack",
            "dent", "scratch", "button missing", "button stuck", "charging port damage",
            "speaker damage"
        ],
        "attachments": ["phone case attached", "screen protector attached", "charging cable attached"]
    },
    "Helmet": {
        "features": ["logo", "brand name", "ventilation", "graphics"],
        "defects": [
            "crack", "deep scratch", "broken visor", "visor scratch", "strap tear",
            "strap broken", "missing padding", "paint chips", "dent"
        ],
        "attachments": ["visor", "chin strap", "padding"]
    },
    "Key": {
        "features": ["logo", "brand name", "text", "teeth pattern", "key head hole", "slot in head"],
        "defects": [
            "bent key", "rust", "broken key head", "worn teeth", "scratches",
            "damaged keyring"
        ],
        "attachments": ["metal key ring attached", "lanyard attached", "tag attached", "remote key fob attached"]
    },
    "Power Bank": {
        "features": ["logo", "brand name", "indicator lights", "ports"],
        "defects": [
            "scratches", "dent", "swollen body", "broken USB port",
            "damaged cable", "cracked casing"
        ],
        "attachments": ["charging cable"]
    },
    "Laptop/Mobile chargers & cables": {
        "features": ["logo", "brand name", "plug type"],
        "defects": [
            "frayed cable", "exposed wire", "bent connector", "broken connector",
            "burn marks", "damaged adapter casing", "loose plug"
        ],
        "attachments": ["adapter brick", "USB cable", "Type-C cable", "Lightning cable", "micro-USB cable"]
    },
    "Earbuds - Earbuds case": {
        "features": ["logo", "brand name", "indicator light"],
        "defects": [
            "scratches", "scuff marks", "cracked case", "missing earbud", "ear tip missing",
            "dirty ear tips", "damaged hinge"
        ],
        "attachments": ["charging case", "ear tips"]
    },
    "Headphone": {
        "features": ["logo", "brand name", "ear cups"],
        "defects": [
            "broken headband", "torn ear cushion", "missing ear cushion", "cracked plastic",
            "frayed cable", "broken jack", "scratch", "dent"
        ],
        "attachments": ["audio cable", "headband", "mic boom"]
    },
    "Student ID": {
        "features": ["photo", "name", "id number", "barcode", "logo", "institution name", "student number"],
        "defects": [
            "cracked card", "bent card", "scratched surface", "faded text",
            "torn corner", "damaged holder", "broken clip"
        ],
        "attachments": ["lanyard", "card holder", "clip"]
    },
    "NIC / National ID Card": {
        "features": ["photo", "name", "id number", "date of birth", "barcode",
                     "national flag", "issuing authority", "signature", "place of birth"],
        "defects": [
            "cracked card", "bent card", "scratched surface", "faded text",
            "torn corner", "damaged holder"
        ],
        "attachments": ["lanyard", "card holder", "clip"]
    }
}
