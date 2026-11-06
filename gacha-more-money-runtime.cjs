'use strict';
// Gacha More Money (충전소 · 소환권 · 도감) — in-memory server hook. 설치 파일은 건드리지 않습니다.
// 마리나라가 가챠 포지의 server.mjs를 불러올 때 메모리에서만 충전소 요청과 소환권 결제를 넣습니다. 그래서 가챠 포지가
// 업데이트돼도 패치가 지워지지 않고, 패치 스크립트를 다시 실행할 필요가 없습니다.
// 예전 방식(patch/apply-patch.mjs)으로 파일에 넣어 둔 패치가 있어도 걷어낸 뒤 한 번만 넣습니다.
// 게임 코드가 많이 바뀌어 넣을 자리를 못 찾거나, 넣은 결과에 문법 오류가 있으면 아무것도 바꾸지 않습니다(게임 그대로).
// NODE_OPTIONS에서 다른 가챠 포지 훅들보다 "앞에" --require 하세요 (앞 훅의 결과를 뒤 훅이 받아 고칩니다).
// 끄기: GMM_HOOK_OFF=1 또는 NODE_OPTIONS에서 이 줄을 빼고 재시작.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { registerHooks } = require('node:module');
const { fileURLToPath } = require('node:url');
const { strip, inject, START } = require('./patch/gmm-core.cjs');

const TAG = '[gacha-more-money]';
const TARGET = /[\\/]capability-runtime-snapshots[\\/]gacha-forge-\d+\.\d+\.\d+-[^\\/]+[\\/]server\.mjs$/;

// Returns { ok, source, error }. Never throws: a failure keeps the game exactly as it was.
function applyPatch(source, { check = true } = {}) {
  let next;
  try { next = inject(strip(source)); } catch (e) { return { ok: false, source, error: e.message }; }
  if (!next.includes(START)) return { ok: false, source, error: 'patch markers missing after inject' };
  if (check) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gmm-hook-'));
    try {
      const file = path.join(dir, 'server.mjs');
      fs.writeFileSync(file, next);
      const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
      if (r.status !== 0) return { ok: false, source, error: 'syntax check failed: ' + String(r.stderr || r.stdout).split('\n').slice(0, 3).join(' | ') };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  return { ok: true, source: next };
}

if (process.env.GMM_HOOK_TEST !== '1') {
  if (process.env.GMM_HOOK_OFF === '1') process.stderr.write(TAG + ' off (GMM_HOOK_OFF=1); game unchanged\n');
  else if (typeof registerHooks !== 'function') process.stderr.write(TAG + ' this Node.js has no module.registerHooks (need 22.15+); hook disabled, game unchanged\n');
  else {
    registerHooks({ load(url, context, nextLoad) {
      if (!url.startsWith('file:')) return nextLoad(url, context);
      let filename; try { filename = fileURLToPath(url); } catch { return nextLoad(url, context); }
      if (!TARGET.test(filename)) return nextLoad(url, context);
      const result = nextLoad(url, context);
      const source = result.source == null ? fs.readFileSync(filename, 'utf8') : Buffer.isBuffer(result.source) ? result.source.toString('utf8') : String(result.source);
      const t = applyPatch(source);
      if (!t.ok) { process.stderr.write(TAG + ' not applied: ' + t.error + '; game unchanged (충전소 · 소환권 off)\n'); return result; }
      process.stderr.write(TAG + ' applied in memory (충전소 · 소환권 · 도감 routes)' + (source.includes(START) ? '; replaced the on-disk patch' : '') + '\n');
      return { ...result, source: t.source, shortCircuit: true };
    } });
    process.stderr.write(TAG + ' hook registered (no package files changed)\n');
  }
}
module.exports = { applyPatch, TARGET };
