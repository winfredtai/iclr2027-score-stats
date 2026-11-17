# ICLR 2027 Review Score Statistics

A static site showing how ICLR 2027 review scores are distributed overall and within each of the 21 primary areas. The data is scraped from public OpenReview reviews and refreshed by hand during the rebuttal period.

**Site:** https://winfredtai.github.io/iclr2027-score-stats/

## What's on the page

- **Score lookup:** enter an average rating and pick an area to get "Top x%" in that area and across all areas.
- **Overall distribution:** a histogram of per-paper average ratings and the mix of individual 1–4 ratings.
- **Area comparison table:** share of papers with an average ≥ 2.00 / 2.33 / 2.50 / 2.67 / 3.00, shaded against all areas, plus the ICLR 2026 acceptance rate for each area.
- **Rating mix by area:** stacked bars showing each area's split of ratings 1–4.
- **Per-area histograms:** one-third-wide intervals (2.00–2.32, 2.33–2.66, …) on a shared y-axis.
- **Score-interval table:** percent or counts for every interval and area.
- **Snapshot history:** one row per refresh, to follow score changes through the rebuttal.

## How to refresh the data

**Option A: GitHub, nothing to install.** Go to the Actions tab, choose **Update data & deploy site**, then **Run workflow**. From a terminal you can run:

```bash
gh workflow run update.yml -R winfredtai/iclr2027-score-stats
```

The run fetches the latest scores, commits `docs/data/`, and redeploys the site. The full fetch takes about 15–20 minutes. This option needs the repo secrets `OPENREVIEW_USERNAME` and `OPENREVIEW_PASSWORD`.

**Option B: local.** Put your credentials in a `.env` file in the repo root. The file is git-ignored.

```
OPENREVIEW_USERNAME=you@example.com
OPENREVIEW_PASSWORD=...
```

Then run:

```bash
scripts/update.sh            # fetch, build, commit, push (the push triggers a redeploy)
scripts/update.sh --no-push  # fetch and build only
python3 -m http.server -d docs 8000   # preview at http://localhost:8000
```

Everything uses only the Python standard library (3.9+), so there is nothing to `pip install`.

## How it works

| Step | File | What it does |
|---|---|---|
| Fetch | `scripts/fetch.py` | Logs in to the OpenReview API v2 and pages through `ICLR.cc/2027/Conference/-/Edit`, using `select` so that only score fields come back, with no review text. That is about 169k notes and roughly 70 MB in total. It writes `data/raw/latest.json`, which is git-ignored. |
| Build | `scripts/build.py` | Computes per-area statistics, writes `docs/data/stats.json`, and appends a summary row to `docs/data/history.json`. |
| Reference | `scripts/fetch_ref_2026.py` | One-off script that computes the ICLR 2026 acceptance rate per primary area and writes `docs/data/ref_iclr2026.json`. |
| Site | `docs/` | Plain HTML, CSS and JS with no build step. Charts are drawn as SVG from the JSON files. |
| CI | `.github/workflows/update.yml` | Manual `workflow_dispatch` refresh, plus a Pages deploy on every push to `docs/`. |

Anonymous OpenReview API requests for notes now get a "challenge" 403, which is why the fetch logs in.

## Definitions

- **Paper average:** the unweighted mean of a paper's current overall ratings, on a 1–4 scale.
- **Population:** active submissions with at least one review. Withdrawn and desk-rejected papers are excluded.
- **Primary area:** the area the authors chose at submission.
- **ICLR 2026 acceptance rate:** accepted ÷ (accepted + rejected + withdrawn), with desk rejects excluded. That was 28% overall. Counting only papers that received a decision, it was 39%.

Unofficial; not affiliated with ICLR or OpenReview.
