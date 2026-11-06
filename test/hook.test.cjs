'use strict';
// node --test test/   (GF_FORGE_SERVER=<gacha-forge server.mjs> checks a real game file)
process.env.GMM_HOOK_TEST = '1';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { applyPatch, TARGET } = require('../gacha-more-money-runtime.cjs');
const { strip, inject, START } = require('../patch/gmm-core.cjs');

test('targets only the runtime snapshot server.mjs', () => {
  assert.ok(TARGET.test('C:\\M\\data\\capability-runtime-snapshots\\gacha-forge-1.27.5-abc\\server.mjs'));
  assert.ok(TARGET.test('/m/data/capability-runtime-snapshots/gacha-forge-2.0.0-x/server.mjs'));
  assert.ok(!TARGET.test('/m/data/capability-packages/versions/gacha-forge/1.27.5/server.mjs'));
  assert.ok(!TARGET.test('/m/data/capability-runtime-snapshots/gacha-forge-1.27.5-x/client.js'));
});

test('unknown code: not applied, source unchanged, no throw', () => {
  const r = applyPatch('export const x = 1;', { check: false });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.source, 'export const x = 1;');
});

const real = process.env.GF_FORGE_SERVER;
test('real server.mjs: applied once, same as the file patch, and idempotent over an on-disk patch', { skip: !real }, () => {
  const original = fs.readFileSync(real, 'utf8');
  const clean = strip(original);
  const r = applyPatch(original);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.source, inject(clean), 'hook output equals apply-patch.mjs output');
  assert.strictEqual(r.source.split(START).length, 2, 'routes inserted exactly once');
  const again = applyPatch(r.source);
  assert.ok(again.ok, again.error);
  assert.strictEqual(again.source, r.source, 'running over a patched file gives the same code');
  assert.strictEqual(strip(r.source), clean, 'strip gives the original back');
});
