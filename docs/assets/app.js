/* ICLR 2027 score stats: renders everything from data/stats.json + data/history.json. */
(function () {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";
  const RATING_LABELS = ["Clear reject", "Leaning reject", "Leaning accept", "Clear accept"];
  const fmtInt = (n) => n.toLocaleString("en-US");
  const pct = (x, d = 1) => (x == null ? "–" : (x * 100).toFixed(d) + "%");
  const pctSmart = (x) => (x == null ? "–" : x >= 0.1 ? (x * 100).toFixed(0) + "%" : (x * 100).toFixed(1) + "%");
  const f2 = (x) => (x == null ? "–" : x.toFixed(2));

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

  // ---------- Header tiles ----------
  function renderTiles() {
    const c = S.counts, g = allGroup();
    const tiles = [
      ["Papers with reviews", fmtInt(g.n_reviewed), `${fmtInt(c.active)} active submissions`],
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
  function renderLookupControls() {
    const sel = document.getElementById("lk-area");
    sel.replaceChildren(...S.groups.map((g, i) => el("option", { value: String(i), text: g.key === "all" ? "All areas" : g.name })));
    const inp = document.getElementById("lk-score");
    inp.addEventListener("input", renderLookup);
    sel.addEventListener("change", renderLookup);
  }
  function renderLookup() {
    const out = document.getElementById("lk-result");
    const x = parseFloat(document.getElementById("lk-score").value);
    const g = S.groups[parseInt(document.getElementById("lk-area").value, 10) || 0];
    if (!(x >= 1 && x <= 4)) { out.replaceChildren(el("p", { class: "muted", text: "Enter a value between 1 and 4." })); return; }
    const a = shareAtLeast(g, x), all = shareAtLeast(allGroup(), x);
    const xs = (Math.round(x * 100) / 100).toFixed(2);
    const kids = [
      el("p", null, el("span", { class: "big", text: "Top " + pct(a.share) }),
        document.createTextNode(`in ${g.key === "all" ? "all areas" : g.name}`)),
      el("p", { class: "muted", text: `${fmtInt(a.count)} of ${fmtInt(g.n_reviewed)} reviewed papers have an average ≥ ${xs}.` }),
    ];
    if (g.key !== "all") kids.push(el("p", { class: "muted", text: `Across all areas: top ${pct(all.share)} (${fmtInt(all.count)} of ${fmtInt(allGroup().n_reviewed)}).` }));
    if (g.ref_2026_accept_rate != null) kids.push(el("p", { class: "muted", text: `For reference, ICLR 2026 accepted ${pct(g.ref_2026_accept_rate, 0)} of decided papers in this area.` }));
    out.replaceChildren(...kids);
  }

  // ---------- Histogram (single series) ----------
  let sharedYMax = 0.3;
  function niceMax(v) {
    const step = v > 0.2 ? 0.1 : 0.05;
    return Math.max(step, Math.ceil((v + 0.005) / step) * step);
  }
  function drawHist(container, g, opts) {
    const W = Math.max(260, container.clientWidth || 340);
    const H = opts.height || 170;
    const m = { l: 34, r: 6, t: 22, b: 22 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const nb = g.hist.length, slot = iw / nb;
    const bw = Math.min(24, slot - 2);
    const yMax = opts.yMax;
    const y = (v) => m.t + ih - (v / yMax) * ih;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Histogram of average rating for ${g.name}` });

    const step = yMax > 0.2 ? 0.1 : 0.05;
    for (let v = 0; v <= yMax + 1e-9; v += step) {
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

    // x labels at interval edges (every 0.5)
    S.bin_edges.forEach((e, i) => {
      if (Math.abs(e * 2 - Math.round(e * 2)) > 1e-9) return;
      s.append(svgText(m.l + slot * i, H - 6, String(e), { "text-anchor": "middle", class: "xlbl tick" }));
    });

    // Selective direct labels: "Top x%" above the 2.5 and 3.0 interval columns.
    (opts.marks || []).forEach((t) => {
      const i = S.bin_edges.findIndex((e) => Math.abs(e - t) < 1e-9);
      if (i < 0) return;
      const share = g.share_ge[t.toFixed(2)];
      const h = (g.hist[i] / n / yMax) * ih;
      const cx = m.l + slot * i + slot / 2;
      const yy = m.t + ih - h - 6;
      s.append(svgText(cx - bw / 2, Math.max(10, yy), `Top ${pctSmart(share)}`, { "text-anchor": "start", class: "lbl" }));
    });
    container.replaceChildren(s);
  }

  // ---------- Rating columns (4 bars, diverging colors) ----------
  function drawRatings(container, g) {
    const W = Math.max(240, container.clientWidth || 300);
    const H = 220;
    const m = { l: 6, r: 6, t: 22, b: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const total = g.rating_counts.reduce((a, b) => a + b, 0) || 1;
    const shares = g.rating_counts.map((c) => c / total);
    const yMax = Math.max(...shares) * 1.08;
    const slot = iw / 4, bw = Math.min(56, slot * 0.6);
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Distribution of individual review ratings" });
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
      attachTip(hit, () => [["v", `${fmtInt(g.rating_counts[i])} reviews`], ["", `Rating ${i + 1} · ${RATING_LABELS[i]}`], ["k", `${pct(sh)} of all reviews`]]);
    });
    container.replaceChildren(s);
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
    const rows = S.groups.map((g) => {
      const tr = el("tr", g.key === "all" ? { class: "all" } : null);
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
    S.groups.forEach((g) => {
      const total = g.rating_counts.reduce((a, b) => a + b, 0) || 1;
      const name = el("div", { class: "name" + (g.key === "all" ? " all" : ""), title: g.full });
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
    const grid = document.getElementById("area-grid");
    const groups = S.groups.slice(1).concat([S.groups[0]]);
    sharedYMax = niceMax(Math.max(...S.groups.map((g) => Math.max(...g.hist) / (g.n_reviewed || 1))));
    grid.replaceChildren(...groups.map((g) => {
      const card = el("div", { class: "card panel" });
      const h = el("h3"); h.textContent = g.name;
      const full = el("div", { class: "full" }); full.textContent = g.key === "all" ? "All primary areas combined" : g.full;
      const meta = el("div", { class: "meta" });
      meta.append(document.createTextNode(`n = ${fmtInt(g.n_reviewed)} · mean `), el("b", { text: f2(g.mean) }),
        document.createTextNode(` · median ${f2(g.median)}`));
      if (g.ref_2026_accept_rate != null) meta.append(document.createTextNode(` · ICLR 2026 acc. ${pct(g.ref_2026_accept_rate, 0)}`));
      const chart = el("div", { class: "chart" });
      card.append(h, full, meta, chart);
      card._g = g; card._chart = chart;
      return card;
    }));
    drawAreaCharts();
  }
  function drawAreaCharts() {
    document.querySelectorAll("#area-grid .panel").forEach((card) => drawHist(card._chart, card._g, { yMax: sharedYMax, height: 170, marks: [2.5, 3.0] }));
  }

  // ---------- Interval table ----------
  let unit = "pct";
  function renderIntervals() {
    const nb = S.bin_edges.length - 1;
    const head = el("tr", null, el("th", { text: "Area" }), el("th", { text: "Papers" }),
      ...Array.from({ length: nb }, (_, i) => el("th", { text: binLabel(i) })));
    const rows = S.groups.map((g) => {
      const tr = el("tr", g.key === "all" ? { class: "all" } : null);
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

  // ---------- Main ----------
  function drawResponsive() {
    drawHist(document.getElementById("overall-hist"), allGroup(), { yMax: niceMax(Math.max(...allGroup().hist) / allGroup().n_reviewed), height: 220, marks: [2.0, 2.5, 3.0] });
    drawRatings(document.getElementById("ratings-bar"), allGroup());
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
    const g = allGroup();
    document.getElementById("overall-meta").replaceChildren(document.createTextNode(`n = ${fmtInt(g.n_reviewed)} papers · mean `), el("b", { text: f2(g.mean) }), document.createTextNode(` · median ${f2(g.median)}`));
    document.getElementById("ratings-meta").replaceChildren(document.createTextNode(`n = ${fmtInt(g.n_reviews)} reviews · mean rating `),
      el("b", { text: (g.rating_counts.reduce((a, c, i) => a + c * (i + 1), 0) / g.n_reviews).toFixed(2) }));
    renderTiles();
    renderLookupControls();
    renderLookup();
    renderCompare();
    renderMix();
    renderAreaGrid();
    renderIntervals();
    bindUnitToggle();
    renderHistory();
    drawResponsive();
    let t;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(drawResponsive, 120); });
  }
  main();
})();
