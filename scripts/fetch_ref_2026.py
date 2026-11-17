#!/usr/bin/env python3
"""One-off: ICLR 2026 acceptance rate per primary area, as a reference column.

accept_rate         = accepted / (accepted + rejected + withdrawn): share of submissions
                      that were not desk-rejected (closest analogue of the reviewed pool).
accept_rate_decided = accepted / (accepted + rejected).
Writes docs/data/ref_iclr2026.json. Only needs re-running if you want to refresh it.
"""
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import orapi  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
VENUE = "ICLR.cc/2026/Conference"


def main():
    orapi.load_dotenv(ROOT / ".env")
    client = orapi.Client(os.environ["OPENREVIEW_USERNAME"], os.environ["OPENREVIEW_PASSWORD"])
    counts = defaultdict(Counter)
    n = 0
    for note in client.iter_notes(
        invitation=f"{VENUE}/-/Submission", sort="number:asc", select="id,content.primary_area,content.venueid"
    ):
        c = note.get("content", {})
        area = (c.get("primary_area") or {}).get("value")
        vid = (c.get("venueid") or {}).get("value") or ""
        if vid == VENUE:
            kind = "accepted"
        elif vid.endswith("Rejected_Submission") and "Desk" not in vid:
            kind = "rejected"
        elif vid.endswith("Withdrawn_Submission"):
            kind = "withdrawn"
        elif vid.endswith("Desk_Rejected_Submission"):
            kind = "desk_rejected"
        else:
            kind = "other:" + vid
        counts[area][kind] += 1
        counts["__all__"][kind] += 1
        n += 1
    print(f"{n:,} ICLR 2026 submissions")

    def rate(c):
        decided = c["accepted"] + c["rejected"]
        reviewed = decided + c["withdrawn"]
        return {
            "accept_rate": round(c["accepted"] / reviewed, 4) if reviewed else None,
            "accept_rate_decided": round(c["accepted"] / decided, 4) if decided else None,
            **c,
        }

    out = {
        "venue": "ICLR 2026",
        "definition": "accept_rate = accepted / (accepted + rejected + withdrawn), desk rejects excluded; accept_rate_decided = accepted / (accepted + rejected)",
        "overall": rate(counts.pop("__all__")),
        "areas": {a: rate(c) for a, c in counts.items()},
    }
    path = ROOT / "docs" / "data" / "ref_iclr2026.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1))
    print(json.dumps(out["overall"]))
    for a, v in sorted(out["areas"].items(), key=lambda kv: str(kv[0])):
        print(f"  {v['accept_rate']}  {a}")


if __name__ == "__main__":
    main()
