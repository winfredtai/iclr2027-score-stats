#!/usr/bin/env python3
"""Fetch every ICLR 2027 submission + official review score from OpenReview.

Uses one paged query over the venue's meta-invitation (`/-/Edit`), which returns
submissions and official reviews together. `select` keeps only the fields we need
(no review text), so the whole venue is ~70 MB instead of ~1 GB.

Credentials come from env vars OPENREVIEW_USERNAME / OPENREVIEW_PASSWORD
(a local `.env` file in the repo root is loaded automatically).

Output: data/raw/latest.json (plus a timestamped copy).
"""
import argparse
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import orapi  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
VENUE = "ICLR.cc/2027/Conference"
SCORE_FIELDS = ["rating", "confidence", "soundness", "presentation", "informativeness"]
SELECT = ",".join(
    ["id", "forum", "number", "invitations", "tcdate", "tmdate"]
    + [f"content.{f}" for f in SCORE_FIELDS]
    + ["content.title", "content.primary_area", "content.venueid"]
)


def as_int(v):
    """Score values are ints; tolerate legacy '3: label' strings just in case."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip()
    head = s.split(":", 1)[0].strip()
    try:
        return int(float(head))
    except ValueError:
        return None


def cval(note, key):
    v = note.get("content", {}).get(key)
    return v.get("value") if isinstance(v, dict) else v


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--venue", default=VENUE)
    ap.add_argument("--page-size", type=int, default=1000)
    ap.add_argument("--pause", type=float, default=0.5, help="seconds between pages")
    ap.add_argument("--out", default=str(ROOT / "data" / "raw"))
    args = ap.parse_args()

    orapi.load_dotenv(ROOT / ".env")
    user, pw = os.environ.get("OPENREVIEW_USERNAME"), os.environ.get("OPENREVIEW_PASSWORD")
    if not (user and pw):
        sys.exit("Set OPENREVIEW_USERNAME and OPENREVIEW_PASSWORD (env vars or .env file).")

    client = orapi.Client(user, pw)
    print("Logged in to OpenReview.", flush=True)

    started = datetime.now(timezone.utc)
    sub_inv = f"{args.venue}/-/Submission"
    review_suffix = "/-/Official_Review"

    papers = {}  # forum id -> paper record
    reviews = {}  # review id -> (forum, scores)
    other = Counter()
    seen = set()
    total = None
    offset = 0
    t0 = time.time()
    while True:
        res = client.get(
            "/notes",
            invitation=f"{args.venue}/-/Edit",
            sort="tcdate:asc",
            limit=args.page_size,
            offset=offset,
            select=SELECT,
        )
        notes = res.get("notes", [])
        if total is None:
            total = res.get("count")
        for n in notes:
            if n["id"] in seen:
                continue
            seen.add(n["id"])
            invs = n.get("invitations", [])
            if sub_inv in invs:
                papers[n["id"]] = {
                    "id": n["id"],
                    "number": n.get("number"),
                    "title": cval(n, "title"),
                    "area": cval(n, "primary_area"),
                    "venueid": cval(n, "venueid"),
                }
            elif any(i.endswith(review_suffix) for i in invs):
                scores = {f: as_int(cval(n, f)) for f in SCORE_FIELDS}
                reviews[n["id"]] = {"forum": n.get("forum"), "modified": n.get("tmdate") != n.get("tcdate"), **scores}
            else:
                other[next((i.split("/-/")[-1] for i in invs if not i.endswith("/-/Edit")), "?")] += 1
        offset += len(notes)
        elapsed = time.time() - t0
        print(f"  {offset:>7,} / {total or '?':>} notes  ({len(papers):,} submissions, {len(reviews):,} reviews)  {elapsed:5.0f}s", flush=True)
        if not notes or (total is not None and offset >= total):
            break
        time.sleep(args.pause)

    # Attach reviews to submissions.
    orphan = 0
    for p in papers.values():
        p["reviews"] = []
    for rid, r in reviews.items():
        p = papers.get(r["forum"])
        if p is None:
            orphan += 1
            continue
        p["reviews"].append({k: r[k] for k in ["rating", "confidence", "soundness", "presentation", "informativeness", "modified"]})

    status = Counter((p["venueid"] or "").rsplit("/", 1)[-1] for p in papers.values())
    print(f"Done in {time.time() - t0:.0f}s: {len(papers):,} submissions, {len(reviews):,} reviews, "
          f"{orphan} orphan reviews, other note types: {dict(other)}")
    print(f"Submission status: {dict(status)}")
    if total is not None and len(seen) < total * 0.98:
        sys.exit(f"Only got {len(seen):,} of {total:,} notes; aborting so a partial snapshot is not published.")

    out = {
        "venue": args.venue,
        "fetched_at": started.isoformat(timespec="seconds"),
        "n_notes": len(seen),
        "papers": sorted(papers.values(), key=lambda p: p["number"] or 0),
    }
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    stamp = started.strftime("%Y%m%dT%H%MZ")
    for path in (outdir / f"snapshot-{stamp}.json", outdir / "latest.json"):
        path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {outdir / 'latest.json'}")


if __name__ == "__main__":
    main()
