#!/usr/bin/env node
/* Gacha More Money · 가챠 포지 서버 패치
 *
 * 가챠 포지(gacha-forge) 패키지의 server.mjs에 세 가지 요청을 덧붙입니다.
 *   POST /api/gacha-forge/more-money/status  오늘 남은 충전 횟수
 *   POST /api/gacha-forge/more-money/topup     충전(하루 3번): 에테르 · 자금 · 활력 · 글리머 · 소환권을 지갑에 넣음 (첫걸음 꾸러미는 세계마다 한 번만)
 *   POST /api/gacha-forge/more-money/exchange  에테르로 소환권 사기
 *   POST /api/gacha-forge/more-money/codex     도감용 적 이미지 · 전투 배경 · 세계의 모든 캐릭터 · 의상(미획득 · 상점 미구매 · 다시 그리기 전 그림 포함) · 메신저 사진 목록
 *   POST /api/gacha-forge/more-money/pass/buy    주간 패스 구매(7일): 바로 받는 보상
 *   POST /api/gacha-forge/more-money/pass/claim  주간 패스 오늘 보상(하루 한 번, 7일 동안)
 * 충전 · 교환 · 주간 패스는 요청 번호(requestId)로 두 번 들어가지 않고, 최근 20건을 결제 내역으로 남깁니다.
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
import { createRequire } from "node:module";

// The patch itself lives in gmm-core.cjs, shared with the in-memory hook (gacha-more-money-runtime.cjs).
const { PACKAGE_ID, START, strip, inject } = createRequire(import.meta.url)("./gmm-core.cjs");

const args = process.argv.slice(2);
const restore = args.includes("--restore");
const given = args.find((a) => !a.startsWith("--"));

function findDataDir() {
  const candidates = [given, process.env.DATA_DIR, "packages/server/data", "data", "."].filter(Boolean).map((p) => resolve(p));
  for (const dir of candidates) if (existsSync(join(dir, "capability-packages", "installed.json"))) return dir;
  throw new Error("마리나라 data 폴더를 찾지 못했습니다. 경로를 직접 적어 주세요. 예: node apply-patch.mjs C:\\Marinara-Engine\\packages\\server\\data\n찾아본 곳: " + candidates.join(", "));
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

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
