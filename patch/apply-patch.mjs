#!/usr/bin/env node
/* Gacha More Money · 가챠 포지 서버 패치
 *
 * 가챠 포지(gacha-forge) 패키지의 server.mjs에 세 가지 요청을 덧붙입니다.
 *   POST /api/gacha-forge/more-money/status  오늘 남은 충전 횟수
 *   POST /api/gacha-forge/more-money/topup   충전(하루 3번): 에테르 · 자금을 지갑에 넣음
 *   POST /api/gacha-forge/more-money/codex   도감용 적 이미지 · 전투 배경 목록
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

// What each pack puts in the wallet (one summon costs 160 aether). Keep in sync with extension.js PACKS.
const PACKS = {
  "aether-s": { aether: 1600 },
  "aether-l": { aether: 4800 },
  "funds": { funds: 100000 },
};
const DAILY = 3;

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
  let out = src;
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

  const head = HEAD + "const __gmmPacks=" + JSON.stringify(PACKS) + ",__gmmDaily=" + DAILY + ";"
    + "function __gmmToday(){let d=new Date();return d.getFullYear()+\"-\"+(d.getMonth()+1)+\"-\"+d.getDate()}"
    + "function __gmmLeft(S){let day=__gmmToday(),m=S&&S.moreMoney,used=m&&m.day===day?Math.max(0,Number(m.count)||0):0;return{day,used,left:Math.max(0,__gmmDaily-used),daily:__gmmDaily}}"
    + HEAD;
  const check = `let u=p&&p.body||{},o=${str}(u.runId);if(!o)return{ok:!1,error:"bad-request"};let{data:g}=await ${readIndex}();if(!${hasRun}(g,o))return{ok:!1,error:"bad-request"};`;
  const list = (obj) => `Object.entries(${obj}||{}).filter(([,v])=>v&&${str}(v.url)).map(([key,v])=>({key,name:${str}(v.name)||key,url:${str}(v.url)}))`;
  const routes = START
    + `${router}.post("/more-money/status",async p=>{${check}let{data:S}=await ${readRun}(o);return{ok:!0,packs:__gmmPacks,...__gmmLeft(S)}}),`
    + `${router}.post("/more-money/topup",async p=>{${check}let k=${str}(u.pack),P=Object.prototype.hasOwnProperty.call(__gmmPacks,k)?__gmmPacks[k]:null;if(!P)return{ok:!1,error:"bad-request"};`
    + `await ${lock}(o);let{doc:b,data:S}=await ${readRun}(o),M=${norm}(S.wallet||{...${base}},S),t=__gmmLeft(S);if(t.left<=0)return{ok:!1,error:"daily-limit",...t};`
    + `for(let[c,q]of Object.entries(P))M[c]=(Number(M[c])||0)+q;S.moreMoney={day:t.day,count:t.used+1};S.wallet=M;`
    + `return await ${writeRun}(o,b,S)?{ok:!0,pack:k,granted:P,wallet:${pub}(M,S),...__gmmLeft(S)}:{ok:!1,error:"write-conflict"}}),`
    + `${router}.post("/more-money/codex",async p=>{${check}let c=await ${store}.getById(${pkg}.id,o+":combat-art"),d=c&&c.data||{};return{ok:!0,enemies:${list("d.enemies")},battle:${list("d.modes")}}}),`
    + END;
  return head + src.slice(0, shop.index) + routes + src.slice(shop.index);
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
