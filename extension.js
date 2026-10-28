/* Gacha More Money v1.2.0 — personal extension for Gacha Forge 1.8.13 on Marinara Engine.
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
  // Tickets for aether, as often as you like: one summon still costs what it did (160 aether).
  const EXCHANGE = [
    { id: "std-1", ticket: "std", qty: 1, cost: 160 }, { id: "std-10", ticket: "std", qty: 10, cost: 1600 },
    { id: "ltd-1", ticket: "ltd", qty: 1, cost: 160 }, { id: "ltd-10", ticket: "ltd", qty: 10, cost: 1600 },
  ];

  /* ═════════════ Icons ═════════════
   * Small drawings in a 48×48 box, outlined in the theme's line colour (class "ln") with a white shine ("hi"). */
  const star4 = (x, y, r, w = r * 0.28) => `M${x} ${y - r}Q${x + w} ${y - w} ${x + r} ${y}Q${x + w} ${y + w} ${x} ${y + r}Q${x - w} ${y + w} ${x - r} ${y}Q${x - w} ${y - w} ${x} ${y - r}Z`;
  const ticket = (body, deep, emblem) => '<g transform="rotate(-10 24 24)">'
    + '<path class="ln" fill="' + body + '" d="M8 13h32a3 3 0 0 1 3 3v4.6a3.4 3.4 0 0 0 0 6.8V32a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4.6a3.4 3.4 0 0 0 0-6.8V16a3 3 0 0 1 3-3z"/>'
    + '<path fill="' + deep + '" d="M8 30.5h32a1.5 1.5 0 0 1 1.5 1.5v.2a1.3 1.3 0 0 1-1.3 1.3H7.8a1.3 1.3 0 0 1-1.3-1.3V32A1.5 1.5 0 0 1 8 30.5z"/>'
    + '<rect class="hi" x="9" y="15.5" width="20" height="2.6" rx="1.3"/>'
    + '<path d="M16 17v13" stroke="' + deep + '" stroke-width="1.8" stroke-dasharray="2 2.4" stroke-linecap="round"/>'
    + emblem + '</g>';
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
    std: ticket("#4FC3F7", "#1E8FD0", '<path class="ln" stroke-width="1.8" fill="#FFF6C8" d="' + star4(29.5, 22.5, 7) + '"/>' + twinkle(37, 16.5, 2.4)),
    ltd: ticket("#E0476E", "#A82648", '<path class="ln" stroke-width="1.8" fill="#FFE8A3" d="M32.5 15.6a7.2 7.2 0 1 0 0 13.8a5.8 5.8 0 1 1 0-13.8z"/>' + twinkle(37.5, 18, 2.4)),
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
    gift: '<path class="ln" fill="#FF8FB1" d="M9 22h30v16a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z"/><rect class="ln" fill="#FFB3C9" x="6" y="15" width="36" height="8" rx="2"/>'
      + '<path class="ln" fill="#FFE17A" d="M21 15h6v26h-6z"/><path class="ln" fill="#FFE17A" d="M24 15c-3-6-10-7-10-2.5S20 15 24 15zM24 15c3-6 10-7 10-2.5S28 15 24 15z"/>'
      + '<rect class="hi" x="9" y="17" width="9" height="2.2" rx="1.1"/>',
  };
  function icon(kind) {
    const n = el("span", "gmm-ic");
    n.innerHTML = '<svg class="gmm-svg" viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">' + (ICONS[kind] || "") + "</svg>";
    return n;
  }

  /* ═════════════ Styles inside the game (the shop) ═════════════ */
  const GAME_CSS = `
.gmm-cat { position: relative; }
.gmm-cat .sh-cat-nm::after { content: "NEW"; margin-left: .4em; font-size: .62em; padding: .05em .45em; border-radius: 999px; background: #FF6F91; color: #fff; vertical-align: middle; }
.sh-pane.gmm-open > :not(.gmm-pane) { display: none !important; }
.gmm-pane { display: flex; flex-direction: column; gap: .8em; min-height: 0; height: 100%; overflow: auto; padding: .4em .2em .8em; box-sizing: border-box;
  font-family: "Jua", var(--display, inherit), sans-serif; color: var(--gfx-text, var(--on-surface, #4A3020)); }
.gmm-pane .gmm-top { display: flex; align-items: center; justify-content: space-between; gap: .6em; flex-wrap: wrap; }
.gmm-pane .gmm-title { font-size: calc(var(--f, 10px) * 1.6); }
.gmm-pane .gmm-left { padding: .2em .9em; border-radius: 999px; background: var(--gfx-card, #FFFDF5); border: 2px solid var(--gfx-line, #6B4528);
  box-shadow: 0 .14em 0 var(--gfx-line, #6B4528); font-size: calc(var(--f, 10px) * 1.05); }
.gmm-pane .gmm-left b { color: var(--gfx-accent, #F0763A); }
.gmm-pane .gmm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--f, 10px) * 15), 1fr)); gap: .9em; }
.gmm-pack { position: relative; display: flex; flex-direction: column; align-items: center; gap: .35em; padding: 1em .8em .9em; border-radius: 20px;
  background: var(--gfx-card, #FFFDF5); border: 3px solid var(--gfx-line, #6B4528); box-shadow: 0 .3em 0 var(--gfx-line, #6B4528); text-align: center; }
.gmm-pack[data-best]::before { content: attr(data-best); position: absolute; top: -.75em; right: .8em; padding: .05em .7em; border-radius: 999px; background: #FF6F91; color: #fff;
  border: 2px solid var(--gfx-line, #6B4528); font-size: calc(var(--f, 10px) * .85); rotate: 6deg; }
.gmm-pack .gmm-ic { display: block; width: calc(var(--f, 10px) * 5.2); height: calc(var(--f, 10px) * 5.2); }
.gmm-pane h3 { margin: .4em 0 0; font-weight: 400; font-size: calc(var(--f, 10px) * 1.25); display: flex; align-items: baseline; gap: .5em; flex-wrap: wrap; }
.gmm-pane h3 small { font-size: .7em; opacity: .7; }
.gmm-pane .gmm-xgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--f, 10px) * 20), 1fr)); gap: .8em; }
.gmm-x { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .5em .6em; padding: .55em .8em; border-radius: 18px;
  background: var(--gfx-card, #FFFDF5); border: 3px solid var(--gfx-line, #6B4528); box-shadow: 0 .24em 0 var(--gfx-line, #6B4528); }
.gmm-x .gmm-ic { display: block; width: calc(var(--f, 10px) * 3.4); height: calc(var(--f, 10px) * 3.4); }
.gmm-tile .art .gmm-ic { display: block; width: 100%; aspect-ratio: 1; }
.gmm-tix .gmm-ic { display: block; width: 2.2em; height: 2.2em; margin: -.35em 0; }
/* Drawn icons: outlined like the rest of 말랑 UI, a sticker shadow under them. */
.gmm-svg { overflow: visible; filter: drop-shadow(0 .1em 0 color-mix(in srgb, var(--gfx-line, #6B4528) 45%, transparent)); }
.gmm-svg .ln { stroke: var(--gfx-line, #6B4528); stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
.gmm-svg .hi { fill: #fff; opacity: .55; }
.gmm-x .gmm-nm { display: flex; flex-direction: column; line-height: 1.25; white-space: nowrap; min-width: 0; font-size: calc(var(--f, 10px) * 1.1); }
.gmm-x .gmm-nm small { font-size: .78em; opacity: .7; }
.gmm-x .gmm-have { font-size: calc(var(--f, 10px) * .9); opacity: .85; white-space: nowrap; }
.gmm-x .gmm-buys { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: .4em; }
.gmm-x button, .gmm-tix button { cursor: pointer; font: inherit; white-space: nowrap; padding: .25em .7em; border-radius: 999px; color: #fff; background: linear-gradient(180deg, #A98CF5, #7B5BE0);
  border: 2.5px solid var(--gfx-line, #6B4528); box-shadow: 0 .16em 0 var(--gfx-line, #6B4528); }
.gmm-x button:active:not(:disabled), .gmm-tix button:active:not(:disabled) { translate: 0 .12em; box-shadow: 0 .04em 0 var(--gfx-line, #6B4528); }
.gmm-x button:disabled, .gmm-tix button:disabled { filter: grayscale(.8); opacity: .6; cursor: default; }
/* The summon screen: tickets held for this banner, and buying more right there. */
.gmm-tix { display: flex; align-items: center; justify-content: center; gap: .5em; flex-wrap: wrap; margin: .2em 0 .5em; font-family: "Jua", var(--display, inherit), sans-serif;
  color: var(--gfx-text, var(--on-surface, #4A3020)); }
.gmm-tix .gmm-hold { display: inline-flex; align-items: center; gap: .45em; padding: .2em .9em .2em .25em; border-radius: 999px; background: var(--gfx-card, #FFFDF5);
  border: 2.5px solid var(--gfx-line, #6B4528); box-shadow: 0 .16em 0 var(--gfx-line, #6B4528); }
.gmm-tix .gmm-hold b { color: var(--gfx-accent, #F0763A); }
.gmm-tix .gmm-note { width: 100%; text-align: center; font-size: .85em; opacity: .85; }
.gmm-pack .gmm-nm { font-size: calc(var(--f, 10px) * 1.25); }
.gmm-pack .gmm-gr { font-size: calc(var(--f, 10px) * 1.05); color: var(--gfx-accent, #F0763A); }
.gmm-pack .gmm-nt { font-size: calc(var(--f, 10px) * .8); opacity: .75; }
.gmm-pack button { margin-top: .3em; width: 100%; cursor: pointer; font: inherit; font-size: calc(var(--f, 10px) * 1.15); padding: .35em .6em; border-radius: 999px;
  color: #5A3A10; background: linear-gradient(180deg, #FFE27A, #FFC93C); border: 2.5px solid var(--gfx-line, #6B4528); box-shadow: 0 .2em 0 var(--gfx-line, #6B4528); }
.gmm-pack button:active:not(:disabled) { translate: 0 .15em; box-shadow: 0 .05em 0 var(--gfx-line, #6B4528); }
.gmm-pack button[data-ask] { background: linear-gradient(180deg, #FF9BB5, #FF6F91); color: #fff; animation: gmm-ask .5s ease-in-out infinite alternate; }
@keyframes gmm-ask { to { scale: 1.04; } }
.gmm-pack button:disabled { filter: grayscale(.8); opacity: .65; cursor: default; }
.gmm-pane .gmm-msg { padding: .7em 1em; border-radius: 16px; background: color-mix(in srgb, var(--gfx-pick, #FFE17A) 35%, var(--gfx-card, #FFFDF5));
  border: 2px dashed var(--gfx-line, #6B4528); line-height: 1.5; font-size: calc(var(--f, 10px) * .95); white-space: pre-line; }
.gmm-pane .gmm-fine { font-size: calc(var(--f, 10px) * .78); opacity: .7; text-align: center; }
/* The codex button under the lobby's [✥ 배치] (말랑 UI), or alone on the home screen without it. */
.gmm-codex-btn { position: absolute; left: 1.6%; top: calc(10.5% + var(--f, 10px) * 2.6); z-index: 500; pointer-events: auto; cursor: pointer;
  font-family: "Jua", "Malgun Gothic", sans-serif; font-size: calc(var(--f, 10px) * .95); padding: .3em .9em; border-radius: 999px;
  color: var(--gfx-text, #4A3020); background: var(--gfx-card, #FFFDF5); border: 2px solid var(--gfx-line, #6B4528); box-shadow: 0 .18em 0 var(--gfx-line, #6B4528); }
.gmm-codex-btn { display: inline-flex; align-items: center; gap: .3em; }
.gmm-codex-btn .gmm-ic-book { width: 1.15em; height: 1.15em; flex: none; }
.gmm-codex-btn:active { translate: 0 .12em; box-shadow: 0 .06em 0 var(--gfx-line, #6B4528); }
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
    for (const other of rail.querySelectorAll(":scope > .sh-cat:not(.gmm-cat)")) if (shopOpen && other.classList.contains("on")) other.classList.remove("on");
    pane.classList.toggle("gmm-open", shopOpen);
    let mine = pane.querySelector(":scope > .gmm-pane");
    if (!shopOpen) { mine?.remove(); paintKeyItems(rail, pane); return; }
    const key = JSON.stringify([left, buying, confirming, patchMissing, lastNote, status && status.tickets, aether()]);
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
   * The game still draws its aether price and greys its buttons by aether; here the price reads in tickets and
   * the buttons follow the tickets held (the game reads aria-disabled when pressed). */
  let summonSeen = false;
  function paintSummon(root) {
    const screen = root.querySelector('[data-screen="banner"]');
    const pulls = screen?.querySelector(".pulls");
    if (!pulls) { if (summonSeen) { summonSeen = false; loadStatus(true); } return; }
    if (!summonSeen) { summonSeen = true; loadStatus(true); }
    if (patchMissing || !status) { pulls.previousElementSibling?.classList.contains("gmm-tix") && pulls.previousElementSibling.remove(); return; }
    const bannerId = String(host()?._summonBannerId || "char-featured");
    const t = bannerId.split("-")[1] === "standard" ? "std" : "ltd", tk = TICKETS[t], have = held(t) ?? 0;
    for (const b of pulls.querySelectorAll("[data-pull]")) {
      const n = Number(b.dataset.pull) === 10 ? 10 : 1;
      const cost = b.querySelector(".cost"), label = tk.name + " ×" + n + (n === 10 ? " · 4★ 이상 1회 보장" : "");
      if (cost && cost.textContent !== label) cost.textContent = label;
      const off = have < n ? "true" : null;
      if (b.getAttribute("aria-disabled") !== off) { if (off) b.setAttribute("aria-disabled", off); else b.removeAttribute("aria-disabled"); }
      if (!b.dataset.gmmWatch) {
        b.dataset.gmmWatch = "1";
        // After a pull the server has taken the tickets; read the count again once the results are in.
        b.addEventListener("click", () => { if (b.getAttribute("aria-disabled") !== "true") setTimeout(() => loadStatus(true), 1500); });
      }
    }
    let tix = pulls.previousElementSibling?.classList.contains("gmm-tix") ? pulls.previousElementSibling : null;
    const key = JSON.stringify([t, have, buying, aether(), lastNote]);
    if (tix && tix.dataset.key === key) return;
    tix?.remove();
    tix = el("div", "gmm-tix"); tix.dataset.key = key;
    const hold = el("span", "gmm-hold"); hold.dataset.tone = tk.tone;
    hold.append(icon(t), tk.name + " ", el("b", "", fmt(have)), "장");
    tix.append(hold);
    const a = aether();
    for (const x of EXCHANGE.filter((x) => x.ticket === t)) {
      const b = el("button", "", buying === x.id ? "교환 중…" : "+" + x.qty + "장 · ✦" + fmt(x.cost)); b.type = "button";
      b.disabled = !!buying || (a != null && a < x.cost);
      b.addEventListener("click", (e) => { e.stopPropagation(); exchange(x); });
      tix.append(b);
    }
    if (have < 1) tix.append(el("span", "gmm-note", "이 배너는 " + tk.name + "(" + tk.kind + ")으로 소환해요. 에테르로 바꾸거나 충전소에서 구할 수 있어요."));
    pulls.before(tix);
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
.gmm-codex { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; background: rgba(40, 28, 20, .45); backdrop-filter: blur(3px);
  font-family: "Jua", "Malgun Gothic", sans-serif; --c-card: #FFFDF5; --c-text: #4A3020; --c-line: #6B4528; --c-accent: #F0763A; --c-pick: #FFE17A; --c-sky1: #FFE08A; --c-sky2: #BDE9DA; }
.gmm-codex * { box-sizing: border-box; }
.gmm-codex .cx-sheet { position: relative; width: min(1100px, 94vw); height: min(780px, 90vh); display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: .7em;
  padding: 1em 1.1em 1.1em; border-radius: 26px; color: var(--c-text); border: 3px solid var(--c-line); box-shadow: 0 .4em 0 var(--c-line);
  background: radial-gradient(circle at 12px 12px, color-mix(in srgb, var(--c-pick) 30%, transparent) 3px, transparent 3.5px) 0 0 / 24px 24px, var(--c-card); }
.gmm-codex .cx-head { display: flex; align-items: center; gap: .7em; }
.gmm-codex .cx-head h2 { margin: 0; font-weight: 400; font-size: 1.7em; padding: .05em .9em; border-radius: 999px; color: #fff; background: var(--c-accent); border: 3px solid var(--c-line); box-shadow: 0 .14em 0 var(--c-line); }
.gmm-codex .cx-head .cx-sum { opacity: .75; }
.gmm-codex .cx-x { margin-left: auto; width: 2.2em; height: 2.2em; border-radius: 50%; cursor: pointer; font: inherit; font-size: 1.1em; color: var(--c-text); background: var(--c-card); border: 2.5px solid var(--c-line); box-shadow: 0 .14em 0 var(--c-line); }
.gmm-codex .cx-tabs { display: flex; gap: .45em; flex-wrap: wrap; }
.gmm-codex .cx-tabs button { cursor: pointer; font: inherit; padding: .25em .9em; border-radius: 999px; color: var(--c-text); background: var(--c-card); border: 2px solid var(--c-line); box-shadow: 0 .14em 0 var(--c-line); }
.gmm-codex .cx-tabs button[aria-pressed="true"] { background: var(--c-pick); }
.gmm-codex .cx-tabs button small { opacity: .7; margin-left: .3em; }
.gmm-codex .cx-body { min-height: 0; overflow: auto; padding: .3em .2em .6em; }
.gmm-codex .cx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: .8em; }
.gmm-codex .cx-grid.wide { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.gmm-codex .cx-item { cursor: pointer; display: flex; flex-direction: column; padding: 0; overflow: hidden; font: inherit; color: var(--c-text); text-align: center;
  border-radius: 16px; border: 2.5px solid var(--c-line); box-shadow: 0 .2em 0 var(--c-line); background: linear-gradient(170deg, var(--c-sky1), var(--c-sky2)); transition: translate 120ms ease; }
.gmm-codex .cx-item:hover { translate: 0 -.15em; }
.gmm-codex .cx-item img { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: contain; object-position: 50% 100%; }
.gmm-codex .cx-grid.wide .cx-item img { aspect-ratio: 16 / 9; object-fit: cover; object-position: center; }
.gmm-codex .cx-item span { padding: .25em .4em .3em; background: var(--c-card); border-top: 2px solid var(--c-line); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gmm-codex .cx-item[data-r="5"] { border-color: #E0A100; } .gmm-codex .cx-item[data-r="4"] { border-color: #8E6BD6; }
.gmm-codex .cx-empty { padding: 2em 1em; text-align: center; opacity: .75; line-height: 1.6; white-space: pre-line; }
.gmm-codex .cx-view { position: absolute; inset: 0; z-index: 2; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: .6em; padding: 1em; border-radius: 23px; background: rgba(30, 22, 16, .88); }
.gmm-codex .cx-view img { width: 100%; height: 100%; object-fit: contain; }
.gmm-codex .cx-view .cx-bar { display: flex; align-items: center; justify-content: center; gap: .8em; color: #fff; }
.gmm-codex .cx-view button { cursor: pointer; font: inherit; padding: .25em 1em; border-radius: 999px; color: var(--c-text); background: var(--c-card); border: 2px solid var(--c-line); }
@media (max-width: 600px) { .gmm-codex .cx-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); } .gmm-codex .cx-head h2 { font-size: 1.3em; } }
`;

  const TABS = [
    ["enemies", "적", false], ["units", "캐릭터", false], ["outfits", "의상", false],
    ["story", "배경", true], ["battle", "전투 배경", true], ["cg", "CG", true], ["banner", "배너", true], ["bond", "인연 배경", true],
  ];
  let codex = null;
  // Take 말랑 UI's colours when it is on, so the codex matches the rest of the game.
  function themeVars(node) {
    const src = host()?.shadowRoot?.querySelector(".gf-arena") || host();
    if (!src) return;
    const cs = getComputedStyle(src);
    for (const [from, to] of [["--gfx-card", "--c-card"], ["--gfx-text", "--c-text"], ["--gfx-line", "--c-line"], ["--gfx-accent", "--c-accent"], ["--gfx-pick", "--c-pick"], ["--gfx-sky1", "--c-sky1"], ["--gfx-sky2", "--c-sky2"]]) {
      const v = cs.getPropertyValue(from).trim();
      if (v) node.style.setProperty(to, v);
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
    if (!codex) return;
    const v = codex.sheet.querySelector(":scope > .cx-view");
    if (e.key === "Escape") { e.preventDefault(); if (v) v.remove(); else closeCodex(); }
    else if (v && (e.key === "ArrowLeft" || e.key === "ArrowRight")) v.querySelector(e.key === "ArrowLeft" ? ".cx-bar button:first-child" : ".cx-bar button:nth-child(3)")?.click();
  };
  document.addEventListener("keydown", onKey, true);
  cleanups.push(() => document.removeEventListener("keydown", onKey, true), closeCodex);

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
      for (const n of root.querySelectorAll(".gmm-cat, .gmm-pane, .gmm-codex-btn, .gmm-tix, .gmm-tile")) n.remove();
      for (const n of root.querySelectorAll(".gmm-open")) n.classList.remove("gmm-open");
      if (gameSheet) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== gameSheet);
    }
    delete window[KEY];
  };
})();
