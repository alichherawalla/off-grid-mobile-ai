import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recommendedShardCount, resolveShardCount } from '../run-jest-shards.mjs';

const require = createRequire(import.meta.url);
const metroConfig = require('../../metro.config.js');
const packageManifest = require('../../package.json');
const applicationManifest = require('../../../shared/packages/application/package.json');
const babelConfig = require('../../babel.config.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

test('uses available CPU safely by default and rejects unsafe overrides', () => {
  assert.equal(recommendedShardCount(10), 6);
  assert.equal(recommendedShardCount(4), 2);
  assert.equal(recommendedShardCount(2), 1);
  assert.equal(resolveShardCount(undefined, 10), 6);
  assert.equal(resolveShardCount('6'), 6);
  assert.throws(() => resolveShardCount('0'));
  assert.throws(() => resolveShardCount('many'));
  assert.throws(() => recommendedShardCount(0));
});

test('maps the Mobile and application-facade Shared dependencies into the Metro release graph', () => {
  const mappings = metroConfig.resolver?.extraNodeModules ?? {};
  const watched = new Set((metroConfig.watchFolders ?? []).map(directory => path.resolve(directory)));
  const directDependencies = Object.entries(packageManifest.dependencies)
    .filter(([name, location]) => name.startsWith('@offgrid/') && String(location).startsWith('file:../shared/packages/'))
    .map(([name, location]) => [name, path.resolve(ROOT, String(location).slice('file:'.length))]);
  const facadeDependencies = Object.keys(applicationManifest.dependencies)
    .filter(name => name.startsWith('@offgrid/'))
    .map(name => [name, path.resolve(ROOT, '../shared/packages', name.slice('@offgrid/'.length))]);

  for (const [name, packageDirectory] of [...directDependencies, ...facadeDependencies]) {
    assert.ok(mappings[name], `${name} must have an explicit Metro mapping`);
    assert.ok(watched.has(packageDirectory), `${name} must be watched by Metro`);
  }
});

test('transforms dependency namespace exports before Metro converts modules', () => {
  assert.ok(babelConfig.plugins.includes('@babel/plugin-transform-export-namespace-from'));
});
