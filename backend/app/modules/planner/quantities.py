"""Reading recipe quantities so the week's list can show one total per ingredient (M8), and compare
weights with the freezer's grams (M11).

Recipe quantities are written by the recipe-card skill: "320 g", "128 g*" (* = estimated), "2", "½ tsp",
"50 ml*", "1 bunch", or blank. Amounts in the same kind of unit are added up (and g/kg, ml/l converted);
anything else is listed alongside with "+". Nothing is scaled by servings.
"""
import re
from collections import defaultdict
from dataclasses import dataclass

FRACTIONS = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875}

# unit word -> (canonical unit, factor to it)
UNITS = {
    "g": ("g", 1), "gr": ("g", 1), "gram": ("g", 1), "grams": ("g", 1),
    "kg": ("g", 1000), "kilo": ("g", 1000), "kilos": ("g", 1000), "kilogram": ("g", 1000), "kilograms": ("g", 1000),
    "ml": ("ml", 1), "millilitre": ("ml", 1), "millilitres": ("ml", 1), "milliliter": ("ml", 1), "milliliters": ("ml", 1),
    "l": ("ml", 1000), "litre": ("ml", 1000), "litres": ("ml", 1000), "liter": ("ml", 1000), "liters": ("ml", 1000),
    "tsp": ("tsp", 1), "teaspoon": ("tsp", 1), "teaspoons": ("tsp", 1),
    "tbsp": ("tbsp", 1), "tbs": ("tbsp", 1), "tablespoon": ("tbsp", 1), "tablespoons": ("tbsp", 1),
}
ABBREVIATED = {"g", "ml", "tsp", "tbsp"}  # never pluralised

_NUMBER = r"(?:\d+(?:[.,]\d+)?)"
_FRAC = f"[{''.join(FRACTIONS)}]"
# Most specific first: "1 1/2", then "1/2", then "1½" / "1.5", then "½". The unit is the rest of the text.
_QTY_RE = re.compile(
    rf"^(?P<num>\d+\s+\d+\s*/\s*\d+|{_NUMBER}\s*/\s*\d+|{_NUMBER}(?:\s*{_FRAC})?|{_FRAC})\s*(?P<unit>[a-zA-Z]+)?$"
)


def _number(text: str) -> float | None:
    text = text.replace(",", ".").strip()
    if m := re.fullmatch(r"(\d+)\s+(\d+)\s*/\s*(\d+)", text):  # 1 1/2
        return int(m[1]) + int(m[2]) / int(m[3])
    if m := re.fullmatch(r"(\d+(?:\.\d+)?)\s*/\s*(\d+)", text):  # 1/2
        return float(m[1]) / int(m[2])
    total = 0.0
    if text and text[-1] in FRACTIONS:  # ½ or 1½ or 1 ½
        total += FRACTIONS[text[-1]]
        text = text[:-1].strip()
    if text:
        try:
            total += float(text)
        except ValueError:
            return None
    return total


def _singular(word: str) -> str:
    if word.endswith(("ches", "shes", "sses", "xes")):
        return word[:-2]
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        return word[:-1]
    return word


def _plural(word: str) -> str:
    if word.endswith(("ch", "sh", "s", "x")):
        return word + "es"
    if word.endswith("y") and len(word) > 1 and word[-2] not in "aeiou":
        return word[:-1] + "ies"
    return word + "s"


@dataclass
class Qty:
    value: float | None  # None: couldn't read a number (kept as text)
    unit: str  # canonical: g, ml, tsp, tbsp, "" (a count), or a word like "bunch"
    estimated: bool
    text: str  # as written, without the * marker


def parse(qty: str) -> Qty | None:
    """None for a blank amount."""
    raw = (qty or "").strip()
    estimated = "*" in raw
    text = raw.replace("*", "").strip()
    if not text:
        return None
    m = _QTY_RE.match(text)
    value = _number(m["num"]) if m else None
    if m is None or value is None:
        return Qty(None, "", estimated, text)
    unit_word = (m["unit"] or "").lower()
    if unit_word in UNITS:
        unit, factor = UNITS[unit_word]
        return Qty(value * factor, unit, estimated, text)
    return Qty(value, _singular(unit_word), estimated, text)


def grams(qty: str) -> float | None:
    """Grams in a quantity like "320 g", "1.5kg", "128 g*"; None if it isn't a weight."""
    p = parse(qty)
    return p.value if p and p.value is not None and p.unit == "g" else None


def format_number(x: float) -> str:
    """3 -> "3", 1.5 -> "1½", 0.25 -> "¼", 2.4 -> "2.4"."""
    whole, frac = int(x), x - int(x)
    if abs(frac) < 1e-9:
        return str(whole)
    for symbol, value in FRACTIONS.items():
        if abs(frac - value) < 0.01:
            return f"{whole or ''}{symbol}"
    return f"{x:.2f}".rstrip("0").rstrip(".")


def _format(value: float, unit: str) -> str:
    if unit == "g":
        g = round(value)
        return f"{g} g" if g < 1000 else f"{g / 1000:.3f}".rstrip("0").rstrip(".") + " kg"
    if unit == "ml":
        ml = round(value)
        return f"{ml} ml" if ml < 1000 else f"{ml / 1000:.3f}".rstrip("0").rstrip(".") + " l"
    if not unit:
        return format_number(value)
    if unit in ABBREVIATED or abs(value - 1) < 1e-9 or value < 1:
        return f"{format_number(value)} {unit}"
    return f"{format_number(value)} {_plural(unit)}"


_ORDER = {"g": 0, "ml": 1, "tbsp": 2, "tsp": 3, "": 4}


def total(qtys: list[str]) -> str:
    """One total for an ingredient across the week, e.g. ["100 g", "200 g", "400 g"] -> "700 g",
    ["300 g", "2"] -> "300 g + 2", ["128 g*", "14 g"] -> "≈ 142 g". Blank amounts add nothing."""
    sums: dict[str, float] = defaultdict(float)
    texts: list[str] = []
    estimated = False
    for q in qtys:
        p = parse(q)
        if p is None:
            continue
        estimated |= p.estimated
        if p.value is None:
            if p.text not in texts:
                texts.append(p.text)
        else:
            sums[p.unit] += p.value
    parts = [_format(v, u) for u, v in sorted(sums.items(), key=lambda kv: (_ORDER.get(kv[0], 5), kv[0]))]
    out = " + ".join(parts + texts)
    return f"≈ {out}" if out and estimated else out
