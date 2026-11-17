#!/usr/bin/env python3
"""Aggregate data/raw/latest.json into the small JSON files the website reads.

Writes docs/data/stats.json (current snapshot) and appends a summary row to
docs/data/history.json so score drift during the rebuttal can be tracked.
"""
import argparse
import json
import statistics
from collections import Counter
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DOCS_DATA = ROOT / "docs" / "data"

# Short display names for OpenReview primary areas (the full name is shown too).
AREA_SHORT = {
    "foundation or frontier models, including LLMs": "Foundation Models / LLMs",
    "applications to computer vision, audio, language, and other modalities": "Applications: CV / Audio / Language",
    "alignment, fairness, safety, privacy, and societal considerations": "Alignment / Fairness / Safety / Privacy",
    "datasets and benchmarks": "Datasets & Benchmarks",
    "generative models": "Generative Models",
    "reinforcement learning": "Reinforcement Learning",
    "applications to robotics, autonomy, planning": "Applications: Robotics / Planning",
    "unsupervised, self-supervised, semi-supervised, and supervised representation learning": "Representation Learning",
    "applications to physical sciences (physics, chemistry, biology, etc.)": "Applications: Physical Sciences",
    "interpretability and explainable AI": "Interpretability / XAI",
    "optimization": "Optimization",
    "learning theory": "Learning Theory",
    "transfer learning, meta learning, and lifelong learning": "Transfer / Meta / Lifelong Learning",
    "other topics in machine learning (i.e., none of the above)": "Other Topics in ML",
    "learning on time series and dynamical systems": "Time Series & Dynamical Systems",
    "learning on graphs and other geometries & topologies": "Graphs & Geometry",
    "probabilistic methods (Bayesian methods, variational inference, sampling, UQ, etc.)": "Probabilistic Methods",
    "applications to neuroscience & cognitive science": "Applications: Neuro & CogSci",
    "infrastructure, software libraries, hardware, systems, etc.": "Infrastructure / Systems",
    "neurosymbolic & hybrid AI systems (physics-informed, logic & formal reasoning, etc.)": "Neurosymbolic & Hybrid AI",
    "causal reasoning": "Causal Reasoning",
}

# Score intervals for histograms / tables: [lo, hi), last bin closed at 4.
BIN_EDGES = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0]
# "Share of papers with average >= t". 2.33 / 2.67 are the 3-review averages 7/3 and 8/3.
THRESHOLDS = [2.0, 2.33, 2.5, 2.67, 3.0]
SUB_SCORES = ["confidence", "soundness", "presentation", "informativeness"]


def r2(x):
    """Round an average to 2 decimals so 7/3 compares equal to the 2.33 threshold."""
    return round(x + 1e-9, 2)


def bin_index(avg):
    a = r2(avg)
    for i in range(len(BIN_EDGES) - 1):
        if a < BIN_EDGES[i + 1]:
            return i
    return len(BIN_EDGES) - 2


def summarize(papers, name, full, key, ref_rate=None):
    reviewed = [p for p in papers if p["ratings"]]
    avgs = sorted(r2(p["avg"]) for p in reviewed)
    n = len(avgs)
    ratings = Counter(r for p in reviewed for r in p["ratings"])
    hist = [0] * (len(BIN_EDGES) - 1)
    for a in avgs:
        hist[bin_index(a)] += 1
    dist = sorted(Counter(avgs).items())
    sub = {}
    for f in SUB_SCORES:
        vals = [v for p in reviewed for v in p[f] if v is not None]
        sub[f] = round(statistics.fmean(vals), 3) if vals else None
    qs = statistics.quantiles(avgs, n=4, method="inclusive") if n >= 2 else [None, None, None]
    return {
        "key": key,
        "name": name,
        "full": full,
        "n_papers": len(papers),
        "n_reviewed": n,
        "n_reviews": sum(len(p["ratings"]) for p in reviewed),
        "mean": round(statistics.fmean(avgs), 4) if n else None,
        "median": statistics.median(avgs) if n else None,
        "q1": round(qs[0], 4) if qs[0] is not None else None,
        "q3": round(qs[2], 4) if qs[2] is not None else None,
        "rating_counts": [ratings.get(s, 0) for s in (1, 2, 3, 4)],
        "hist": hist,
        "dist": [[v, c] for v, c in dist],
        "share_ge": {f"{t:.2f}": (sum(1 for a in avgs if a >= t) / n if n else None) for t in THRESHOLDS},
        "sub_means": sub,
        "reviews_per_paper": dict(sorted(Counter(len(p["ratings"]) for p in reviewed).items())),
        "ref_2026_accept_rate": ref_rate,
    }


def load_ref():
    path = DOCS_DATA / "ref_iclr2026.json"
    if not path.exists():
        return {}, None
    ref = json.loads(path.read_text())
    return {a: v["accept_rate"] for a, v in ref["areas"].items()}, ref.get("overall", {}).get("accept_rate")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw", default=str(ROOT / "data" / "raw" / "latest.json"))
    ap.add_argument("--out", default=str(DOCS_DATA), help="output dir for stats.json / history.json")
    args = ap.parse_args()
    out_dir = Path(args.out)

    raw = json.loads(Path(args.raw).read_text())
    venue = raw["venue"]
    fetched = datetime.fromisoformat(raw["fetched_at"])
    et = fetched.astimezone(ZoneInfo("America/New_York"))
    as_of_et = et.strftime("%b %-d, %Y, %H:%M ET")

    status = Counter()
    active = []
    for p in raw["papers"]:
        st = (p.get("venueid") or "").rsplit("/", 1)[-1]
        status[st] += 1
        if p.get("venueid") != f"{venue}/Submission":
            continue
        revs = [r for r in p["reviews"] if r.get("rating") is not None]
        ratings = [r["rating"] for r in revs]
        rec = {
            "area": p.get("area") or "(none)",
            "ratings": ratings,
            "avg": sum(ratings) / len(ratings) if ratings else None,
        }
        for f in SUB_SCORES:
            rec[f] = [r.get(f) for r in revs]
        active.append(rec)

    withdrawn_reviewed = sum(
        1 for p in raw["papers"] if (p.get("venueid") or "").endswith("Withdrawn_Submission") and p["reviews"]
    )

    # Observed ranges of every score field, so the site can label scales from data.
    ranges = {}
    for f in ["rating"] + SUB_SCORES:
        vals = [r.get(f) for p in raw["papers"] for r in p["reviews"] if r.get(f) is not None]
        ranges[f] = [min(vals), max(vals)] if vals else None

    ref_rates, ref_overall = load_ref()
    groups = [summarize(active, "All areas", "All primary areas", "all", ref_overall)]
    by_area = {}
    for p in active:
        by_area.setdefault(p["area"], []).append(p)
    for area, ps in by_area.items():
        groups.append(summarize(ps, AREA_SHORT.get(area, area), area, area, ref_rates.get(area)))
    # Areas sorted by mean average score, high -> low (All areas stays first).
    groups[1:] = sorted(groups[1:], key=lambda g: -(g["mean"] or 0))

    allg = groups[0]
    stats = {
        "venue": "ICLR 2027",
        "fetched_at_utc": raw["fetched_at"],
        "as_of_et": as_of_et,
        "bin_edges": BIN_EDGES,
        "thresholds": THRESHOLDS,
        "score_ranges": ranges,
        "counts": {
            "submissions_total": len(raw["papers"]),
            "active": status.get("Submission", 0),
            "withdrawn": status.get("Withdrawn_Submission", 0),
            "withdrawn_with_reviews": withdrawn_reviewed,
            "desk_rejected": status.get("Desk_Rejected_Submission", 0),
            "active_reviewed": allg["n_reviewed"],
            "active_unreviewed": allg["n_papers"] - allg["n_reviewed"],
            "reviews_active": allg["n_reviews"],
            "status_raw": dict(status),
        },
        "groups": groups,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "stats.json").write_text(json.dumps(stats, indent=1))

    hist_path = out_dir / "history.json"
    history = json.loads(hist_path.read_text()) if hist_path.exists() else []
    row = {
        "fetched_at_utc": raw["fetched_at"],
        "as_of_et": as_of_et,
        "active_reviewed": allg["n_reviewed"],
        "reviews": allg["n_reviews"],
        "withdrawn": status.get("Withdrawn_Submission", 0),
        "mean": allg["mean"],
        "median": allg["median"],
        "share_ge": allg["share_ge"],
        "rating_counts": allg["rating_counts"],
    }
    history = [h for h in history if h["fetched_at_utc"] != row["fetched_at_utc"]] + [row]
    history.sort(key=lambda h: h["fetched_at_utc"])
    hist_path.write_text(json.dumps(history, indent=1))

    print(f"As of {as_of_et}: {allg['n_reviewed']:,} reviewed active papers, {allg['n_reviews']:,} reviews, "
          f"mean avg {allg['mean']:.3f}, median {allg['median']}")
    print("share >= threshold:", {k: f"{v:.1%}" for k, v in allg["share_ge"].items()})
    print("status:", dict(status), "| score ranges:", ranges)


if __name__ == "__main__":
    main()
