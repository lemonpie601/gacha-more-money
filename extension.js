/* Gacha More Money v1.0.0 — personal extension for Gacha Forge 1.8.13 on Marinara Engine.
 *  - 상점 → 충전소: 에테르 · 자금 팩을 "결제"(진짜 돈은 나가지 않음)해 지갑에 넣습니다. 하루 3번.
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

  /* ═════════════ Packs (keep in sync with patch/apply-patch.mjs PACKS) ═════════════ */
  const PACKS = [
    { id: "aether-s", name: "에테르 한 줌", icon: "✦", grant: "에테르 1,600", note: "10회 소환", price: "₩33,000", tone: "aether" },
    { id: "aether-l", name: "에테르 상자", icon: "✦", grant: "에테르 4,800", note: "30회 소환", price: "₩99,000", tone: "aether", best: true },
    { id: "funds", name: "자금 자루", icon: "◎", grant: "자금 100,000", note: "강화 · 승급용", price: "₩11,000", tone: "funds" },
  ];
  const DAILY = 3;

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
.gmm-pack[data-best]::before { content: "인기!"; position: absolute; top: -.75em; right: .8em; padding: .05em .7em; border-radius: 999px; background: #FF6F91; color: #fff;
  border: 2px solid var(--gfx-line, #6B4528); font-size: calc(var(--f, 10px) * .85); rotate: 6deg; }
.gmm-pack .gmm-ic { display: grid; place-items: center; width: 2.6em; height: 2.6em; border-radius: 50%; font-size: calc(var(--f, 10px) * 2); color: #fff;
  border: 3px solid var(--gfx-line, #6B4528); box-shadow: 0 .14em 0 var(--gfx-line, #6B4528), inset 0 -.25em 0 rgba(0,0,0,.12); }
.gmm-pack[data-tone="aether"] .gmm-ic { background: radial-gradient(circle at 35% 30%, #D9C8FF, #8C6CF0); }
.gmm-pack[data-tone="funds"] .gmm-ic { background: radial-gradient(circle at 35% 30%, #FFE9A8, #F2B600); }
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
.gmm-codex-btn:active { translate: 0 .12em; box-shadow: 0 .06em 0 var(--gfx-line, #6B4528); }
.gfx-lobby[data-edit] > .gmm-codex-btn { display: none; }
`;
  let gameSheet = null;
  function ensureGameSheet(root) {
    if (!gameSheet) { gameSheet = new CSSStyleSheet(); gameSheet.replaceSync(GAME_CSS); }
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
    for (const other of rail.querySelectorAll(":scope > .sh-cat:not(.gmm-cat)")) if (shopOpen && other.classList.contains("on")) { other.classList.remove("on"); other.dataset.gmmWasOn = "1"; }
    pane.classList.toggle("gmm-open", shopOpen);
    let mine = pane.querySelector(":scope > .gmm-pane");
    if (!shopOpen) { mine?.remove(); return; }
    const key = JSON.stringify([left, buying, confirming, patchMissing, lastNote]);
    if (mine && mine.dataset.key === key) return;
    mine?.remove();
    mine = el("div", "gmm-pane"); mine.dataset.key = key;
    const top = el("div", "gmm-top");
    const leftTag = el("span", "gmm-left"); leftTag.append("오늘 남은 충전 ", el("b", "", left == null ? "?" : String(left)), " / " + DAILY);
    top.append(el("span", "gmm-title", "충전소"), leftTag);
    mine.append(top);
    if (patchMissing) mine.append(el("div", "gmm-msg", "충전하려면 서버 패치가 필요해요.\n마리나라를 끄고, 이 확장 폴더의 patch/apply-patch.mjs를 실행한 뒤 다시 켜 주세요.\n(자세한 방법은 README 참고)"));
    if (lastNote) mine.append(el("div", "gmm-msg", lastNote));
    const grid = el("div", "gmm-grid");
    for (const p of PACKS) {
      const card = el("div", "gmm-pack"); card.dataset.tone = p.tone; if (p.best) card.dataset.best = "";
      const b = el("button", "", buying === p.id ? "결제 중…" : confirming === p.id ? p.price + " 결제할까요?" : p.price); b.type = "button";
      if (confirming === p.id) b.dataset.ask = "";
      b.disabled = !!buying || patchMissing || left === 0;
      b.addEventListener("click", (e) => { e.stopPropagation(); buy(p); });
      card.append(el("span", "gmm-ic", p.icon), el("span", "gmm-nm", p.name), el("span", "gmm-gr", p.grant), el("span", "gmm-nt", p.note), b);
      grid.append(card);
    }
    mine.append(grid, el("div", "gmm-fine", "놀이용 가상 결제예요. 실제 돈은 나가지 않으며, 충전 횟수는 서버 날짜 기준으로 매일 초기화돼요."));
    pane.append(mine);
  }

  /* ═════════════ Lobby: [도감] button ═════════════ */
  function paintCodexButton(root) {
    const home = root.querySelector(".hm-screen");
    const old = root.querySelector(".gmm-codex-btn");
    if (!home) { old?.remove(); return; }
    // Under 말랑 UI's [✥ 배치] when its lobby is there; otherwise at the same spot on the home screen.
    const lobby = home.querySelector(".gfx-lobby");
    const parent = lobby && lobby.querySelector(":scope > .gfx-lobby-tools") ? lobby : home;
    if (old && old.parentElement === parent) return;
    old?.remove();
    const b = el("button", "gmm-codex-btn", "📖 도감"); b.type = "button";
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
  const pageStyle = el("style"); pageStyle.textContent = PAGE_CSS; document.head.append(pageStyle);
  cleanups.push(() => pageStyle.remove());

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
    document.body.append(node);
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
    paintShop(root);
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
      for (const n of root.querySelectorAll(".gmm-cat, .gmm-pane, .gmm-codex-btn")) n.remove();
      for (const n of root.querySelectorAll(".gmm-open")) n.classList.remove("gmm-open");
      if (gameSheet) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== gameSheet);
    }
    delete window[KEY];
  };
})();
