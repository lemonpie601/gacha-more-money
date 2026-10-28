#!/usr/bin/env node
/* Gacha More Money · 가챠 포지 서버 패치
 *
 * 가챠 포지(gacha-forge) 패키지의 server.mjs에 세 가지 요청을 덧붙입니다.
 *   POST /api/gacha-forge/more-money/status  오늘 남은 충전 횟수
 *   POST /api/gacha-forge/more-money/topup     충전(하루 3번): 에테르 · 자금 · 활력 · 반짝이 · 소환권을 지갑에 넣음
 *   POST /api/gacha-forge/more-money/exchange  에테르로 소환권 사기
 *   POST /api/gacha-forge/more-money/codex     도감용 적 이미지 · 전투 배경 · 세계의 모든 캐릭터 · 의상(미획득 포함) 목록
 *   POST /api/gacha-forge/more-money/pass/buy    주간 패스 구매(7일): 바로 받는 보상
 *   POST /api/gacha-forge/more-money/pass/claim  주간 패스 오늘 보상(하루 한 번, 7일 동안)
 * 그리고 소환이 에테르 대신 소환권을 씁니다: 상시 배너는 「성휘」(상시 소환권), 한정 배너는 「월휘」(한정 소환권).
 * 마리나라는 설치된 패키지 파일의 해시를 검사하므로, 파일과 함께 설치 기록(installed.json)의 해시도 고칩니다.
 *
 * 사용법 (마리나라를 끈 상태에서):
 *   node apply-patch.mjs [마리나라 data 폴더]        패치 적용 (다시 실행해도 한 번만 들어감)
 *   node apply-patch.mjs --restore [data 폴더]      패치 제거
 * data 폴더를 생략하면 DATA_DIR 환경 변수, ./packages/server/data, ./data, . 순서로 찾습니다.
 * 가챠 포지를 업데이트하면 패치가 사라지므로 다시 실행하세요. */
import { readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const PACKAGE_ID = "gacha-forge";
const HEAD = "/*gacha-more-money:head*/";
const START = "/*gacha-more-money:start*/";
const END = "/*gacha-more-money:end*/";
// The summon's aether payment is replaced in place; the original text rides along (base64) so --restore and
// a re-run can put it back exactly.
const SWAP = /\/\*gacha-more-money:swap:([A-Za-z0-9+/=]*)\*\/[\s\S]*?\/\*gacha-more-money:swapend\*\//g;

// What each pack puts in the wallet (one summon used to cost 160 aether). Keep in sync with extension.js PACKS.
// gmmTicketStd / gmmTicketLtd: standard and limited summon tickets, kept in the wallet beside aether.
const PACKS = {
  "aether-s": { aether: 1600 },
  "aether-m": { aether: 4800 },
  "aether-l": { aether: 9600 },
  "funds-s": { funds: 100000 },
  "funds-l": { funds: 300000 },
  "vigor": { vigor: 60 },
  "glimmer": { glimmer: 300 },
  "ticket-std": { gmmTicketStd: 10 },
  "ticket-ltd": { gmmTicketLtd: 10 },
  "starter": { aether: 1600, funds: 50000, gmmTicketLtd: 1 },
};
const DAILY = 3;
// The weekly pass: bought once (again only after it ends), a gift at once, then a reward every day for 7 days
// (the day it is bought counts as day 1). Days follow the Marinara server computer's local date.
const PASS = { days: 7, buy: { gmmTicketLtd: 3 }, daily: { aether: 300, gmmTicketStd: 1 } };
// Buying tickets with aether (any number of times): what it costs and what it gives.
const EXCHANGE = {
  "std-1": { cost: 160, give: { gmmTicketStd: 1 } },
  "std-10": { cost: 1600, give: { gmmTicketStd: 10 } },
  "ltd-1": { cost: 160, give: { gmmTicketLtd: 1 } },
  "ltd-10": { cost: 1600, give: { gmmTicketLtd: 10 } },
};

const args = process.argv.slice(2);
const restore = args.includes("--restore");
const given = args.find((a) => !a.startsWith("--"));

function findDataDir() {
  const candidates = [given, process.env.DATA_DIR, "packages/server/data", "data", "."].filter(Boolean).map((p) => resolve(p));
  for (const dir of candidates) if (existsSync(join(dir, "capability-packages", "installed.json"))) return dir;
  throw new Error("마리나라 data 폴더를 찾지 못했습니다. 경로를 직접 적어 주세요. 예: node apply-patch.mjs C:\\Marinara-Engine\\packages\\server\\data\n찾아본 곳: " + candidates.join(", "));
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function strip(src) {
  let out = src.replace(SWAP, (_, b64) => Buffer.from(b64, "base64").toString("utf8"));
  const h = out.indexOf(HEAD);
  if (h >= 0) { const e = out.indexOf(HEAD, h + HEAD.length); if (e < 0) throw new Error("머리 표식이 깨져 있습니다."); out = out.slice(0, h) + out.slice(e + HEAD.length); }
  const s = out.indexOf(START);
  if (s >= 0) { const e = out.indexOf(END, s); if (e < 0) throw new Error("패치 표식이 깨져 있습니다."); out = out.slice(0, s) + out.slice(e + END.length); }
  return out;
}

// The game's code is minified and its names change between versions, so they are read off the shop's own
// purchase handler (the same steps: check the run, lock it, read it, change the wallet, write it back).
function inject(src) {
  const need = (re, text, what) => { const m = re.exec(text); if (!m) throw new Error("이 가챠 포지 버전에서 " + what + "을(를) 찾지 못했습니다. 패치를 업데이트해야 합니다."); return m; };
  const shop = need(/(\w+)\.post\("\/shop\/buy",async (\w+)=>\{let (\w+)=\2&&\2\.body\|\|\{\},\w+=(\w+)\(\3\.runId\)/, src, "상점 구매 처리");
  const [, router, , , str] = shop;
  const seg = src.slice(shop.index, shop.index + 2000);
  const [, readIndex, hasRun] = need(/let\{data:\w+\}=await (\w+)\(\);if\(!(\w+)\(\w+,\w+\)\)return/, seg, "세계 확인");
  const [, lock, readRun, norm, base] = need(/await (\w+)\(\w+\);let\{doc:\w+,data:\w+\}=await (\w+)\(\w+\),\w+=(\w+)\(\w+\.wallet\|\|\{\.\.\.(\w+)\},\w+\)/, seg, "지갑 읽기");
  const [, writeRun] = need(/await (\w+)\(\w+,\w+,\w+\)\?\{ok:!0/, seg, "저장");
  const [, pub] = need(/wallet:(\w+)\(\w+,\w+\)\}/, seg, "지갑 응답");
  const [, store, pkg] = need(/await (\w+)\.getById\((\w+)\.id,\w+\(\w+\)\),\w+=\w+&&\w+\.data\|\|\{\};return\{enemies:/, src, "전투 이미지 저장소");
  // The lobby's own character list (/home-options): where the world's units live and how a unit lists its outfits.
  // The codex reads the same list without the "owned" filter, so units not pulled yet show too.
  const home = need(/\.post\("\/home-options",async \w+=>\{[\s\S]{0,400}?await (\w+)\.list\((\w+)\.id,(\w+)\)/, src, "캐릭터 목록");
  const [, unitStore, unitPkg, unitKind] = home;
  const [, outfitsOf] = need(/for\(let \w+ of (\w+)\(\w+\)\)\w+\(\w+\.url\)&&\w+\.push\(\{key:\w+\.id,unitId/, src.slice(home.index, home.index + 2000), "의상 목록");
  // The summon: which pool (standard / featured) and where it takes the aether.
  const summon = need(/\w+\.post\("\/summon",async \w+=>\{/, src, "소환 처리");
  const sseg = src.slice(summon.index, summon.index + 3000);
  const [, pool] = need(/(\w+)=\w+\.split\("-"\)\[1\]==="standard"\?"standard":"featured"/, sseg, "소환 배너 종류");
  const pay = need(/let (\w+)=\w+\*(\w+);if\(\(Number\((\w+)\.wallet\.aether\)\|\|0\)<\1\)return\{ok:!1,error:"insufficient-aether"\};\3\.wallet\.aether=\(Number\(\3\.wallet\.aether\)\|\|0\)-\1;/, sseg, "소환 비용");
  const [payText, spent, count, run] = pay;
  const ticketPay = `let ${spent}=0,__gmmT=${pool}==="standard"?"gmmTicketStd":"gmmTicketLtd",__gmmH=Math.max(0,Math.floor(Number(${run}.wallet[__gmmT])||0));`
    + `if(__gmmH<${count})return{ok:!1,error:"insufficient-tickets",ticket:__gmmT,need:${count},held:__gmmH};${run}.wallet[__gmmT]=__gmmH-${count};`;
  const swapped = "/*gacha-more-money:swap:" + Buffer.from(payText, "utf8").toString("base64") + "*/" + ticketPay + "/*gacha-more-money:swapend*/";

  const head = HEAD + "const __gmmPacks=" + JSON.stringify(PACKS) + ",__gmmExchange=" + JSON.stringify(EXCHANGE) + ",__gmmPassDef=" + JSON.stringify(PASS) + ",__gmmDaily=" + DAILY + ";"
    + "function __gmmDayNum(){let d=new Date();return Math.floor((d.getTime()-d.getTimezoneOffset()*6e4)/864e5)}"
    + "function __gmmPass(S){let P=S&&S.moreMoneyPass,n=__gmmDayNum();if(!P||!Number.isFinite(Number(P.start)))return{active:!1,days:__gmmPassDef.days,rewards:__gmmPassDef};"
    + "let st=Number(P.start),day=n-st+1,claimed=Array.isArray(P.claimed)?P.claimed.map(Number):[],active=day>=1&&day<=__gmmPassDef.days;"
    + "return{active,day:active?day:0,days:__gmmPassDef.days,daysLeft:active?__gmmPassDef.days-day:0,claimedToday:claimed.includes(n),claimedDays:claimed.map(c=>c-st+1).filter(c=>c>=1&&c<=__gmmPassDef.days),rewards:__gmmPassDef}}"
    + "function __gmmGive(M,G){for(let[c,q]of Object.entries(G))M[c]=(Number(M[c])||0)+q}"
    + "function __gmmTickets(W){W=W||{};return{std:Math.max(0,Math.floor(Number(W.gmmTicketStd)||0)),ltd:Math.max(0,Math.floor(Number(W.gmmTicketLtd)||0))}}"
    + "function __gmmToday(){let d=new Date();return d.getFullYear()+\"-\"+(d.getMonth()+1)+\"-\"+d.getDate()}"
    + "function __gmmLeft(S){let day=__gmmToday(),m=S&&S.moreMoney,used=m&&m.day===day?Math.max(0,Number(m.count)||0):0;return{day,used,left:Math.max(0,__gmmDaily-used),daily:__gmmDaily}}"
    + HEAD;
  const check = `let u=p&&p.body||{},o=${str}(u.runId);if(!o)return{ok:!1,error:"bad-request"};let{data:g}=await ${readIndex}();if(!${hasRun}(g,o))return{ok:!1,error:"bad-request"};`;
  const list = (obj) => `Object.entries(${obj}||{}).filter(([,v])=>v&&${str}(v.url)).map(([key,v])=>({key,name:${str}(v.name)||key,url:${str}(v.url)}))`;
  const routes = START
    + `${router}.post("/more-money/status",async p=>{${check}let{data:S}=await ${readRun}(o);return{ok:!0,packs:__gmmPacks,exchange:__gmmExchange,tickets:__gmmTickets(S&&S.wallet),pass:__gmmPass(S),...__gmmLeft(S)}}),`
    + `${router}.post("/more-money/topup",async p=>{${check}let k=${str}(u.pack),P=Object.prototype.hasOwnProperty.call(__gmmPacks,k)?__gmmPacks[k]:null;if(!P)return{ok:!1,error:"bad-request"};`
    + `await ${lock}(o);let{doc:b,data:S}=await ${readRun}(o),M=${norm}(S.wallet||{...${base}},S),t=__gmmLeft(S);if(t.left<=0)return{ok:!1,error:"daily-limit",...t};`
    + `for(let[c,q]of Object.entries(P))M[c]=(Number(M[c])||0)+q;S.moreMoney={day:t.day,count:t.used+1};S.wallet=M;`
    + `return await ${writeRun}(o,b,S)?{ok:!0,pack:k,granted:P,wallet:${pub}(M,S),tickets:__gmmTickets(M),...__gmmLeft(S)}:{ok:!1,error:"write-conflict"}}),`
    + `${router}.post("/more-money/exchange",async p=>{${check}let k=${str}(u.item),X=Object.prototype.hasOwnProperty.call(__gmmExchange,k)?__gmmExchange[k]:null;if(!X)return{ok:!1,error:"bad-request"};`
    + `await ${lock}(o);let{doc:b,data:S}=await ${readRun}(o),M=${norm}(S.wallet||{...${base}},S),h=Math.max(0,Number(M.aether)||0);if(h<X.cost)return{ok:!1,error:"insufficient-aether",need:X.cost,held:h};`
    + `M.aether=h-X.cost;for(let[c,q]of Object.entries(X.give))M[c]=(Number(M[c])||0)+q;S.wallet=M;`
    + `return await ${writeRun}(o,b,S)?{ok:!0,item:k,spent:X.cost,granted:X.give,wallet:${pub}(M,S),tickets:__gmmTickets(M)}:{ok:!1,error:"write-conflict"}}),`
    + `${router}.post("/more-money/pass/buy",async p=>{${check}await ${lock}(o);let{doc:b,data:S}=await ${readRun}(o),M=${norm}(S.wallet||{...${base}},S);`
    + `if(__gmmPass(S).active)return{ok:!1,error:"pass-active",pass:__gmmPass(S)};__gmmGive(M,__gmmPassDef.buy);S.moreMoneyPass={start:__gmmDayNum(),claimed:[]};S.wallet=M;`
    + `return await ${writeRun}(o,b,S)?{ok:!0,granted:__gmmPassDef.buy,wallet:${pub}(M,S),tickets:__gmmTickets(M),pass:__gmmPass(S)}:{ok:!1,error:"write-conflict"}}),`
    + `${router}.post("/more-money/pass/claim",async p=>{${check}await ${lock}(o);let{doc:b,data:S}=await ${readRun}(o),M=${norm}(S.wallet||{...${base}},S),P=__gmmPass(S);`
    + `if(!P.active)return{ok:!1,error:"pass-inactive",pass:P};if(P.claimedToday)return{ok:!1,error:"pass-claimed",pass:P};__gmmGive(M,__gmmPassDef.daily);`
    + `S.moreMoneyPass={...S.moreMoneyPass,claimed:[...(S.moreMoneyPass.claimed||[]),__gmmDayNum()]};S.wallet=M;`
    + `return await ${writeRun}(o,b,S)?{ok:!0,granted:__gmmPassDef.daily,wallet:${pub}(M,S),tickets:__gmmTickets(M),pass:__gmmPass(S)}:{ok:!1,error:"write-conflict"}}),`
    + `${router}.post("/more-money/codex",async p=>{${check}let c=await ${store}.getById(${pkg}.id,o+":combat-art"),d=c&&c.data||{},{data:S}=await ${readRun}(o),R=S&&S.roster||{},W=o+":unit:",U=[],F=[];`
    + `for(let M of await ${unitStore}.list(${unitPkg}.id,${unitKind})){if(!M||typeof M.id!="string"||!M.id.startsWith(W))continue;let _=M.data;if(!_||_.kind!=="character")continue;`
    + `let own=!!(_.isProtagonist||R[M.id]),rar=Number(_.rarity)||0,nm=${str}(_.name);${str}(_.portrait)&&U.push({id:M.id,key:M.id,name:nm,url:${str}(_.portrait),rarity:rar,kit:[${str}(_.affinity),${str}(_.role)].filter(Boolean).join(" "),owned:own});`
    + `for(let x of ${outfitsOf}(_))${str}(x.url)&&F.push({key:x.id,unitId:M.id,name:nm,url:${str}(x.url),rarity:rar,kit:${str}(x.name),owned:own})}`
    + `let srt=(a,b)=>b.rarity-a.rarity||(a.name<b.name?-1:1);U.sort(srt);F.sort(srt);`
    + `return{ok:!0,enemies:${list("d.enemies")},battle:${list("d.modes")},units:U,outfits:F}}),`
    + END;
  const payAt = summon.index + pay.index;
  let out = src.slice(0, payAt) + swapped + src.slice(payAt + payText.length);
  // The shop handler sits before or after the summon; find it again in the changed text.
  const shopAt = out.indexOf(shop[0]);
  out = out.slice(0, shopAt) + routes + out.slice(shopAt);
  return head + out;
}

function syntaxCheck(code) {
  const dir = mkdtempSync(join(tmpdir(), "gmm-"));
  try {
    const file = join(dir, "server.mjs");
    writeFileSync(file, code);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("패치한 코드에 문법 오류가 있어 적용하지 않았습니다:\n" + (r.stderr || r.stdout));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function writeJsonAtomic(file, value) {
  const tmp = file + ".gmm-tmp";
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, file);
}

function updateDeclaration(manifest, rel, buf) {
  const entry = manifest && Array.isArray(manifest.files) ? manifest.files.find((f) => f && f.path === rel) : null;
  if (!entry) return false;
  entry.sha256 = sha256(buf);
  entry.bytes = buf.byteLength;
  return true;
}

async function main() {
  const dataDir = findDataDir();
  const root = join(dataDir, "capability-packages");
  const registryFile = join(root, "installed.json");
  const registry = JSON.parse(await readFile(registryFile, "utf8"));
  const entry = (registry.packages || []).find((p) => p && p.id === PACKAGE_ID);
  if (!entry) throw new Error("가챠 포지가 설치되어 있지 않습니다 (" + registryFile + ").");
  const rel = entry.manifest?.entrypoints?.server || "server.mjs";
  const versionDir = join(root, "versions", PACKAGE_ID, entry.version);
  const file = join(versionDir, rel);
  const original = await readFile(file, "utf8");
  const clean = strip(original);
  const next = restore ? clean : inject(clean);
  if (next === original) { console.log(restore ? "패치가 없습니다. 바꿀 것이 없습니다." : "이미 패치되어 있습니다 (가챠 포지 " + entry.version + ")."); return; }
  syntaxCheck(next);

  const backup = file + ".gmm-backup";
  if (!existsSync(backup) && !original.includes(START)) await copyFile(file, backup);
  const buf = Buffer.from(next, "utf8");
  await writeFile(file, buf);
  if (!updateDeclaration(entry.manifest, rel, buf)) throw new Error("설치 기록에서 " + rel + " 항목을 찾지 못했습니다. 원본은 " + backup + "에 있습니다.");
  await writeJsonAtomic(registryFile, registry);
  // The unpacked manifest beside the files says the same; keep it in step.
  const localManifest = join(versionDir, "manifest.json");
  if (existsSync(localManifest)) {
    const m = JSON.parse(await readFile(localManifest, "utf8"));
    if (updateDeclaration(m, rel, buf)) await writeFile(localManifest, JSON.stringify(m, null, 2));
  }
  console.log((restore ? "패치를 제거했습니다" : "패치를 적용했습니다") + " (가챠 포지 " + entry.version + ", " + file + ").");
  console.log("마리나라를 다시 시작하세요.");
}

main().catch((e) => { console.error("실패: " + e.message); process.exit(1); });
