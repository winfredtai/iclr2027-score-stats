/* ICLR 2027 score stats: renders everything from data/stats.json + data/history.json. */
(function () {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const RATING_LABELS = ["Clear reject", "Leaning reject", "Leaning accept", "Clear accept"];
  const fmtInt = (n) => n.toLocaleString("en-US");
  const pct = (x, d = 1) => (x == null ? "–" : (x * 100).toFixed(d) + "%");
  const pctSmart = (x) => (x == null ? "–" : x >= 0.1 ? (x * 100).toFixed(0) + "%" : (x * 100).toFixed(1) + "%");
  const f2 = (x) => (x == null ? "–" : x.toFixed(2));

  // Abstract registrations for ICLR 2027. Not available from the scraped data, so it is set by hand.
  const ABSTRACT_SUBMISSIONS = 62288;

  let S = null; // stats
  let H = []; // history

  // ---------- DOM helpers ----------
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "style") e.setAttribute("style", v);
      else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }
  function svg(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }
  function svgText(x, y, str, attrs) {
    const t = svg("text", Object.assign({ x, y }, attrs || {}));
    t.textContent = str;
    return t;
  }
  // Column with 4px rounded top, square bottom.
  function colPath(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    if (h <= 0) return "";
    return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  }

  // ---------- Tooltip ----------
  const tip = document.getElementById("tooltip");
  function showTip(evt, lines) {
    tip.replaceChildren();
    lines.forEach(([cls, s]) => tip.append(el("div", { class: cls, text: s })));
    tip.style.display = "block";
    moveTip(evt);
  }
  function moveTip(evt) {
    const pad = 14, r = tip.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  function hideTip() { tip.style.display = "none"; }
  function attachTip(node, linesFn, activeNode) {
    node.addEventListener("pointerenter", (e) => { showTip(e, linesFn()); if (activeNode) activeNode.classList.add("active"); });
    node.addEventListener("pointermove", moveTip);
    node.addEventListener("pointerleave", () => { hideTip(); if (activeNode) activeNode.classList.remove("active"); });
  }

  // ---------- Stats helpers ----------
  const binLabel = (i) => {
    const e = S.bin_edges, lo = e[i], hi = e[i + 1];
    return i === e.length - 2 ? `${lo.toFixed(2)}–${hi.toFixed(2)}` : `${lo.toFixed(2)}–${(hi - 0.01).toFixed(2)}`;
  };
  function shareAtLeast(g, x) {
    const t = Math.round(x * 100) / 100;
    let c = 0;
    for (const [v, n] of g.dist) if (v >= t - 1e-9) c += n;
    return { count: c, share: g.n_reviewed ? c / g.n_reviewed : null };
  }
  const allGroup = () => S.groups[0];

  // ---------- Selected area (global) ----------
  // sel = index into S.groups; 0 = "All areas" (complete view).
  let sel = 0;
  const selGroup = () => S.groups[sel];
  const isAll = () => sel === 0;
  // Rows for tables / mix chart: every area in the complete view, otherwise only "All areas" + the selected area.
  const visibleGroups = () => (isAll() ? S.groups : [S.groups[0], S.groups[sel]]);
  const areaLabel = (g) => (g.key === "all" ? "All areas" : g.name);

  // ---------- Header tiles ----------
  function renderTiles() {
    const c = S.counts, g = allGroup();
    const tiles = [
      ["Active papers", fmtInt(c.active), `${fmtInt(ABSTRACT_SUBMISSIONS)} abstract submissions`],
      ["Reviews", fmtInt(g.n_reviews), `${(g.n_reviews / g.n_reviewed).toFixed(2)} per paper on average`],
      ["Mean paper average", f2(g.mean), `median ${f2(g.median)} · IQR ${f2(g.q1)}–${f2(g.q3)}`],
      ["Average ≥ 2.5", pct(g.share_ge["2.50"]), `≥ 3.0: ${pct(g.share_ge["3.00"])}`],
      ["Withdrawn so far", fmtInt(c.withdrawn), `${fmtInt(c.desk_rejected)} desk rejected`],
    ];
    const box = document.getElementById("tiles");
    box.replaceChildren(...tiles.map(([l, v, n]) =>
      el("div", { class: "card tile" }, el("div", { class: "label", text: l }), el("div", { class: "value", text: v }), el("div", { class: "note", text: n }))));
  }

  // ---------- Lookup ----------
  function renderAreaControls() {
    const box = document.getElementById("area-sel");
    const areas = S.groups.map((g, i) => [g, i]).slice(1).sort((a, b) => a[0].name.localeCompare(b[0].name));
    box.replaceChildren(el("option", { value: "0", text: "All areas (complete view)" }),
      ...areas.map(([g, i]) => el("option", { value: String(i), text: g.name, title: g.full })));
    // Restore ?area=<key> from the URL so a filtered view can be shared.
    const key = new URLSearchParams(location.search).get("area");
    const i = key ? S.groups.findIndex((g) => g.key === key) : -1;
    sel = i > 0 ? i : 0;
    box.value = String(sel);
    box.addEventListener("change", () => setArea(parseInt(box.value, 10) || 0));
    document.getElementById("area-reset").addEventListener("click", () => setArea(0));
    document.getElementById("lk-score").addEventListener("input", renderLookup);
    syncAreaBar();
  }
  function syncAreaBar() {
    const g = selGroup();
    document.getElementById("area-sel").value = String(sel);
    document.getElementById("areabar").classList.toggle("selected", !isAll());
    document.getElementById("area-reset").hidden = isAll();
    document.getElementById("area-hint").textContent = isAll()
      ? "Pick an area to compare it with all areas, side by side, in every section."
      : `Showing all areas (left) vs. ${g.name} (right).`;
  }
  function setArea(i) {
    sel = i;
    const url = new URL(location.href);
    if (isAll()) url.searchParams.delete("area"); else url.searchParams.set("area", selGroup().key);
    history.replaceState(null, "", url);
    syncAreaBar();
    renderAreaDependent();
    drawResponsive();
  }
  function renderAreaDependent() {
    renderLookup();
    renderOverall();
    renderCompare();
    renderMix();
    renderAreaGrid();
    renderIntervals();
    renderTopPapers(true);
  }
  function renderLookup() {
    const out = document.getElementById("lk-result");
    const x = parseFloat(document.getElementById("lk-score").value);
    const g = selGroup();
    if (!(x >= 1 && x <= 4)) { out.replaceChildren(el("p", { class: "muted", text: "Enter a value between 1 and 4." })); return; }
    const a = shareAtLeast(g, x), all = shareAtLeast(allGroup(), x);
    const xs = (Math.round(x * 100) / 100).toFixed(2);
    const kids = [
      el("p", null, el("span", { class: "big", text: "Top " + pct(a.share) }),
        document.createTextNode(`in ${g.key === "all" ? "all areas" : g.name}`)),
      el("p", { class: "muted", text: `${fmtInt(a.count)} of ${fmtInt(g.n_reviewed)} reviewed papers have an average ≥ ${xs}.` }),
    ];
    if (g.key !== "all") kids.push(el("p", { class: "muted", text: `Across all areas: top ${pct(all.share)} (${fmtInt(all.count)} of ${fmtInt(allGroup().n_reviewed)}).` }));
    if (g.ref_2026_accept_rate != null) kids.push(el("p", { class: "muted", text: `For reference, ICLR 2026 accepted ${pct(g.ref_2026_accept_rate, 0)} of its non-desk-rejected submissions${g.key === "all" ? "" : " in this area"}.` }));
    out.replaceChildren(...kids);
  }

  // ---------- Histogram (single series) ----------
  let sharedYMax = 0.3;
  function niceMax(v) {
    return Math.max(0.05, Math.ceil((v + 0.005) / 0.05) * 0.05);
  }
  function drawHist(container, g, opts) {
    const W = Math.max(260, container.clientWidth || 340);
    const H = opts.height || 170;
    const m = { l: 34, r: 6, t: opts.marks ? 22 : 8, b: 22 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const nb = g.hist.length, slot = iw / nb;
    const bw = Math.min(24, slot - 2);
    const yMax = opts.yMax;
    const y = (v) => m.t + ih - (v / yMax) * ih;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Histogram of average rating for ${g.name}` });

    const step = yMax > 0.2 ? 0.1 : 0.05;
    for (let v = 0; v <= yMax + 1e-9; v = Math.round((v + step) * 100) / 100) {
      const yy = y(v);
      if (v > 0) s.append(svg("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: "gridline" }));
      s.append(svgText(m.l - 6, yy + 3.5, Math.round(v * 100) + "%", { "text-anchor": "end", class: "tick" }));
    }
    s.append(svg("line", { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: "baseline" }));

    const n = g.n_reviewed || 1;
    g.hist.forEach((c, i) => {
      const share = c / n;
      const cx = m.l + slot * i + slot / 2;
      const h = Math.max(0, (share / yMax) * ih);
      const p = svg("path", { d: colPath(cx - bw / 2, m.t + ih - h, bw, h), class: "bar" });
      p.setAttribute("aria-label", `${binLabel(i)}: ${pct(share)}`);
      s.append(p);
      const hit = svg("rect", { x: m.l + slot * i, y: m.t, width: slot, height: ih, class: "hit" });
      s.append(hit);
      const cum = g.hist.slice(i).reduce((a, b) => a + b, 0) / n;
      attachTip(hit, () => [["v", `${pct(share)} of papers`], ["", `Average ${binLabel(i)}`], ["k", `${fmtInt(c)} papers · ${pct(cum)} have average ≥ ${S.bin_edges[i].toFixed(2)}`]], p);
    });

    // x labels at every interval edge; integers emphasized.
    S.bin_edges.forEach((e, i) => {
      const isInt = Math.abs(e - Math.round(e)) < 1e-9;
      s.append(svgText(m.l + slot * i, H - 6, isInt ? String(e) : e.toFixed(2), { "text-anchor": "middle", class: isInt ? "xlbl tick" : "tick" }));
    });

    // Selective direct labels: "Top x%" above the 2.5 and 3.0 interval columns.
    // Only drawn where the interval is wide enough to hold the label without colliding.
    if (slot >= 50) (opts.marks || []).forEach((t) => {
      const i = S.bin_edges.findIndex((e) => Math.abs(e - t) < 1e-9);
      if (i < 0) return;
      const share = g.share_ge[t.toFixed(2)];
      const h = (g.hist[i] / n / yMax) * ih;
      const cx = m.l + slot * i + slot / 2;
      const yy = m.t + ih - h - 6;
      s.append(svgText(cx, Math.max(10, yy), `Top ${pctSmart(share)}`, { "text-anchor": "middle", class: "lbl" }));
    });
    container.replaceChildren(s);
  }

  // ---------- Rating columns (4 bars, diverging colors) ----------
  function drawRatings(container, g, opts) {
    const W = Math.max(240, container.clientWidth || 300);
    const H = 220;
    const m = { l: 6, r: 6, t: 22, b: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const total = g.rating_counts.reduce((a, b) => a + b, 0) || 1;
    const shares = g.rating_counts.map((c) => c / total);
    const yMax = (opts && opts.yMax) || Math.max(...shares) * 1.08;
    const slot = iw / 4, bw = Math.min(56, slot * 0.6);
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Distribution of individual review ratings for ${g.name}` });
    s.append(svg("line", { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, class: "baseline" }));
    shares.forEach((sh, i) => {
      const cx = m.l + slot * i + slot / 2;
      const h = (sh / yMax) * ih;
      const p = svg("path", { d: colPath(cx - bw / 2, m.t + ih - h, bw, h), style: `fill: var(--r${i + 1})` });
      s.append(p);
      s.append(svgText(cx, m.t + ih - h - 6, pct(sh), { "text-anchor": "middle", class: "lbl" }));
      s.append(svgText(cx, m.t + ih + 15, String(i + 1), { "text-anchor": "middle", class: "xlbl" }));
      s.append(svgText(cx, m.t + ih + 30, RATING_LABELS[i], { "text-anchor": "middle" }));
      const hit = svg("rect", { x: m.l + slot * i, y: m.t, width: slot, height: ih, class: "hit" });
      s.append(hit);
      attachTip(hit, () => [["v", `${fmtInt(g.rating_counts[i])} reviews`], ["", `Rating ${i + 1} · ${RATING_LABELS[i]}`], ["k", `${pct(sh)} of reviews in ${areaLabel(g)}`]]);
    });
    container.replaceChildren(s);
  }

  // ---------- Overall distribution (complete view, or all-areas | selected-area) ----------
  let overallDraws = [];
  const ratingShares = (g) => { const t = g.rating_counts.reduce((a, b) => a + b, 0) || 1; return g.rating_counts.map((c) => c / t); };
  const meanRating = (g) => g.rating_counts.reduce((a, c, i) => a + c * (i + 1), 0) / (g.n_reviews || 1);
  function overallCard(title, g, meta, draw, tagged) {
    const card = el("div", { class: "card panel" });
    if (tagged) card.append(el("span", { class: "tag " + (g.key === "all" ? "all" : "area"), text: areaLabel(g), title: g.full }));
    const chart = el("div", { class: "chart" });
    card.append(el("h3", { text: title }), el("div", { class: "meta" }, ...meta), chart);
    overallDraws.push(() => draw(chart));
    return card;
  }
  function renderOverall() {
    const body = document.getElementById("overall-body");
    overallDraws = [];
    const histMeta = (g) => [document.createTextNode(`n = ${fmtInt(g.n_reviewed)} papers · mean `), el("b", { text: f2(g.mean) }), document.createTextNode(` · median ${f2(g.median)}`)];
    const ratMeta = (g) => [document.createTextNode(`n = ${fmtInt(g.n_reviews)} reviews · mean rating `), el("b", { text: meanRating(g).toFixed(2) })];
    const marks = [2.0, 2.33, 2.67, 3.0];
    if (isAll()) {
      const g = allGroup();
      const yMax = niceMax(Math.max(...g.hist) / g.n_reviewed);
      document.getElementById("overall-sub").textContent = "All active submissions with at least one review, across all primary areas.";
      body.replaceChildren(el("div", { class: "grid2" },
        overallCard("Average rating per paper", g, histMeta(g), (c) => drawHist(c, g, { yMax, height: 220, marks }), false),
        overallCard("Individual review ratings", g, ratMeta(g), (c) => drawRatings(c, g), false)));
      return;
    }
    const pair = [allGroup(), selGroup()];
    // Shared y-axes so the two panels in each row can be compared directly.
    const hMax = niceMax(Math.max(...pair.map((g) => Math.max(...g.hist) / (g.n_reviewed || 1))));
    const rMax = Math.max(...pair.flatMap(ratingShares)) * 1.08;
    document.getElementById("overall-sub").textContent = `All areas (left) vs. ${selGroup().name} (right). Each row shares its y-axis.`;
    body.replaceChildren(
      el("div", { class: "grid-cmp" }, ...pair.map((g) =>
        overallCard("Average rating per paper", g, histMeta(g), (c) => drawHist(c, g, { yMax: hMax, height: 220, marks }), true))),
      el("div", { class: "grid-cmp" }, ...pair.map((g) =>
        overallCard("Individual review ratings", g, ratMeta(g), (c) => drawRatings(c, g, { yMax: rMax }), true))));
  }

  // ---------- Area comparison table ----------
  function renderCompare() {
    const thr = S.thresholds.map((t) => t.toFixed(2));
    const all = allGroup();
    const hasRef = S.groups.some((g) => g.ref_2026_accept_rate != null);
    // Scale shading by the largest deviation per column.
    const maxDev = {};
    thr.forEach((k) => {
      maxDev[k] = Math.max(1e-6, ...S.groups.slice(1).map((g) => Math.abs((g.share_ge[k] || 0) - all.share_ge[k])));
    });
    const head = el("tr", null,
      el("th", { text: "Area" }), el("th", { text: "Papers" }), el("th", { text: "Mean" }), el("th", { text: "Median" }),
      ...thr.map((k) => el("th", null, el("span", { class: "thr", text: "≥ " + k }))),
      hasRef ? el("th", { text: "ICLR 2026 acc. rate" }) : null);
    const rows = visibleGroups().map((g) => {
      const tr = el("tr", g.key === "all" ? { class: "all" } : !isAll() ? { class: "sel" } : null);
      const name = el("td", { class: "areaname", title: g.full });
      name.textContent = g.name;
      tr.append(name, el("td", { text: fmtInt(g.n_reviewed) }), el("td", { text: f2(g.mean) }), el("td", { text: f2(g.median) }));
      thr.forEach((k) => {
        const v = g.share_ge[k];
        const td = el("td", { text: pctSmart(v) });
        if (g.key !== "all" && v != null) {
          const d = v - all.share_ge[k];
          const a = Math.min(1, Math.abs(d) / maxDev[k]) * 0.45;
          if (a > 0.02) {
            td.style.background = `rgba(var(${d > 0 ? "--pos" : "--neg"}), ${a.toFixed(3)})`;
            td.className = "shade";
          }
          td.title = `${pct(v)} vs ${pct(all.share_ge[k])} for all areas (${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} pts)`;
        }
        tr.append(td);
      });
      if (hasRef) tr.append(el("td", { text: g.ref_2026_accept_rate == null ? "–" : pct(g.ref_2026_accept_rate, 0) }));
      return tr;
    });
    document.getElementById("compare-table").replaceChildren(el("thead", null, head), el("tbody", null, ...rows));
  }

  // ---------- Rating mix (100% stacked bars) ----------
  function renderMix() {
    const legend = document.getElementById("mix-legend");
    legend.replaceChildren(...RATING_LABELS.map((l, i) =>
      el("span", null, el("span", { class: "sw", style: `background: var(--r${i + 1})` }), document.createTextNode(`${i + 1} · ${l}`))));
    const box = document.getElementById("mix-chart");
    const kids = [el("div", { class: "head", text: "Area" }), el("div", { class: "head", text: "Share of reviews by rating" }), el("div", { class: "head mean", text: "Mean" })];
    visibleGroups().forEach((g) => {
      const total = g.rating_counts.reduce((a, b) => a + b, 0) || 1;
      const name = el("div", { class: "name" + (g.key === "all" ? " all" : !isAll() ? " sel" : ""), title: g.full });
      name.textContent = g.name;
      const stack = el("div", { class: "stack", role: "img" });
      stack.setAttribute("aria-label", g.name + ": " + g.rating_counts.map((c, i) => `rating ${i + 1} ${pct(c / total)}`).join(", "));
      g.rating_counts.forEach((c, i) => {
        if (!c) return;
        const sh = c / total;
        const seg = el("div", { class: "seg", style: `flex-grow:${c}; background: var(--r${i + 1}); color: var(--r${i + 1}-ink)` });
        seg.dataset.share = sh;
        attachTip(seg, () => [["v", pct(sh)], ["", `${g.name}`], ["k", `Rating ${i + 1} · ${RATING_LABELS[i]} · ${fmtInt(c)} reviews`]]);
        stack.append(seg);
      });
      kids.push(name, stack, el("div", { class: "mean", text: f2(g.mean) }));
    });
    box.replaceChildren(...kids);
    labelMixSegments();
  }
  // Put the share inside a segment only when it fits with padding.
  function labelMixSegments() {
    document.querySelectorAll("#mix-chart .seg").forEach((seg) => {
      const label = pctSmart(parseFloat(seg.dataset.share));
      seg.textContent = seg.clientWidth >= label.length * 7 + 10 ? label : "";
    });
  }

  // ---------- Per-area small multiples ----------
  function renderAreaGrid() {
    // The two-panel version would repeat the "Overall distribution" histograms, so hide the section when an area is picked.
    document.getElementById("areas").hidden = !isAll();
    document.getElementById("toc-areas").hidden = !isAll();
    if (!isAll()) return;
    const grid = document.getElementById("area-grid");
    const groups = S.groups.slice(1).concat([S.groups[0]]);
    sharedYMax = niceMax(Math.max(...groups.map((g) => Math.max(...g.hist) / (g.n_reviewed || 1))));
    grid.replaceChildren(...groups.map((g) => {
      const card = el("div", { class: "card panel" });
      const h = el("h3"); h.textContent = g.name;
      const full = el("div", { class: "full" }); full.textContent = g.key === "all" ? "All primary areas combined" : g.full;
      full.title = full.textContent;
      const meta = el("div", { class: "meta" });
      const item = (label, val) => el("span", { class: "item" }, document.createTextNode(label), el("b", { text: val }));
      meta.append(el("div", null, item("n = ", fmtInt(g.n_reviewed)), item(" · mean ", f2(g.mean)), item(" · median ", f2(g.median))));
      meta.append(el("div", null, item("≥ 2.33: ", pctSmart(g.share_ge["2.33"])), item(" · ≥ 2.67: ", pctSmart(g.share_ge["2.67"])), item(" · ≥ 3.00: ", pctSmart(g.share_ge["3.00"]))));
      if (g.ref_2026_accept_rate != null) meta.append(el("div", null, item("ICLR 2026 accept rate: ", pct(g.ref_2026_accept_rate, 0))));
      const chart = el("div", { class: "chart" });
      card.append(h, full, meta, chart);
      card._g = g; card._chart = chart;
      return card;
    }));
    drawAreaCharts();
  }
  function drawAreaCharts() {
    if (!isAll()) return;
    document.querySelectorAll("#area-grid .panel").forEach((card) => drawHist(card._chart, card._g, { yMax: sharedYMax, height: 170 }));
  }

  // ---------- Interval table ----------
  let unit = "pct";
  function renderIntervals() {
    const nb = S.bin_edges.length - 1;
    const head = el("tr", null, el("th", { text: "Area" }), el("th", { text: "Papers" }),
      ...Array.from({ length: nb }, (_, i) => el("th", { text: binLabel(i) })));
    const rows = visibleGroups().map((g) => {
      const tr = el("tr", g.key === "all" ? { class: "all" } : !isAll() ? { class: "sel" } : null);
      const name = el("td", { class: "areaname", title: g.full }); name.textContent = g.name;
      tr.append(name, el("td", { text: fmtInt(g.n_reviewed) }));
      g.hist.forEach((c, i) => {
        const sh = c / (g.n_reviewed || 1);
        const td = el("td", { text: unit === "pct" ? (c ? pct(sh) : "–") : (c ? fmtInt(c) : "–") });
        td.title = `${g.name}, ${binLabel(i)}: ${fmtInt(c)} papers (${pct(sh)})`;
        tr.append(td);
      });
      return tr;
    });
    document.getElementById("interval-table").replaceChildren(el("thead", null, head), el("tbody", null, ...rows));
  }
  function bindUnitToggle() {
    const bp = document.getElementById("unit-pct"), bc = document.getElementById("unit-cnt");
    const set = (u) => { unit = u; bp.classList.toggle("on", u === "pct"); bc.classList.toggle("on", u === "cnt"); renderIntervals(); };
    bp.addEventListener("click", () => set("pct"));
    bc.addEventListener("click", () => set("cnt"));
  }

  // ---------- History ----------
  function renderHistory() {
    const head = el("tr", null, ...["As of", "Papers w/ reviews", "Reviews", "Withdrawn", "Mean", "Median", "≥ 2.33", "≥ 2.50", "≥ 3.00", "Share of 3s + 4s"].map((t) => el("th", { text: t })));
    const rows = H.slice().reverse().map((h) => {
      const tot = h.rating_counts.reduce((a, b) => a + b, 0) || 1;
      return el("tr", null,
        el("td", { text: h.as_of_et }), el("td", { text: fmtInt(h.active_reviewed) }), el("td", { text: fmtInt(h.reviews) }),
        el("td", { text: fmtInt(h.withdrawn) }), el("td", { text: h.mean.toFixed(3) }), el("td", { text: f2(h.median) }),
        el("td", { text: pct(h.share_ge["2.33"]) }), el("td", { text: pct(h.share_ge["2.50"]) }), el("td", { text: pct(h.share_ge["3.00"]) }),
        el("td", { text: pct((h.rating_counts[2] + h.rating_counts[3]) / tot) }));
    });
    document.getElementById("history-table").replaceChildren(el("thead", null, head), el("tbody", null, ...rows));
  }

  // ---------- High-scoring papers ----------
  const TP_PAGE = 100;
  let TP = null, tpShown = TP_PAGE, tpRows = [];
  const forumUrl = (id) => "https://openreview.net/forum?id=" + encodeURIComponent(id);

  function tpFiltered() {
    const min = parseFloat(document.getElementById("tp-min").value);
    const area = isAll() ? -1 : TP.areas.indexOf(selGroup().name);
    const q = document.getElementById("tp-q").value.trim().toLowerCase();
    return TP.papers.filter((p) => p.avg >= min - 1e-9 && (area < 0 || p.a === area) && (!q || p.t.toLowerCase().includes(q)));
  }
  function deltaCell(p) {
    const td = el("td");
    if (p.new) {
      const b = el("span", { class: "delta new", text: "New" });
      b.title = `Average was below ${TP.min_avg.toFixed(2)} at the previous refresh (${TP.previous_as_of_et})`;
      td.append(b);
    } else if (p.prev != null) {
      const up = p.avg > p.prev;
      const d = el("span", { class: "delta " + (up ? "up" : "down"), text: `${up ? "▲" : "▼"} from ${p.prev.toFixed(2)}` });
      d.title = `Average was ${p.prev.toFixed(2)} at the previous refresh (${TP.previous_as_of_et})`;
      td.append(d);
    } else {
      td.append(el("span", { class: "muted", text: TP.compared_to_previous ? "–" : "" }));
    }
    return td;
  }
  function renderTopPapers(resetPaging) {
    if (!TP) return;
    if (resetPaging) tpShown = TP_PAGE;
    tpRows = tpFiltered();
    const min = document.getElementById("tp-min").value;
    const areaName = isAll() ? "all areas" : selGroup().name;
    const showArea = isAll();
    const count = document.getElementById("tp-count");
    count.replaceChildren(el("b", { text: fmtInt(tpRows.length) }),
      document.createTextNode(` papers with average ${min === "4.00" ? "= 4.00" : "≥ " + min} in ${areaName}`),
      document.createTextNode(TP.compared_to_previous ? ` · change vs. ${TP.previous_as_of_et}` : ""));

    const head = el("tr", null, el("th", { text: "#" }), el("th", { class: "l", text: "Title" }), showArea ? el("th", { class: "l", text: "Area" }) : null,
      el("th", { text: "Ratings" }), el("th", { text: "Avg" }), TP.compared_to_previous ? el("th", { text: "Change" }) : null);
    const body = el("tbody");
    tpRows.slice(0, tpShown).forEach((p, i) => {
      const a = el("a", { href: forumUrl(p.id), target: "_blank", rel: "noopener", text: p.t });
      const title = el("td", { class: "title" }, a, el("span", { class: "num", text: "#" + p.n }));
      const ratings = el("td", { class: "ratings" }, ...p.r.map((r) => el("span", { class: "chip r" + r, text: String(r) })));
      ratings.setAttribute("aria-label", "Ratings " + p.r.join(", "));
      body.append(el("tr", null, el("td", { class: "rank", text: String(i + 1) }), title,
        showArea ? el("td", { class: "area", text: TP.areas[p.a] }) : null, ratings, el("td", { text: p.avg.toFixed(2) }), TP.compared_to_previous ? deltaCell(p) : null));
    });
    document.getElementById("tp-table").replaceChildren(el("thead", null, head), body);
    const more = document.getElementById("tp-more");
    const left = tpRows.length - tpShown;
    more.hidden = left <= 0;
    more.textContent = `Show ${Math.min(TP_PAGE, left)} more (${fmtInt(left)} remaining)`;
  }
  function downloadTopCsv() {
    if (!TP) return;
    const esc = (v) => { const t = String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const lines = [["submission_number", "title", "primary_area", "ratings", "average", "previous_average", "openreview_url"].join(",")];
    tpRows.forEach((p) => lines.push([p.n, p.t, TP.areas[p.a], p.r.join(" "), p.avg.toFixed(2), p.prev != null ? p.prev.toFixed(2) : (p.new ? "<" + TP.min_avg.toFixed(2) : ""), forumUrl(p.id)].map(esc).join(",")));
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `iclr2027_avg_ge_${document.getElementById("tp-min").value}${isAll() ? "" : "_" + selGroup().name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function initTopPapers() {
    const section = document.getElementById("top-papers");
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      fetch("data/top_papers.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      }).then((d) => {
        TP = d;
        document.getElementById("tp-min").addEventListener("change", () => renderTopPapers(true));
        document.getElementById("tp-q").addEventListener("input", () => renderTopPapers(true));
        document.getElementById("tp-more").addEventListener("click", () => { tpShown += TP_PAGE; renderTopPapers(false); });
        document.getElementById("tp-csv").addEventListener("click", downloadTopCsv);
        renderTopPapers(true);
      }).catch(() => {
        document.getElementById("tp-count").textContent = "The paper list is not available for this snapshot yet.";
      });
    };
    // The list is ~1 MB, so only download it when the section is about to be seen.
    if ("IntersectionObserver" in window && location.hash !== "#top-papers") {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: "800px" });
      io.observe(section);
    } else {
      load();
    }
  }

  // ---------- Main ----------
  function drawResponsive() {
    overallDraws.forEach((draw) => draw());
    drawAreaCharts();
    labelMixSegments();
  }

  async function main() {
    try {
      const [s, h] = await Promise.all([
        fetch("data/stats.json", { cache: "no-cache" }).then((r) => r.json()),
        fetch("data/history.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      S = s; H = h;
    } catch (e) {
      document.getElementById("asof").textContent = "unavailable";
      document.getElementById("tiles").append(el("p", { class: "error", text: "Could not load data/stats.json." }));
      return;
    }
    document.getElementById("asof").textContent = S.as_of_et;
    document.getElementById("footer-asof").textContent = `Last updated ${S.as_of_et}.`;
    renderTiles();
    renderAreaControls();
    renderLookup();
    renderOverall();
    renderCompare();
    renderMix();
    renderAreaGrid();
    renderIntervals();
    bindUnitToggle();
    renderHistory();
    initTopPapers();
    drawResponsive();
    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(drawResponsive, 120); });
  }
  main();
})();
