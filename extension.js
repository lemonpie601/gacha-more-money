/* Gacha More Money v1.4.0 — personal extension for Gacha Forge 1.8.13 on Marinara Engine.
 *  - 상점 → 충전소: 에테르 · 자금 · 활력 · 반짝이 · 소환권 상품을 "결제"(진짜 돈은 나가지 않음)해 지갑에 넣습니다. 하루 3번.
 *  - 소환은 에테르 대신 소환권: 상시 배너는 성휘, 한정 배너는 월휘. 소환권은 에테르로 교환합니다.
 *  - 홈 로비 → [도감]: 적 · 캐릭터 · 의상 · 배경 · 전투 배경 · CG 이미지를 모아 봅니다.
 * The wallet lives in the game's own save, which no browser request can change, so the top-up and the enemy list
 * need the server patch in patch/apply-patch.mjs (POST /api/gacha-forge/more-money/*). Without it the shop shows
 * how to apply it, and the codex still shows everything the game already serves (/home-options). */
(() => {
  "use strict";
  const KEY = "__GF_MORE_MONEY_EXTENSION";
  if (typeof window[KEY] === "function") {
    try { window[KEY](); } catch {}
  }

  // Same headers as the game's own requests: the admin secret (other devices) and Marinara's CSRF marker.
  const ADMIN_SECRET_KEY = "marinara_admin_secret";
  function adminHeaders() {
    try { const t = (localStorage.getItem(ADMIN_SECRET_KEY) || "").trim(); return t ? { "X-Admin-Secret": t } : {}; } catch { return {}; }
  }
  const HOST_TAG = "marinara-capability-gacha-forge";
  const host = () => document.querySelector(HOST_TAG);
  const runId = () => { const h = host(); return String(h?._run?.runId || h?._activeRunId || ""); };
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  async function gf(path, body) {
    const res = await window.fetch("/api/gacha-forge" + path, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-marinara-csrf": "1", ...adminHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok === false) throw new ApiError((data && data.error) || "HTTP " + res.status, res.status);
    return data;
  }
  // A route the game does not know answers 404: the server patch is not applied (or Marinara was not restarted).
  const unpatched = (e) => e instanceof ApiError && (e.status === 404 || /not.?found|route/i.test(e.message) && e.status >= 400);

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");
  let disposed = false;
  const cleanups = [];

  /* ═════════════ Packs (keep in sync with patch/apply-patch.mjs PACKS / EXCHANGE) ═════════════ */
  // The two summon tickets: the standard banner takes 성휘, the limited (featured) banner 월휘.
  const TICKETS = {
    std: { key: "gmmTicketStd", name: "성휘", kind: "상시 소환권", tone: "std" },
    ltd: { key: "gmmTicketLtd", name: "월휘", kind: "한정 소환권", tone: "ltd" },
  };
  const PACKS = [
    { id: "starter", name: "첫걸음 꾸러미", icon: "gift", grant: "에테르 1,600 · 자금 50,000 · 월휘 1장", note: "가장 알찬 구성", price: "₩4,400", tone: "gift", best: "추천" },
    { id: "ticket-ltd", name: "월휘 꾸러미", icon: "ltd", grant: "월휘 10장", note: "한정 배너 10회 소환", price: "₩49,000", tone: "ltd", best: "인기!" },
    { id: "ticket-std", name: "성휘 꾸러미", icon: "std", grant: "성휘 10장", note: "상시 배너 10회 소환", price: "₩29,000", tone: "std" },
    { id: "aether-s", name: "에테르 한 줌", icon: "aether1", grant: "에테르 1,600", note: "소환권 10장어치", price: "₩33,000", tone: "aether" },
    { id: "aether-m", name: "에테르 상자", icon: "aether2", grant: "에테르 4,800", note: "소환권 30장어치", price: "₩99,000", tone: "aether" },
    { id: "aether-l", name: "에테르 보물고", icon: "aether3", grant: "에테르 9,600", note: "소환권 60장어치", price: "₩199,000", tone: "aether" },
    { id: "funds-s", name: "자금 자루", icon: "coins", grant: "자금 100,000", note: "레벨업 · 승급용", price: "₩11,000", tone: "funds" },
    { id: "funds-l", name: "자금 금괴", icon: "ingot", grant: "자금 300,000", note: "레벨업 · 승급용", price: "₩29,000", tone: "funds" },
    { id: "vigor", name: "활력 드링크", icon: "vigor", grant: "활력 +60", note: "최대치를 넘어 채워져요", price: "₩5,500", tone: "vigor" },
    { id: "glimmer", name: "반짝이 주머니", icon: "glimmer", grant: "반짝이 300", note: "상점 물건 구매용", price: "₩8,800", tone: "glimmer" },
  ];
  const DAILY = 3;
  // The weekly pass (keep in sync with patch PASS): not counted in the daily three.
  const PASS = { price: "₩6,600", days: 7, buy: "월휘 3장", daily: "에테르 300 · 성휘 1장" };
  // Tickets for aether, as often as you like: one summon still costs what it did (160 aether).
  const EXCHANGE = [
    { id: "std-1", ticket: "std", qty: 1, cost: 160 }, { id: "std-10", ticket: "std", qty: 10, cost: 1600 },
    { id: "ltd-1", ticket: "ltd", qty: 1, cost: 160 }, { id: "ltd-10", ticket: "ltd", qty: 10, cost: 1600 },
  ];

  /* ═════════════ Icons ═════════════
   * Small drawings in a 48×48 box, outlined in the theme's line colour (class "ln") with a white shine ("hi"). */
  const star4 = (x, y, r, w = r * 0.28) => `M${x} ${y - r}Q${x + w} ${y - w} ${x + r} ${y}Q${x + w} ${y + w} ${x} ${y + r}Q${x - w} ${y + w} ${x - r} ${y}Q${x - w} ${y - w} ${x} ${y - r}Z`;
  // A bright, glossy ticket: a gradient body edged in its own deeper colour (not the dark outline), a white
  // inner frame and perforation, and a gold emblem. id names its gradients inside the shadow root.
  const TICKET_PATH = "M8 13h32a3 3 0 0 1 3 3v4.6a3.4 3.4 0 0 0 0 6.8V32a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4.6a3.4 3.4 0 0 0 0-6.8V16a3 3 0 0 1 3-3z";
  const ticket = (id, light, mid, edge, emblem) => '<defs><linearGradient id="gmm-' + id + '" x1="0" y1="0" x2="0.35" y2="1">'
    + '<stop offset="0" stop-color="' + light + '"/><stop offset="1" stop-color="' + mid + '"/></linearGradient>'
    + '<linearGradient id="gmm-' + id + '-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF8D2"/><stop offset="1" stop-color="#FFC93C"/></linearGradient></defs>'
    + '<g transform="rotate(-10 24 24)">'
    + '<path fill="url(#gmm-' + id + ')" stroke="' + edge + '" stroke-width="2.4" stroke-linejoin="round" d="' + TICKET_PATH + '"/>'
    + '<path fill="#fff" opacity=".28" d="M8.6 14.6h30.8a1.8 1.8 0 0 1 1.8 1.8v3.6c-9 2.4-23 2.4-34.4 0v-3.6a1.8 1.8 0 0 1 1.8-1.8z"/>'
    + '<rect x="9" y="16.4" width="30" height="15.2" rx="2.2" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="1.2"/>'
    + '<path d="M16 18.5v11" stroke="#fff" stroke-opacity=".9" stroke-width="1.6" stroke-dasharray="1.6 2.2" stroke-linecap="round"/>'
    + emblem.replaceAll("GOLD", "url(#gmm-" + id + "-gold)").replaceAll("EDGE", edge) + '</g>';
  const crystal = (cx, cy, s, fill, face) => {
    const p = (x, y) => (cx + x * s).toFixed(1) + " " + (cy + y * s).toFixed(1);
    return '<path class="ln" fill="' + fill + '" d="M' + p(-6, -12) + "L" + p(6, -12) + "L" + p(12, -4) + "L" + p(0, 13) + "L" + p(-12, -4) + 'Z"/>'
      + '<path fill="' + face + '" d="M' + p(-3, -4) + "L" + p(3, -4) + "L" + p(0, 13) + 'Z"/>'
      + '<path class="ln" fill="none" stroke-width="1.6" d="M' + p(-12, -4) + "L" + p(12, -4) + "M" + p(-6, -12) + "L" + p(-3, -4) + "L" + p(0, 13) + "M" + p(6, -12) + "L" + p(3, -4) + '"/>'
      + '<path class="hi" d="M' + p(-4.6, -10.4) + "L" + p(-1.2, -10.4) + "L" + p(-2.6, -5.6) + "L" + p(-8.6, -5.6) + 'Z"/>';
  };
  const coin = (x, y) => '<path class="ln" fill="#E9A400" d="M' + (x - 14) + " " + y + 'v5a14 5.4 0 0 0 28 0v-5"/>'
    + '<ellipse class="ln" fill="#FFD34E" cx="' + x + '" cy="' + y + '" rx="14" ry="5.4"/>'
    + '<ellipse fill="none" stroke="#E9A400" stroke-width="1.5" cx="' + x + '" cy="' + y + '" rx="8.5" ry="3"/>';
  const twinkle = (x, y, r) => '<path fill="#FFF6C8" class="ln" stroke-width="1.2" d="' + star4(x, y, r) + '"/>';
  const ICONS = {
    std: ticket("std", "#B8EEFF", "#3DB2F5", "#1C8AD6", '<path fill="GOLD" stroke="EDGE" stroke-width="1.6" stroke-linejoin="round" d="' + star4(28.5, 24, 6.8) + '"/>'
      + '<path fill="#fff" d="' + star4(36.5, 19, 2.2) + '"/><circle fill="#fff" cx="35" cy="29" r="1"/>'),
    ltd: ticket("ltd", "#FFD0DE", "#FF5C8A", "#D6336A", '<path fill="GOLD" stroke="EDGE" stroke-width="1.6" stroke-linejoin="round" d="M31.4 17.2a7 7 0 1 0 0 13.6a5.6 5.6 0 1 1 0-13.6z"/>'
      + '<path fill="#fff" d="' + star4(36.5, 19, 2.2) + '"/><circle fill="#fff" cx="36" cy="28.5" r="1"/>'),
    aether1: crystal(24, 25, 1.35, "#A98CF5", "#CDB8FF") + twinkle(40, 9, 3.2),
    aether2: crystal(14, 31, 0.8, "#8C6CF0", "#B9A2FA") + crystal(29, 24, 1.15, "#A98CF5", "#CDB8FF") + twinkle(42, 9, 3.2),
    aether3: crystal(11, 33, 0.72, "#8C6CF0", "#B9A2FA") + crystal(37, 33, 0.72, "#8C6CF0", "#B9A2FA") + crystal(24, 23, 1.15, "#A98CF5", "#CDB8FF") + twinkle(41, 8, 3.2),
    coins: coin(22, 35) + coin(22, 27.5) + coin(22, 20) + twinkle(40, 10, 3.2),
    ingot: '<path class="ln" fill="#E9A400" d="M7 37l5-10h24l5 10z"/><path class="ln" fill="#FFD34E" d="M12 27l4-9h16l4 9z"/>'
      + '<path class="hi" d="M17 20h6l-1.5 3.5h-6z"/>' + twinkle(38, 12, 3.2),
    vigor: '<rect class="ln" fill="#9A7350" x="19" y="5.5" width="10" height="5" rx="1.5"/>'
      + '<path class="ln" fill="#6FD69B" d="M19 10.5h10v3.5l5 5V39a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V19l5-5z"/>'
      + '<path class="ln" stroke-width="1.8" fill="#FFF3A0" d="M26.5 20l-7 10h4.5l-2 8.5 8-11h-4.6z"/><rect class="hi" x="16.5" y="21" width="2.4" height="13" rx="1.2"/>',
    glimmer: '<path class="ln" fill="#FFB347" d="' + star4(21, 27, 15, 3.4) + '"/><path class="hi" d="' + star4(17.5, 22.5, 3, 0.8) + '"/>'
      + '<path class="ln" stroke-width="1.8" fill="#FFD34E" d="' + star4(36.5, 13, 7, 1.8) + '"/><circle class="ln" stroke-width="1.4" fill="#FFD34E" cx="38" cy="35" r="2.6"/>',
    pass: '<defs><linearGradient id="gmm-pass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE9A8"/><stop offset="1" stop-color="#FFB347"/></linearGradient></defs>'
      + '<rect x="7" y="10" width="34" height="31" rx="5" fill="url(#gmm-pass)" stroke="#E08A1E" stroke-width="2.4"/>'
      + '<path d="M7 18.5h34" stroke="#E08A1E" stroke-width="2"/><path fill="#fff" opacity=".35" d="M10 12.5h28a1.5 1.5 0 0 1 1.5 1.5v3H8.5v-3a1.5 1.5 0 0 1 1.5-1.5z"/>'
      + '<rect x="14" y="6" width="3.6" height="8" rx="1.8" fill="#fff" stroke="#E08A1E" stroke-width="1.8"/><rect x="30.4" y="6" width="3.6" height="8" rx="1.8" fill="#fff" stroke="#E08A1E" stroke-width="1.8"/>'
      + '<text x="24" y="36.5" text-anchor="middle" font-family="Jua, sans-serif" font-size="15" font-weight="700" fill="#fff" stroke="#E08A1E" stroke-width="3" paint-order="stroke">7</text>'
      + '<path fill="#fff" d="' + star4(38, 9, 3.4) + '"/>',
    gift: '<path class="ln" fill="#FF8FB1" d="M9 22h30v16a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z"/><rect class="ln" fill="#FFB3C9" x="6" y="15" width="36" height="8" rx="2"/>'
      + '<path class="ln" fill="#FFE17A" d="M21 15h6v26h-6z"/><path class="ln" fill="#FFE17A" d="M24 15c-3-6-10-7-10-2.5S20 15 24 15zM24 15c3-6 10-7 10-2.5S28 15 24 15z"/>'
      + '<rect class="hi" x="9" y="17" width="9" height="2.2" rx="1.1"/>',
  };
  // Each drawing gets its own gradient ids: with shared ids every url(#…) used the first copy in the page, and
  // once that copy sat in a hidden pane (the key items behind 충전소) the tickets lost their colours.
  let iconSeq = 0;
  function icon(kind) {
    const n = el("span", "gmm-ic"), uid = "gmm" + (++iconSeq) + "-";
    const art = (ICONS[kind] || "").replace(/(id="|url\(#)gmm-/g, "$1" + uid);
    n.innerHTML = '<svg class="gmm-svg" viewBox="0 0 48 48" width="1.6em" height="1.6em" aria-hidden="true">' + art + "</svg>";
    return n;
  }

  /* ═════════════ Styles inside the game (the shop) ═════════════ */
  const GAME_CSS = `
/* Theme tokens. Without 말랑 UI they follow the game's own style (vanguard · aurora · bloom · signal · ember):
 * dark tiles, thin rules, cut corners, the coral action colour. 말랑 UI marks the host with data-gfx-style and
 * gets the round cream sticker look instead. The codex lives outside .gf-arena and copies these (themeVars). */
.gf-arena {
  --gmm-font: var(--display, inherit);
  --gmm-text: var(--text, #EDF1F6);
  --gmm-muted: var(--steel-faint, #8AA2BC);
  --gmm-card: color-mix(in srgb, var(--ink-2, #151D2C) 92%, transparent);
  --gmm-card-hi: var(--ink, #0E1420);
  --gmm-line: var(--ink-3, #1E293B);
  --gmm-edge: var(--steel-dark, #23374F);
  --gmm-accent: var(--coral, #F2603C);
  --gmm-on-accent: var(--on-coral, #FFFFFF);
  --gmm-pick: var(--amber, #F0B429);
  --gmm-sky1: var(--glow-1, #2B3D57);
  --gmm-sky2: var(--ground-2, #0B1119);
  --gmm-sheet: var(--ground-1, #17212F);
  --gmm-icon-line: var(--ink, #0E1420);
  --gmm-buy-bg: var(--coral, #F2603C);
  --gmm-buy-fg: var(--on-coral, #FFFFFF);
  --gmm-x-bg: var(--epic, #9B6FD4);
  --gmm-ok-bg: var(--jade, #2E9E7B);
  --gmm-ask-bg: var(--alarm, #E0334B);
  --gmm-bw: 1px;
  --gmm-bw2: 1px;
  --gmm-drop: 0em;
  --gmm-r: var(--radius-sm, 0px);
  --gmm-pill: var(--radius-sm, 0px);
  --gmm-clip: var(--clip-card, none);
  --gmm-clip-btn: var(--clip-btn, none);
  --gmm-shadow: var(--panel-shadow, 0 0 0 transparent);
  --gmm-blur: var(--panel-blur, none);
  --gmm-case: var(--case, none);
}
:host([data-gfx-style="trickcal"]) .gf-arena {
  --gmm-font: "Jua", var(--display, inherit), sans-serif;
  --gmm-text: var(--gfx-text, #4A3020);
  --gmm-muted: color-mix(in srgb, var(--gfx-text, #4A3020) 70%, transparent);
  --gmm-card: var(--gfx-card, #FFFDF5);
  --gmm-card-hi: var(--gfx-card, #FFFDF5);
  --gmm-line: var(--gfx-line, #6B4528);
  --gmm-edge: var(--gfx-line, #6B4528);
  --gmm-accent: var(--gfx-accent, #F0763A);
  --gmm-on-accent: #FFFFFF;
  --gmm-pick: var(--gfx-pick, #FFE17A);
  --gmm-sky1: var(--gfx-sky1, #FFE08A);
  --gmm-sky2: var(--gfx-sky2, #BDE9DA);
  --gmm-sheet: var(--gfx-card, #FFFDF5);
  --gmm-icon-line: var(--gfx-line, #6B4528);
  --gmm-buy-bg: linear-gradient(180deg, #FFE27A, #FFC93C);
  --gmm-buy-fg: #5A3A10;
  --gmm-x-bg: linear-gradient(180deg, #A98CF5, #7B5BE0);
  --gmm-ok-bg: linear-gradient(180deg, #8EE6A0, #3DA95A);
  --gmm-ask-bg: linear-gradient(180deg, #FF9BB5, #FF6F91);
  --gmm-bw: 3px;
  --gmm-bw2: 2.5px;
  --gmm-drop: .3em;
  --gmm-r: 20px;
  --gmm-pill: 999px;
  --gmm-clip: none;
  --gmm-clip-btn: none;
  --gmm-shadow: 0 0 0 transparent;
  --gmm-blur: none;
  --gmm-case: none;
}
.gmm-cat { position: relative; }
.gmm-cat .sh-cat-nm::after { content: "NEW"; margin-left: .4em; font-size: .62em; padding: .05em .45em; border-radius: var(--gmm-pill); background: var(--gmm-accent); color: var(--gmm-on-accent); vertical-align: middle; }
.sh-pane.gmm-open > :not(.gmm-pane) { display: none !important; }
.gmm-pane { display: flex; flex-direction: column; gap: .8em; min-height: 0; height: 100%; overflow: auto; padding: .4em .2em .8em; box-sizing: border-box;
  font-family: var(--gmm-font); color: var(--gmm-text); }
.gmm-pane .gmm-top { display: flex; align-items: center; justify-content: space-between; gap: .6em; flex-wrap: wrap; }
.gmm-pane .gmm-title { font-size: calc(var(--f, 10px) * 1.6); font-family: var(--title, var(--gmm-font)); text-transform: var(--gmm-case); }
:host([data-gfx-style="trickcal"]) .gmm-pane .gmm-title { font-family: var(--gmm-font); }
.gmm-pane .gmm-left { padding: .2em .9em; border-radius: var(--gmm-pill); background: var(--gmm-card); border: 2px solid var(--gmm-line);
  box-shadow: 0 calc(var(--gmm-drop) * .47) 0 var(--gmm-line); font-size: calc(var(--f, 10px) * 1.05); }
.gmm-pane .gmm-left b { color: var(--gmm-accent); }
.gmm-pane .gmm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--f, 10px) * 15), 1fr)); gap: .9em; }
/* Cards: a game tile (dark, thin rule, coloured top edge, cut corner) or a 말랑 sticker. */
.gmm-pack, .gmm-pass, .gmm-x { --cut: .7em; clip-path: var(--gmm-clip); color: var(--gmm-text); background: var(--gmm-card); backdrop-filter: var(--gmm-blur);
  border: var(--gmm-bw) solid var(--gmm-line); border-top: max(var(--gmm-bw), 2px) solid var(--gmm-edge); }
:host([data-gfx-style="trickcal"]) :is(.gmm-pack, .gmm-pass, .gmm-x) { border-top-width: var(--gmm-bw); }
.gmm-pack[data-tone="ltd"], .gmm-pack[data-tone="gift"] { border-top-color: var(--gmm-accent); }
.gmm-pack[data-tone="std"] { border-top-color: var(--water, var(--gmm-edge)); }
.gmm-pack[data-tone="aether"] { border-top-color: var(--epic, var(--gmm-edge)); }
.gmm-pack[data-tone="funds"], .gmm-pack[data-tone="glimmer"] { border-top-color: var(--gmm-pick); }
.gmm-pack[data-tone="vigor"] { border-top-color: var(--jade, var(--gmm-edge)); }
:host([data-gfx-style="trickcal"]) .gmm-pack { border-color: var(--gmm-line); }
.gmm-pack { position: relative; display: flex; flex-direction: column; align-items: center; gap: .35em; padding: 1em .8em .9em; border-radius: var(--gmm-r);
  box-shadow: 0 var(--gmm-drop) 0 var(--gmm-line), var(--gmm-shadow); text-align: center; }
.gmm-pack[data-best]::before { content: attr(data-best); position: absolute; top: .45em; right: .55em; padding: .05em .7em; border-radius: var(--gmm-pill);
  background: var(--gmm-accent); color: var(--gmm-on-accent); font-size: calc(var(--f, 10px) * .8); }
:host([data-gfx-style="trickcal"]) .gmm-pack[data-best]::before { top: -.75em; right: .8em; background: #FF6F91; color: #fff; border: 2px solid var(--gmm-line); font-size: calc(var(--f, 10px) * .85); rotate: 6deg; }
.gmm-pack .gmm-ic { display: block; width: calc(var(--f, 10px) * 5.2); height: calc(var(--f, 10px) * 5.2); }
.gmm-pass { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .9em; padding: .8em 1em; border-radius: var(--gmm-r);
  background: linear-gradient(110deg, color-mix(in srgb, var(--gmm-pick) 22%, var(--gmm-card)), var(--gmm-card) 60%);
  border-top-color: var(--gmm-pick); box-shadow: 0 var(--gmm-drop) 0 var(--gmm-line), var(--gmm-shadow); }
:host([data-gfx-style="trickcal"]) .gmm-pass { background: linear-gradient(110deg, color-mix(in srgb, #FFE9A8 55%, var(--gmm-card)), var(--gmm-card) 60%); border-color: var(--gmm-line); }
.gmm-pass > .gmm-ic { width: calc(var(--f, 10px) * 5.4); height: calc(var(--f, 10px) * 5.4); }
.gmm-pass-body { display: flex; flex-direction: column; gap: .25em; min-width: 0; }
.gmm-pass-title { font-size: calc(var(--f, 10px) * 1.35); display: flex; align-items: baseline; gap: .6em; flex-wrap: wrap; }
.gmm-pass-title small { font-size: .7em; color: var(--gmm-accent); }
.gmm-pass-line { font-size: calc(var(--f, 10px) * .9); opacity: .85; white-space: pre-wrap; }
.gmm-pass-days { display: flex; gap: .35em; margin-top: .2em; flex-wrap: wrap; }
.gmm-pass-days span { display: grid; place-items: center; width: 1.9em; height: 1.9em; border-radius: 50%; font-size: calc(var(--f, 10px) * .8);
  background: var(--gmm-card-hi); border: 2px solid color-mix(in srgb, var(--gmm-edge) 60%, transparent); }
.gmm-pass-days span[data-got] { background: #FFC93C; border-color: var(--gmm-edge); color: #5A3A10; }
.gmm-pass-days span[data-today] { border: 2.5px solid var(--gmm-accent); animation: gmm-ask .6s ease-in-out infinite alternate; }
.gmm-pass-days span[data-miss] { opacity: .45; text-decoration: line-through; }
/* Buttons: the game's action button (flat coral, cut corner) or 말랑's glossy pill. */
.gmm-pass > button, .gmm-pack button, .gmm-x button { cursor: pointer; font: inherit; white-space: nowrap; --cut: .45em; clip-path: var(--gmm-clip-btn);
  border-radius: var(--gmm-pill); border: var(--gmm-bw2) solid var(--gmm-line); box-shadow: 0 calc(var(--gmm-drop) * .6) 0 var(--gmm-line); }
:host(:not([data-gfx-style="trickcal"])) :is(.gmm-pass > button, .gmm-pack button, .gmm-x button) { border-color: transparent; font-weight: 700; letter-spacing: .04em; }
.gmm-pass > button { font-size: calc(var(--f, 10px) * 1.1); padding: .4em 1.1em; color: var(--gmm-buy-fg); background: var(--gmm-buy-bg); }
.gmm-pass > button[data-claim]:not(:disabled) { background: var(--gmm-ok-bg); color: #fff; }
.gmm-pass > button[data-ask] { background: var(--gmm-ask-bg); color: #fff; animation: gmm-ask .5s ease-in-out infinite alternate; }
.gmm-pass > button:disabled { filter: grayscale(.6); opacity: .7; cursor: default; }
@container (max-width: 520px) { .gmm-pass { grid-template-columns: auto 1fr; } .gmm-pass > button { grid-column: 1 / -1; } }
.gmm-pane h3 { margin: .4em 0 0; font-weight: 400; font-size: calc(var(--f, 10px) * 1.25); display: flex; align-items: baseline; gap: .5em; flex-wrap: wrap; }
:host(:not([data-gfx-style="trickcal"])) .gmm-pane h3 { font-weight: 700; padding-bottom: .15em; border-bottom: 1px solid var(--gmm-edge); }
.gmm-pane h3 small { font-size: .7em; opacity: .7; font-weight: 400; }
.gmm-pane .gmm-xgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--f, 10px) * 20), 1fr)); gap: .8em; }
.gmm-x { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .5em .6em; padding: .55em .8em; border-radius: var(--gmm-r);
  box-shadow: 0 calc(var(--gmm-drop) * .8) 0 var(--gmm-line), var(--gmm-shadow); }
.gmm-x[data-tone="std"] { border-top-color: var(--water, var(--gmm-edge)); }
.gmm-x[data-tone="ltd"] { border-top-color: var(--gmm-accent); }
:host([data-gfx-style="trickcal"]) .gmm-x { border-color: var(--gmm-line); }
.gmm-x .gmm-ic { display: block; width: calc(var(--f, 10px) * 3.4); height: calc(var(--f, 10px) * 3.4); }
.gmm-tile .art .gmm-ic { display: block; width: 100%; aspect-ratio: 1; }
/* Drawn icons: outlined in the theme's line colour, a small shadow under them. */
.gmm-svg { overflow: visible; filter: drop-shadow(0 .08em .04em rgba(0, 0, 0, .18)); }
.gmm-svg .ln { stroke: var(--gmm-icon-line, #6B4528); stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
.gmm-svg .hi { fill: #fff; opacity: .55; }
.gmm-x .gmm-nm { display: flex; flex-direction: column; line-height: 1.25; white-space: nowrap; min-width: 0; font-size: calc(var(--f, 10px) * 1.1); }
.gmm-x .gmm-nm small { font-size: .78em; opacity: .7; }
.gmm-x .gmm-have { font-size: calc(var(--f, 10px) * .9); opacity: .85; white-space: nowrap; }
.gmm-x .gmm-buys { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: .4em; }
.gmm-x button { padding: .25em .7em; color: #fff; background: var(--gmm-x-bg); }
.gmm-x button:active:not(:disabled):active:not(:disabled) { translate: 0 .12em; box-shadow: 0 calc(var(--gmm-drop) * .13) 0 var(--gmm-line); }
.gmm-x button:disabled:disabled { filter: grayscale(.8); opacity: .6; cursor: default; }
/* Drawings fill their box once styled. */
.gmm-svg { width: 100%; height: 100%; }
/* The top bar on the summon screen: tickets for this banner, like the game's own currency chips. */
.gf-bar .gmm-cur { cursor: pointer; font: inherit; color: inherit; position: relative; }
.gf-bar .gmm-cur .gmm-ic { display: flex; }
.gf-bar .gmm-cur svg.gmm-svg { width: calc(var(--gf-f, 10px) * 1.7); height: calc(var(--gf-f, 10px) * 1.7); margin: calc(var(--gf-f, 10px) * -.25) 0; }
.gf-bar .gmm-cur .gmm-plus { display: grid; place-items: center; width: 1.25em; height: 1.25em; border-radius: 50%; font-weight: 700; line-height: 1;
  color: var(--gmm-on-accent); background: var(--gmm-accent); }
.gf-bar .gmm-cur:hover { border-color: var(--gmm-accent); }
/* The exchange box, over the whole game. */
.gmm-ask { position: fixed; inset: 0; z-index: 2147482000; display: grid; place-items: center; background: rgba(6, 8, 14, .6); backdrop-filter: blur(2px);
  font-family: var(--gmm-font); color: var(--gmm-text); animation: gmm-fade .16s ease-out; }
:host([data-gfx-style="trickcal"]) .gmm-ask { background: rgba(40, 28, 20, .45); }
@keyframes gmm-fade { from { opacity: 0; } }
.gmm-ask-card { position: relative; width: min(560px, 90vw); display: flex; flex-direction: column; gap: 1em; padding: 1.4em 1.6em 1.3em; text-align: center;
  --cut: 1em; clip-path: var(--gmm-clip); border-radius: calc(var(--gmm-r) + 4px); background: var(--gmm-sheet);
  border: var(--gmm-bw) solid var(--gmm-line); border-top: 2px solid var(--gmm-pick); box-shadow: 0 var(--gmm-drop) 0 var(--gmm-line), 0 24px 60px -18px rgba(0, 0, 0, .85);
  animation: gmm-pop .2s cubic-bezier(.16, .84, .44, 1); }
:host([data-gfx-style="trickcal"]) .gmm-ask-card { border-top: var(--gmm-bw) solid var(--gmm-line); }
@keyframes gmm-pop { from { scale: .94; opacity: 0; } }
.gmm-ask-head { display: flex; align-items: center; justify-content: center; gap: .5em; padding-bottom: .7em; border-bottom: 1px solid color-mix(in srgb, var(--gmm-edge) 80%, transparent); }
.gmm-ask-head .gmm-ic { width: 2.4em; height: 2.4em; display: block; }
.gmm-ask-head h3 { margin: 0; font-size: 1.45em; font-weight: 700; letter-spacing: .04em; }
:host([data-gfx-style="trickcal"]) .gmm-ask-head h3 { font-weight: 400; }
.gmm-ask-x { position: absolute; top: .7em; right: .8em; width: 2em; height: 2em; border-radius: 50%; cursor: pointer; font: inherit; color: var(--gmm-text);
  background: transparent; border: 1px solid var(--gmm-line); }
.gmm-ask-x:hover { border-color: var(--gmm-accent); }
.gmm-ask-body { display: flex; flex-direction: column; gap: .45em; padding: .4em 0 .2em; }
.gmm-ask-line { margin: 0; font-size: 1.12em; line-height: 1.55; }
.gmm-ask-line b { color: var(--gmm-pick); }
.gmm-ask-line b.gmm-aet { color: var(--epic, #9B6FD4); }
:host([data-gfx-style="trickcal"]) .gmm-ask-line b { color: var(--gmm-accent); }
.gmm-ask-sub { margin: 0; font-size: .86em; opacity: .75; }
.gmm-ask-note { margin: 0; font-size: .9em; color: var(--gmm-accent); }
.gmm-ask-btns { display: flex; gap: .7em; justify-content: center; flex-wrap: wrap; }
.gmm-ask-btns button { flex: 1 1 0; min-width: 8em; cursor: pointer; font: inherit; font-size: 1.05em; font-weight: 700; padding: .55em 1em; white-space: nowrap;
  --cut: .5em; clip-path: var(--gmm-clip-btn); border-radius: var(--gmm-pill); border: var(--gmm-bw2) solid var(--gmm-line); box-shadow: 0 calc(var(--gmm-drop) * .6) 0 var(--gmm-line); }
.gmm-ask-btns .gmm-ask-no { color: var(--gmm-text); background: var(--gmm-card-hi); }
.gmm-ask-btns .gmm-ask-yes { color: var(--gmm-buy-fg); background: var(--gmm-buy-bg); }
:host(:not([data-gfx-style="trickcal"])) .gmm-ask-btns .gmm-ask-yes { border-color: transparent; }
.gmm-ask-btns button:hover:not(:disabled) { filter: brightness(1.08); }
.gmm-ask-btns button:disabled { filter: grayscale(.8); opacity: .55; cursor: default; }
:host([data-gfx-style="trickcal"]) .gmm-ask-btns button { font-weight: 400; }
.gmm-pack .gmm-nm { font-size: calc(var(--f, 10px) * 1.25); }
.gmm-pack .gmm-gr { font-size: calc(var(--f, 10px) * 1.05); color: var(--gmm-accent); }
.gmm-pack .gmm-nt { font-size: calc(var(--f, 10px) * .8); opacity: .75; }
.gmm-pack button { margin-top: .3em; width: 100%; font-size: calc(var(--f, 10px) * 1.15); padding: .35em .6em; color: var(--gmm-buy-fg); background: var(--gmm-buy-bg); }
.gmm-pack button:active:not(:disabled) { translate: 0 .15em; box-shadow: 0 calc(var(--gmm-drop) * .17) 0 var(--gmm-line); }
.gmm-pack button[data-ask] { background: var(--gmm-ask-bg); color: #fff; animation: gmm-ask .5s ease-in-out infinite alternate; }
@keyframes gmm-ask { to { scale: 1.04; } }
.gmm-pack button:disabled { filter: grayscale(.8); opacity: .65; cursor: default; }
.gmm-pane .gmm-msg { padding: .7em 1em; border-radius: var(--gmm-r); background: color-mix(in srgb, var(--gmm-pick) 18%, var(--gmm-card));
  border: 2px dashed var(--gmm-edge); line-height: 1.5; font-size: calc(var(--f, 10px) * .95); white-space: pre-line; }
:host([data-gfx-style="trickcal"]) .gmm-pane .gmm-msg { background: color-mix(in srgb, var(--gmm-pick) 35%, var(--gmm-card)); }
.gmm-pane .gmm-fine { font-size: calc(var(--f, 10px) * .78); opacity: .7; text-align: center; }
/* The codex button under the lobby's [✥ 배치] (말랑 UI), or alone on the home screen without it. */
.gmm-codex-btn { position: absolute; left: 1.6%; top: calc(10.5% + var(--f, 10px) * 2.6); z-index: 500; pointer-events: auto; cursor: pointer;
  display: inline-flex; align-items: center; gap: .3em; font-family: var(--gmm-font); font-size: calc(var(--f, 10px) * .95); padding: .3em .9em;
  --cut: .45em; clip-path: var(--gmm-clip-btn); border-radius: var(--gmm-pill);
  color: var(--gmm-text); background: var(--gmm-card); backdrop-filter: var(--gmm-blur); border: max(var(--gmm-bw), 2px) solid var(--gmm-line);
  box-shadow: 0 calc(var(--gmm-drop) * .6) 0 var(--gmm-line); }
:host(:not([data-gfx-style="trickcal"])) .gmm-codex-btn { font-weight: 700; letter-spacing: .04em; border-width: 1px; border-left: 2px solid var(--gmm-accent); }
:host(:not([data-gfx-style="trickcal"])) .gmm-codex-btn:hover { border-color: var(--gmm-accent); }
.gmm-codex-btn .gmm-ic-book { width: 1.15em; height: 1.15em; flex: none; }
.gmm-codex-btn:active { translate: 0 .12em; box-shadow: 0 calc(var(--gmm-drop) * .2) 0 var(--gmm-line); }
.gfx-lobby[data-edit] > .gmm-codex-btn { display: none; }
`;
  let gameSheet = null;
  function ensureGameSheet(root) {
    if (!gameSheet) { gameSheet = new CSSStyleSheet(); gameSheet.replaceSync(GAME_CSS + PAGE_CSS); }
    if (!root.adoptedStyleSheets.includes(gameSheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, gameSheet];
  }

  /* ═════════════ Shop: 충전소 ═════════════ */
  let shopOpen = false, status = null, statusAt = 0, statusRun = "", buying = "", confirming = "", patchMissing = false, lastNote = "";
  async function loadStatus(force) {
    const id = runId();
    if (!id) return;
    if (!force && statusRun === id && Date.now() - statusAt < 30000) return;
    statusAt = Date.now(); statusRun = id;
    try { status = await gf("/more-money/status", { runId: id }); patchMissing = false; }
    catch (e) { status = null; patchMissing = unpatched(e); if (!patchMissing) lastNote = "남은 횟수를 불러오지 못했어요 (" + e.message + ")."; }
    schedule();
  }
  const held = (t) => (status && status.tickets ? Number(status.tickets[t]) || 0 : null);
  const aether = () => { const w = host()?._wallet; return w && Number.isFinite(Number(w.aether)) ? Number(w.aether) : null; };
  // The top bar reads the game's own copy of the wallet; hand it the new one so it shows at once.
  function adoptWallet(wallet) {
    const h = host();
    if (!h || !wallet) return;
    try { h._wallet = wallet; h._shopRev = (Number(h._shopRev) || 0) + 1; h._renderBrowser?.(); } catch {}
  }
  async function buy(pack) {
    if (buying) return;
    // First press asks, the second pays (a dialog box may be blocked inside the game's frame).
    if (confirming !== pack.id) { confirming = pack.id; schedule(); return; }
    confirming = ""; buying = pack.id; lastNote = ""; schedule();
    // A short "paying" beat, like a real checkout.
    await new Promise((r) => setTimeout(r, 700));
    try {
      const data = await gf("/more-money/topup", { runId: runId(), pack: pack.id });
      status = { ...(status || {}), ...data };
      lastNote = "결제 완료! " + pack.grant + "을(를) 받았어요. (오늘 남은 충전 " + data.left + "/" + (data.daily || DAILY) + ")";
      adoptWallet(data.wallet);
    } catch (e) {
      if (unpatched(e)) patchMissing = true;
      else if (e.message === "daily-limit") { lastNote = "오늘은 더 충전할 수 없어요. 내일 다시 와 주세요!"; status = { ...(status || {}), left: 0 }; }
      else lastNote = "충전하지 못했어요 (" + e.message + "). 잠시 뒤 다시 시도해 주세요.";
    }
    buying = "";
    schedule();
  }
  async function passAction(kind) {
    if (buying) return;
    if (kind === "buy" && confirming !== "pass") { confirming = "pass"; schedule(); return; }
    confirming = ""; buying = "pass-" + kind; lastNote = ""; schedule();
    if (kind === "buy") await new Promise((r) => setTimeout(r, 700));
    try {
      const data = await gf("/more-money/pass/" + kind, { runId: runId() });
      status = { ...(status || {}), tickets: data.tickets, pass: data.pass };
      lastNote = kind === "buy" ? "주간 패스 시작! " + PASS.buy + "을(를) 받았어요. 오늘부터 " + PASS.days + "일 동안 매일 보상을 받으세요."
        : "주간 패스 " + data.pass.day + "일째 보상: " + PASS.daily + "을(를) 받았어요!";
      adoptWallet(data.wallet);
    } catch (e) {
      if (unpatched(e)) patchMissing = true;
      else lastNote = ({ "pass-active": "이미 주간 패스가 진행 중이에요.", "pass-claimed": "오늘 보상은 이미 받았어요. 내일 또 와 주세요!", "pass-inactive": "주간 패스가 없어요." })[e.message]
        || "주간 패스를 처리하지 못했어요 (" + e.message + ").";
      loadStatus(true);
    }
    buying = "";
    schedule();
  }
  function passCard() {
    const ps = status && status.pass, on = !!(ps && ps.active);
    const card = el("div", "gmm-pass" + (on ? " on" : ""));
    const body = el("div", "gmm-pass-body");
    const title = el("div", "gmm-pass-title", "주간 패스");
    if (on) title.append(el("small", "", ps.day + "일째 · 남은 " + ps.daysLeft + "일"));
    body.append(title, el("div", "gmm-pass-line", "구매 즉시  " + PASS.buy), el("div", "gmm-pass-line", PASS.days + "일 동안 매일  " + PASS.daily));
    const dots = el("div", "gmm-pass-days");
    for (let d = 1; d <= PASS.days; d++) {
      const dot = el("span", "", String(d));
      if (on && (ps.claimedDays || []).includes(d)) dot.dataset.got = "";
      else if (on && d === ps.day) dot.dataset.today = "";
      else if (on && d < ps.day) dot.dataset.miss = "";
      dots.append(dot);
    }
    body.append(dots);
    let b;
    if (!on) {
      b = el("button", "", buying === "pass-buy" ? "결제 중…" : confirming === "pass" ? PASS.price + " 결제할까요?" : PASS.price);
      if (confirming === "pass") b.dataset.ask = "";
      b.addEventListener("click", (e) => { e.stopPropagation(); passAction("buy"); });
    } else {
      b = el("button", "", ps.claimedToday ? "오늘 보상 받음 ✓" : buying === "pass-claim" ? "받는 중…" : "오늘 보상 받기");
      b.dataset.claim = "";
      b.disabled = !!ps.claimedToday;
      b.addEventListener("click", (e) => { e.stopPropagation(); passAction("claim"); });
    }
    b.type = "button";
    if (buying || patchMissing) b.disabled = true;
    card.append(icon("pass"), body, b);
    return card;
  }
  // Aether for tickets: no "pay?" step, it is the game's own currency (like the shop's glimmer items).
  async function exchange(x) {
    if (buying) return;
    buying = x.id; schedule();
    const tk = TICKETS[x.ticket];
    try {
      const data = await gf("/more-money/exchange", { runId: runId(), item: x.id });
      status = { ...(status || {}), tickets: data.tickets };
      lastNote = tk.name + " " + x.qty + "장을 받았어요! (에테르 -" + fmt(x.cost) + ")";
      adoptWallet(data.wallet);
    } catch (e) {
      if (unpatched(e)) patchMissing = true;
      else lastNote = e.message === "insufficient-aether" ? "에테르가 모자라요. (" + tk.name + " " + x.qty + "장 = 에테르 " + fmt(x.cost) + ")" : "교환하지 못했어요 (" + e.message + ").";
    }
    buying = "";
    schedule();
  }
  function exchangeRow(t) {
    const tk = TICKETS[t], have = held(t), a = aether();
    const row = el("div", "gmm-x"); row.dataset.tone = tk.tone;
    const nm = el("span", "gmm-nm"); nm.append(tk.name, el("small", "", tk.kind));
    const buys = el("span", "gmm-buys");
    for (const x of EXCHANGE.filter((x) => x.ticket === t)) {
      const b = el("button", "", buying === x.id ? "교환 중…" : "+" + x.qty + " · ✦" + fmt(x.cost)); b.type = "button";
      b.disabled = !!buying || patchMissing || (a != null && a < x.cost);
      b.addEventListener("click", (e) => { e.stopPropagation(); exchange(x); });
      buys.append(b);
    }
    row.append(icon(t), nm, el("span", "gmm-have", have == null ? "" : "보유 " + fmt(have) + "장"), buys);
    return row;
  }
  function paintShop(root) {
    const screen = root.querySelector('[data-screen="shop"]');
    if (!screen) { shopOpen = false; return; }
    const rail = screen.querySelector(".sh-rail"), pane = screen.querySelector(".sh-pane");
    if (!rail || !pane) return;
    loadStatus(false);
    const left = status ? status.left : null;
    let cat = rail.querySelector(":scope > .gmm-cat");
    if (!cat) {
      cat = el("button", "sh-cat gmm-cat"); cat.type = "button";
      cat.append(el("span", "sh-cat-nm", "충전소"), el("span", "sh-cat-n"));
      cat.addEventListener("click", (e) => { e.stopPropagation(); shopOpen = true; loadStatus(true); schedule(); });
      rail.append(cat);
    }
    if (!rail.dataset.gmmWatch) {
      rail.dataset.gmmWatch = "1";
      // Any of the game's own tabs closes the top-up pane again.
      rail.addEventListener("click", (e) => { if (e.target.closest?.(".sh-cat:not(.gmm-cat)")) { shopOpen = false; schedule(); } }, true);
    }
    const count = patchMissing ? "패치 필요" : left == null ? "하루 " + DAILY + "번" : "오늘 " + left + "/" + DAILY;
    const n = cat.querySelector(".sh-cat-n");
    if (n.textContent !== count) n.textContent = count;
    cat.classList.toggle("on", shopOpen);
    // The game's own tab stays lit underneath while 충전소 is open; give its mark back on close, since pressing
    // that same tab again does not make the game draw the shop afresh (the key-item tickets read it).
    for (const other of rail.querySelectorAll(":scope > .sh-cat:not(.gmm-cat)")) {
      if (shopOpen && other.classList.contains("on")) { other.classList.remove("on"); other.dataset.gmmWasOn = "1"; }
      else if (!shopOpen && other.dataset.gmmWasOn) { delete other.dataset.gmmWasOn; other.classList.add("on"); }
    }
    pane.classList.toggle("gmm-open", shopOpen);
    let mine = pane.querySelector(":scope > .gmm-pane");
    if (!shopOpen) { mine?.remove(); paintKeyItems(rail, pane); return; }
    const key = JSON.stringify([left, buying, confirming, patchMissing, lastNote, status && status.tickets, status && status.pass, aether()]);
    if (mine && mine.dataset.key === key) return;
    const scroll = mine ? mine.scrollTop : 0;
    mine?.remove();
    mine = el("div", "gmm-pane"); mine.dataset.key = key;
    const top = el("div", "gmm-top");
    const leftTag = el("span", "gmm-left"); leftTag.append("오늘 남은 충전 ", el("b", "", left == null ? "?" : String(left)), " / " + DAILY);
    top.append(el("span", "gmm-title", "충전소"), leftTag);
    mine.append(top);
    if (patchMissing) mine.append(el("div", "gmm-msg", "충전하려면 서버 패치가 필요해요.\n마리나라를 끄고, 이 확장 폴더의 patch/apply-patch.mjs를 실행한 뒤 다시 켜 주세요.\n(자세한 방법은 README 참고)"));
    if (lastNote) mine.append(el("div", "gmm-msg", lastNote));
    const h0 = el("h3", "", "주간 패스"); h0.append(el("small", "", "하루 " + DAILY + "번 충전과 따로 세요 · 끝나면 다시 살 수 있어요"));
    mine.append(h0, passCard());
    const h1 = el("h3", "", "소환권 교환"); h1.append(el("small", "", "에테르로 사요 · 상시 배너는 성휘, 한정 배너는 월휘으로만 소환할 수 있어요"));
    const xgrid = el("div", "gmm-xgrid"); xgrid.append(exchangeRow("std"), exchangeRow("ltd"));
    const h2 = el("h3", "", "오늘의 충전"); h2.append(el("small", "", "모든 상품을 합쳐 하루 " + DAILY + "번"));
    const grid = el("div", "gmm-grid");
    for (const p of PACKS) {
      const card = el("div", "gmm-pack"); card.dataset.tone = p.tone; if (p.best) card.dataset.best = p.best;
      const b = el("button", "", buying === p.id ? "결제 중…" : confirming === p.id ? p.price + " 결제할까요?" : p.price); b.type = "button";
      if (confirming === p.id) b.dataset.ask = "";
      b.disabled = !!buying || patchMissing || left === 0;
      b.addEventListener("click", (e) => { e.stopPropagation(); buy(p); });
      card.append(icon(p.icon), el("span", "gmm-nm", p.name), el("span", "gmm-gr", p.grant), el("span", "gmm-nt", p.note), b);
      grid.append(card);
    }
    mine.append(h1, xgrid, h2, grid, el("div", "gmm-fine", "놀이용 가상 결제예요. 실제 돈은 나가지 않으며, 충전 횟수는 서버 날짜 기준으로 매일 초기화돼요."));
    pane.append(mine);
    mine.scrollTop = scroll;
  }

  /* ═════════════ Shop → Key Items: the tickets on the game's own shelf ═════════════
   * Same tiles as the game's items (art, tag, name, buy button), after its own; they pay in aether. */
  function paintKeyItems(rail, pane) {
    const grid = pane.querySelector(":scope > .item-board > .grid");
    const onKey = !!rail.querySelector(':scope > .sh-cat.on[data-shop-cat="key"]');
    if (!grid || !onKey || patchMissing || !status) { grid?.querySelectorAll(":scope > .gmm-tile").forEach((n) => n.remove()); return; }
    const a = aether();
    const key = JSON.stringify([status.tickets, buying, a]);
    if (grid.dataset.gmmKey === key && grid.querySelector(":scope > .gmm-tile")) return;
    grid.dataset.gmmKey = key;
    grid.querySelectorAll(":scope > .gmm-tile").forEach((n) => n.remove());
    for (const x of EXCHANGE) {
      const tk = TICKETS[x.ticket], short = a != null && a < x.cost;
      const tile = el("div", "tile item has gmm-tile" + (short ? " short" : ""));
      tile.title = tk.name + " " + x.qty + "장 (" + tk.kind + ")";
      const art = el("span", "art"); art.append(icon(x.ticket));
      const b = el("button", "sh-buy", buying === x.id ? "교환 중…" : "✦ " + fmt(x.cost)); b.type = "button";
      b.disabled = !!buying || short;
      b.addEventListener("click", (e) => { e.stopPropagation(); exchange(x); });
      const act = el("span", "act"); act.append(b);
      tile.append(art, el("span", "st", "보유 " + fmt(held(x.ticket) ?? 0) + "장"), el("span", "lv", tk.name + " ×" + x.qty), act);
      grid.append(tile);
    }
  }

  /* ═════════════ Summon: tickets instead of aether ═════════════
   * With the patch the server takes 성휘 (standard banners) or 월휘 (limited banners) for each pull.
   * The tickets held show in the top bar beside aether while the summon screen is open (press it to buy more).
   * The game greys its pull buttons by aether; here they stay pressable, and a pull without enough tickets opens
   * a "buy the missing tickets with aether?" box first, then pulls (the game reads aria-disabled when pressed). */
  let summonSeen = false;
  const bannerTicket = () => String(host()?._summonBannerId || "char-featured").split("-")[1] === "standard" ? "std" : "ltd";
  function paintSummon(root) {
    const screen = root.querySelector('[data-screen="banner"]');
    const pulls = screen?.querySelector(".pulls");
    const chip = root.querySelector(".gmm-cur");
    if (!pulls) { chip?.remove(); if (ask) closeAsk(); if (summonSeen) { summonSeen = false; loadStatus(true); } return; }
    if (!summonSeen) { summonSeen = true; loadStatus(true); }
    if (patchMissing || !status) { chip?.remove(); return; }
    const t = bannerTicket(), tk = TICKETS[t], have = held(t) ?? 0;
    for (const b of pulls.querySelectorAll("[data-pull]")) {
      const n = Number(b.dataset.pull) === 10 ? 10 : 1;
      const cost = b.querySelector(".cost"), label = tk.name + " ×" + n + (n === 10 ? " · 4★ 이상 1회 보장" : "");
      if (cost && cost.textContent !== label) cost.textContent = label;
      if (b.hasAttribute("aria-disabled")) b.removeAttribute("aria-disabled");
      if (!b.dataset.gmmWatch) {
        b.dataset.gmmWatch = "1";
        // Before the game's own handler (capture runs first on the button itself): short of tickets, ask instead.
        b.addEventListener("click", (e) => {
          if (patchMissing || !status) return;
          const tt = bannerTicket(), h = held(tt) ?? 0;
          if (h < n) { e.preventDefault(); e.stopImmediatePropagation(); openAsk(tt, n); return; }
          // After a pull the server has taken the tickets; read the count again once the results are in.
          setTimeout(() => loadStatus(true), 1500);
        }, true);
      }
    }
    // The top bar: tickets for this banner, first among the currencies.
    const bar = root.querySelector(".gf-bar .currencies");
    if (!bar) return;
    const key = t + ":" + have;
    if (chip && chip.parentElement === bar && chip.dataset.key === key) return;
    chip?.remove();
    const c = el("button", "currency gmm-cur"); c.type = "button"; c.dataset.key = key; c.dataset.tone = tk.tone;
    c.title = tk.name + " (" + tk.kind + ") · 눌러서 에테르로 교환"; c.setAttribute("aria-label", c.title);
    const v = el("div", "value", fmt(have));
    c.append(icon(t), v, el("span", "gmm-plus", "+"));
    c.addEventListener("click", (e) => { e.stopPropagation(); openAsk(t, 0); });
    bar.prepend(c);
  }

  /* ═════════════ The exchange box ═════════════
   * need > 0: a pull of n is short by `need` tickets; buying them pulls at once. need 0: buy 1 or 10 from the top bar. */
  let ask = null;
  function closeAsk() { ask?.node.remove(); ask = null; }
  function openAsk(t, n) {
    closeAsk();
    const have = held(t) ?? 0, need = n ? Math.max(0, n - have) : 0;
    ask = { t, n, need, node: null, busy: false, note: "" };
    renderAsk();
  }
  function renderAsk() {
    if (!ask) return;
    const root = host()?.shadowRoot, arena = root?.querySelector(".gf-arena");
    if (!arena) { closeAsk(); return; }
    const { t, n, need } = ask, tk = TICKETS[t], a = aether();
    const node = el("div", "gmm-ask");
    const card = el("div", "gmm-ask-card");
    const x = el("button", "gmm-ask-x", "✕"); x.type = "button"; x.setAttribute("aria-label", "닫기");
    x.addEventListener("click", (e) => { e.stopPropagation(); closeAsk(); });
    const head = el("div", "gmm-ask-head"); head.append(icon(t), el("h3", "", tk.name + " 교환"));
    const body = el("div", "gmm-ask-body");
    const btns = el("div", "gmm-ask-btns");
    const cancel = el("button", "gmm-ask-no", "취소"); cancel.type = "button";
    cancel.addEventListener("click", (e) => { e.stopPropagation(); closeAsk(); });
    btns.append(cancel);
    if (need > 0) {
      const cost = need * 160, short = a != null && a < cost;
      const line = el("p", "gmm-ask-line");
      line.append(tk.name + "가 ", el("b", "", need + "장"), " 부족해요. ", el("b", "gmm-aet", "에테르 " + fmt(cost)), "을 써서 교환하고 소환할까요?");
      body.append(line);
      if (short) body.append(el("p", "gmm-ask-sub", "*에테르가 " + fmt(cost - a) + " 더 필요해요. 상점 [충전소]에서 구할 수 있어요."));
      else body.append(el("p", "gmm-ask-sub", "보유 에테르 " + fmt(a ?? 0) + " → " + fmt((a ?? 0) - cost) + " · " + tk.kind + " " + n + "회 소환"));
      const go = el("button", "gmm-ask-yes", ask.busy ? "교환 중…" : "교환하고 소환"); go.type = "button";
      go.disabled = ask.busy || short;
      go.addEventListener("click", (e) => { e.stopPropagation(); buyAndPull(); });
      btns.append(go);
    } else {
      body.append(el("p", "gmm-ask-line", "보유 " + tk.name + " " + fmt(held(t) ?? 0) + "장 · 1장 = 에테르 160"));
      body.append(el("p", "gmm-ask-sub", tk.kind + " · 보유 에테르 " + fmt(a ?? 0)));
      for (const xi of EXCHANGE.filter((xi) => xi.ticket === t)) {
        const b = el("button", "gmm-ask-yes", "+" + xi.qty + "장 · ✦" + fmt(xi.cost)); b.type = "button";
        b.disabled = ask.busy || (a != null && a < xi.cost);
        b.addEventListener("click", (e) => { e.stopPropagation(); buyInBox(xi.qty); });
        btns.append(b);
      }
    }
    if (ask.note) body.append(el("p", "gmm-ask-note", ask.note));
    card.append(x, head, body, btns);
    node.append(card);
    node.addEventListener("click", (e) => { e.stopPropagation(); if (e.target === node) closeAsk(); });
    node.addEventListener("pointerdown", (e) => e.stopPropagation());
    ask.node?.remove();
    ask.node = node;
    arena.append(node);
  }
  // k tickets of type t for aether: ten at once when it is ten, else one at a time. True when all arrived.
  async function buyTickets(t, k) {
    const steps = k === 10 ? [t + "-10"] : Array.from({ length: k }, () => t + "-1");
    for (const item of steps) {
      const data = await gf("/more-money/exchange", { runId: runId(), item });
      status = { ...(status || {}), tickets: data.tickets };
      adoptWallet(data.wallet);
    }
    return true;
  }
  async function runAsk(work) {
    if (!ask || ask.busy) return false;
    ask.busy = true; ask.note = ""; renderAsk();
    try { await work(); return true; }
    catch (e) {
      if (unpatched(e)) patchMissing = true;
      if (ask) ask.note = e.message === "insufficient-aether" ? "에테르가 모자라요." : "교환하지 못했어요 (" + e.message + ").";
      loadStatus(true);
      return false;
    } finally { if (ask) { ask.busy = false; renderAsk(); } schedule(); }
  }
  async function buyInBox(qty) {
    const { t } = ask;
    if (await runAsk(() => buyTickets(t, qty)) && ask) ask.note = TICKETS[t].name + " " + qty + "장을 받았어요!";
    renderAsk();
  }
  async function buyAndPull() {
    const { t, n, need } = ask;
    if (!(await runAsk(() => buyTickets(t, need)))) return;
    closeAsk();
    // The game redraws the banner when the wallet changes; press the fresh button once it has the tickets.
    await new Promise((r) => setTimeout(r, 80));
    paint();
    host()?.shadowRoot?.querySelector('[data-screen="banner"] .pulls [data-pull="' + n + '"]')?.click();
  }

  /* ═════════════ Lobby: [도감] button ═════════════ */
  // A little open book, drawn in the button's text colour (an emoji looked different on every device).
  const BOOK_ICON = '<svg class="gmm-ic-book" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10 5 7 4.6 3.5 5v13c3.5-.4 6.5 0 8.5 1.5 2-1.5 5-1.9 8.5-1.5V5C17 4.6 14 5 12 6.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 6.5v13" stroke="currentColor" stroke-width="2"/></svg>';
  function paintCodexButton(root) {
    const home = root.querySelector(".hm-screen");
    const old = root.querySelector(".gmm-codex-btn");
    if (!home) { old?.remove(); return; }
    // Under 말랑 UI's [✥ 배치] when its lobby is there; otherwise at the same spot on the home screen.
    const lobby = home.querySelector(".gfx-lobby");
    const parent = lobby && lobby.querySelector(":scope > .gfx-lobby-tools") ? lobby : home;
    if (old && old.parentElement === parent) return;
    old?.remove();
    const b = el("button", "gmm-codex-btn"); b.type = "button";
    b.innerHTML = BOOK_ICON;
    b.append("도감");
    b.addEventListener("click", (e) => { e.stopPropagation(); openCodex(); });
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    parent.append(b);
  }

  /* ═════════════ Codex (a page over the game) ═════════════ */
  const PAGE_CSS = `
.gmm-codex { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; background: rgba(8, 10, 16, .55); backdrop-filter: blur(3px);
  font-family: var(--gmm-font, "Malgun Gothic", sans-serif);
  --c-card: var(--gmm-card-hi, #0E1420); --c-text: var(--gmm-text, #EDF1F6); --c-line: var(--gmm-line, #1E293B); --c-edge: var(--gmm-edge, #23374F);
  --c-accent: var(--gmm-accent, #F2603C); --c-on-accent: var(--gmm-on-accent, #fff); --c-pick: var(--gmm-pick, #F0B429);
  --c-sky1: var(--gmm-sky1, #2B3D57); --c-sky2: var(--gmm-sky2, #0B1119); --c-sheet: var(--gmm-sheet, #17212F);
  --c-bw: var(--gmm-bw, 1px); --c-drop: var(--gmm-drop, 0em); --c-r: var(--gmm-r, 0px); --c-pill: var(--gmm-pill, 0px); }
.gmm-codex[data-skin="mallang"] { background: rgba(40, 28, 20, .45); }
.gmm-codex * { box-sizing: border-box; }
.gmm-codex .cx-sheet { position: relative; width: min(1100px, 94vw); height: min(780px, 90vh); display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: .7em;
  padding: 1em 1.1em 1.1em; border-radius: calc(var(--c-r) + 6px); color: var(--c-text); border: var(--c-bw) solid var(--c-line); border-top: 2px solid var(--c-accent);
  box-shadow: 0 var(--c-drop) 0 var(--c-line), 0 24px 60px -20px rgba(0, 0, 0, .8); background: var(--c-sheet); }
.gmm-codex[data-skin="mallang"] .cx-sheet { border-top: var(--c-bw) solid var(--c-line); box-shadow: 0 .4em 0 var(--c-line);
  background: radial-gradient(circle at 12px 12px, color-mix(in srgb, var(--c-pick) 30%, transparent) 3px, transparent 3.5px) 0 0 / 24px 24px, var(--c-card); }
.gmm-codex .cx-head { display: flex; align-items: center; gap: .7em; }
.gmm-codex .cx-head h2 { margin: 0; font-weight: 700; font-size: 1.5em; letter-spacing: .06em; padding: .05em .9em; border-radius: var(--c-pill); color: var(--c-on-accent); background: var(--c-accent); }
.gmm-codex[data-skin="mallang"] .cx-head h2 { font-weight: 400; font-size: 1.7em; letter-spacing: 0; border: 3px solid var(--c-line); box-shadow: 0 .14em 0 var(--c-line); }
.gmm-codex .cx-head .cx-sum { opacity: .75; }
.gmm-codex button { font: inherit; color: var(--c-text); cursor: pointer; }
.gmm-codex .cx-x { margin-left: auto; width: 2.2em; height: 2.2em; border-radius: 50%; font-size: 1.1em; background: var(--c-card); border: max(var(--c-bw), 1.5px) solid var(--c-line); box-shadow: 0 calc(var(--c-drop) * .47) 0 var(--c-line); }
.gmm-codex .cx-x:hover { border-color: var(--c-accent); }
.gmm-codex .cx-tabs { display: flex; gap: .45em; flex-wrap: wrap; }
.gmm-codex .cx-tabs button { padding: .25em .9em; border-radius: var(--c-pill); background: var(--c-card); border: 1px solid var(--c-line); border-bottom: 2px solid var(--c-edge); }
.gmm-codex .cx-tabs button:hover { border-color: var(--c-accent); }
.gmm-codex .cx-tabs button[aria-pressed="true"] { border-bottom-color: var(--c-accent); background: color-mix(in srgb, var(--c-accent) 22%, var(--c-card)); }
.gmm-codex[data-skin="mallang"] .cx-tabs button { border: 2px solid var(--c-line); box-shadow: 0 .14em 0 var(--c-line); }
.gmm-codex[data-skin="mallang"] .cx-tabs button[aria-pressed="true"] { background: var(--c-pick); }
.gmm-codex .cx-tabs button small { opacity: .7; margin-left: .3em; }
.gmm-codex .cx-body { min-height: 0; overflow: auto; padding: .3em .2em .6em; }
.gmm-codex .cx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: .8em; }
.gmm-codex .cx-grid.wide { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.gmm-codex .cx-item { display: flex; flex-direction: column; padding: 0; overflow: hidden; text-align: center;
  border-radius: var(--c-r); border: var(--c-bw) solid var(--c-line); border-top: 2px solid var(--c-edge); box-shadow: 0 calc(var(--c-drop) * .67) 0 var(--c-line);
  background: linear-gradient(170deg, var(--c-sky1), var(--c-sky2)); transition: translate 120ms ease, border-color 120ms ease; }
.gmm-codex[data-skin="mallang"] .cx-item { border: 2.5px solid var(--c-line); border-radius: 16px; }
.gmm-codex .cx-item:hover { translate: 0 -.15em; border-color: var(--c-accent); }
.gmm-codex .cx-item img { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: contain; object-position: 50% 100%; }
.gmm-codex .cx-grid.wide .cx-item img { aspect-ratio: 16 / 9; object-fit: cover; object-position: center; }
.gmm-codex .cx-item span { padding: .25em .4em .3em; background: var(--c-card); border-top: 1px solid var(--c-line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gmm-codex[data-skin="mallang"] .cx-item span { border-top: 2px solid var(--c-line); }
.gmm-codex .cx-item[data-r="5"] { border-color: #E0A100; } .gmm-codex .cx-item[data-r="4"] { border-color: #8E6BD6; }
.gmm-codex .cx-empty { padding: 2em 1em; text-align: center; opacity: .75; line-height: 1.6; white-space: pre-line; }
.gmm-codex .cx-view { position: absolute; inset: 0; z-index: 2; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: .6em; padding: 1em; border-radius: inherit; background: rgba(8, 10, 16, .9); }
.gmm-codex .cx-view img { width: 100%; height: 100%; object-fit: contain; }
.gmm-codex .cx-view .cx-bar { display: flex; align-items: center; justify-content: center; gap: .8em; color: #fff; }
.gmm-codex .cx-view button { padding: .25em 1em; border-radius: var(--c-pill); background: var(--c-card); border: 1px solid var(--c-line); }
.gmm-codex[data-skin="mallang"] .cx-view button { border: 2px solid var(--c-line); }
@media (max-width: 600px) { .gmm-codex .cx-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); } .gmm-codex .cx-head h2 { font-size: 1.3em; } }
`;

  const TABS = [
    ["enemies", "적", false], ["units", "캐릭터", false], ["outfits", "의상", false],
    ["story", "배경", true], ["battle", "전투 배경", true], ["cg", "CG", true], ["banner", "배너", true], ["bond", "인연 배경", true],
  ];
  let codex = null;
  // The codex sits outside .gf-arena, so it takes the arena's resolved --gmm-* tokens (the game's current style,
  // or 말랑 UI's colours when it is on) and matches the rest of the game.
  const THEME_TOKENS = ["font", "text", "card-hi", "line", "edge", "accent", "on-accent", "pick", "sky1", "sky2", "sheet", "bw", "drop", "r", "pill"];
  const mallangOn = () => host()?.getAttribute("data-gfx-style") === "trickcal";
  function themeVars(node) {
    node.dataset.skin = mallangOn() ? "mallang" : "game";
    const src = host()?.shadowRoot?.querySelector(".gf-arena");
    if (!src) return;
    const cs = getComputedStyle(src);
    for (const k of THEME_TOKENS) {
      const v = cs.getPropertyValue("--gmm-" + k).trim();
      if (v) node.style.setProperty("--gmm-" + k, v);
    }
  }
  async function loadCodex(id) {
    // enemies / battle stay null when the server patch is missing (the tabs then say so).
    const out = { enemies: null, units: [], outfits: [], story: [], battle: null, cg: [], banner: [], bond: [], error: "" };
    const [home, extra] = await Promise.allSettled([gf("/home-options", { runId: id }), gf("/more-money/codex", { runId: id })]);
    if (home.status === "fulfilled") {
      const d = home.value, bg = d.backgrounds || {};
      out.units = (d.units || []).filter((x) => x.url);
      out.outfits = (d.outfits || []).filter((x) => x.url).map((x) => ({ ...x, name: x.name + (x.kit ? " · " + x.kit : "") }));
      for (const k of ["story", "cg", "banner", "bond"]) out[k] = (bg[k] || []).filter((x) => x.url);
    } else out.error = "캐릭터 · 배경을 불러오지 못했어요 (" + home.reason.message + ").";
    if (extra.status === "fulfilled") { out.enemies = extra.value.enemies || []; out.battle = extra.value.battle || []; }
    else if (!unpatched(extra.reason)) out.error ||= "적 이미지를 불러오지 못했어요 (" + extra.reason.message + ").";
    return out;
  }
  function closeCodex() { codex?.node.remove(); codex = null; }
  // Inside the game's own element: full screen shows only that element, so a page on the document body was
  // hidden behind it. The game redraws its content now and then; paint() puts the page back if it was dropped.
  function mountCodex(node) {
    const root = host()?.shadowRoot;
    if (root) { ensureGameSheet(root); root.append(node); }
    else document.body.append(node);
  }
  async function openCodex() {
    closeCodex();
    const id = runId();
    const node = el("div", "gmm-codex");
    themeVars(node);
    const sheet = el("div", "cx-sheet");
    const head = el("div", "cx-head"), tabs = el("div", "cx-tabs"), body = el("div", "cx-body");
    const x = el("button", "cx-x", "✕"); x.type = "button"; x.setAttribute("aria-label", "닫기"); x.addEventListener("click", closeCodex);
    const sum = el("span", "cx-sum", "불러오는 중…");
    head.append(el("h2", "", "도감"), sum, x);
    sheet.append(head, tabs, body);
    node.append(sheet);
    node.addEventListener("click", (e) => { if (e.target === node) closeCodex(); });
    mountCodex(node);
    codex = { node, tab: "enemies", data: null, sheet, tabs, body, sum };
    if (!id) { body.append(el("div", "cx-empty", "세계를 연 뒤에 볼 수 있어요.")); sum.textContent = ""; return; }
    const data = await loadCodex(id);
    if (!codex || codex.node !== node) return;
    codex.data = data;
    if (!(data.enemies || []).length && data.units.length) codex.tab = "units";
    paintCodex();
  }
  function paintCodex() {
    const c = codex;
    if (!c || !c.data) return;
    const d = c.data;
    const total = TABS.reduce((s, [k]) => s + (d[k] || []).length, 0);
    c.sum.textContent = "모은 그림 " + fmt(total) + "장";
    c.tabs.replaceChildren(...TABS.map(([k, label]) => {
      const b = el("button", "", label); b.type = "button";
      b.append(el("small", "", d[k] == null ? "패치" : String(d[k].length)));
      b.setAttribute("aria-pressed", String(c.tab === k));
      b.addEventListener("click", () => { c.tab = k; paintCodex(); });
      return b;
    }));
    const [, , wide] = TABS.find(([k]) => k === c.tab);
    const list = d[c.tab];
    c.body.replaceChildren();
    if (d.error) c.body.append(el("div", "cx-empty", d.error));
    if (list == null) { c.body.append(el("div", "cx-empty", "적 · 전투 배경 그림은 서버 패치가 있어야 볼 수 있어요.\n이 확장 폴더의 patch/apply-patch.mjs를 실행하고 마리나라를 다시 켜 주세요.")); return; }
    if (!list.length) { c.body.append(el("div", "cx-empty", "아직 모은 그림이 없어요.\n게임을 진행하면 그려진 그림이 여기에 모여요.")); return; }
    const grid = el("div", "cx-grid" + (wide ? " wide" : ""));
    list.forEach((item, i) => {
      const b = el("button", "cx-item"); b.type = "button";
      if (item.rarity) b.dataset.r = String(item.rarity);
      const img = el("img"); img.loading = "lazy"; img.alt = ""; img.src = item.url;
      b.append(img, el("span", "", item.name || "이름 없음"));
      b.addEventListener("click", () => view(list, i));
      grid.append(b);
    });
    c.body.append(grid);
  }
  function view(list, at) {
    const c = codex;
    if (!c) return;
    c.sheet.querySelector(":scope > .cx-view")?.remove();
    const v = el("div", "cx-view"), img = el("img"), bar = el("div", "cx-bar"), name = el("span");
    const show = (i) => { at = (i + list.length) % list.length; img.src = list[at].url; name.textContent = (list[at].name || "이름 없음") + "  (" + (at + 1) + " / " + list.length + ")"; };
    const btn = (t, fn) => { const b = el("button", "", t); b.type = "button"; b.addEventListener("click", (e) => { e.stopPropagation(); fn(); }); return b; };
    bar.append(btn("◀", () => show(at - 1)), name, btn("▶", () => show(at + 1)), btn("닫기", () => v.remove()));
    v.append(img, bar);
    v.addEventListener("click", (e) => { if (e.target === v || e.target === img) v.remove(); });
    c.sheet.append(v);
    show(at);
  }
  const onKey = (e) => {
    if (ask && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAsk(); return; }
    if (!codex) return;
    const v = codex.sheet.querySelector(":scope > .cx-view");
    if (e.key === "Escape") { e.preventDefault(); if (v) v.remove(); else closeCodex(); }
    else if (v && (e.key === "ArrowLeft" || e.key === "ArrowRight")) v.querySelector(e.key === "ArrowLeft" ? ".cx-bar button:first-child" : ".cx-bar button:nth-child(3)")?.click();
  };
  document.addEventListener("keydown", onKey, true);
  cleanups.push(() => document.removeEventListener("keydown", onKey, true), closeCodex, closeAsk);

  /* ═════════════ Watching the game ═════════════ */
  let queued = false, observed = null, observer = null;
  function schedule() {
    if (queued || disposed) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paint(); });
  }
  function paint() {
    const root = host()?.shadowRoot;
    if (!root) return;
    if (observed !== root) {
      observer?.disconnect();
      observer = new MutationObserver(schedule);
      observer.observe(root, { childList: true, subtree: true });
      observed = root;
    }
    ensureGameSheet(root);
    if (codex && !codex.node.isConnected) mountCodex(codex.node);
    paintShop(root);
    paintSummon(root);
    paintCodexButton(root);
    copySheetForLeave(root);
  }
  // On a screen change the game flies a copy of the old screen out, styled only by the <style> tags inside it.
  // A tag of our own inside our first element there keeps the copy styled (in the live screen it repeats rules).
  function copySheetForLeave(root) {
    const view = root.querySelector(".gf-stage > .gf-view");
    const mine = view?.querySelector(".gmm-pane, .gmm-cat, .gmm-tile, .gmm-codex-btn");
    if (!mine || view.querySelector("style[data-gmm]")) return;
    const tag = document.createElement("style");
    tag.dataset.gmm = "";
    tag.textContent = GAME_CSS;
    mine.prepend(tag);
  }
  // The game's element comes and goes with the Home tab; look for it now and then.
  const poll = setInterval(() => { if (host()?.shadowRoot !== observed) schedule(); }, 1000);
  schedule();

  window[KEY] = () => {
    disposed = true;
    clearInterval(poll);
    observer?.disconnect();
    for (const fn of cleanups) { try { fn(); } catch {} }
    const root = host()?.shadowRoot;
    if (root) {
      for (const n of root.querySelectorAll(".gmm-cat, .gmm-pane, .gmm-codex-btn, .gmm-cur, .gmm-ask, .gmm-tile")) n.remove();
      for (const n of root.querySelectorAll(".gmm-open")) n.classList.remove("gmm-open");
      if (gameSheet) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== gameSheet);
    }
    delete window[KEY];
  };
})();
