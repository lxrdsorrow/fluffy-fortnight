"""Same text cleanup as app/js/normalize.js (reads the same shortcut list)."""
import json
import os
import re

_here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_here, "..", "app", "js", "abbrev.js"), encoding="utf-8") as f:
    _src = f.read()
ABBREV = json.loads(_src[_src.index("ABBREV = ") + 9:_src.rindex(";")])


def normalize(text):
    t = str(text or "").lower().replace("&", " and ")
    t = re.sub(r"['’]", "", t)
    t = re.sub(r"[^a-z0-9]+", " ", t)
    out = []
    for w in t.split(" "):
        if not w:
            continue
        out.extend(ABBREV.get(w, w).split(" "))
    return " ".join(out)
