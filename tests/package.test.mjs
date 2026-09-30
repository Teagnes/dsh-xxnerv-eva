import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('the manifest declares a web Client half and a bundle patch', () => {
  assert.equal(pkg.name, 'dsh-plugin-xxnerv-eva');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.dsh.client.immediately, true);
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0);
});

test('every declared export resolves to a real file', () => {
  for (const [key, target] of Object.entries(pkg.exports)) {
    const file = path.join(root, target);
    assert.ok(fs.existsSync(file), `${key} -> ${target} is missing`);
    assert.ok(fs.statSync(file).isFile(), `${key} -> ${target} is not a file`);
  }
  for (const entry of pkg.files) assert.ok(fs.existsSync(path.join(root, entry)), `files entry ${entry} is missing`);
});

test('the plugin-manager icon is a small local SVG', () => {
  assert.equal(typeof pkg.icon, 'string');
  assert.ok(!path.isAbsolute(pkg.icon) && !/^[a-z]+:/i.test(pkg.icon));
  const file = path.resolve(root, pkg.icon);
  assert.ok(file.startsWith(root + path.sep), 'the icon must stay inside the package');
  assert.match(path.extname(file).toLowerCase(), /^\.(svg|png|jpe?g|webp)$/);
  assert.ok(fs.statSync(file).size <= 256 * 1024);
  assert.match(read(pkg.icon), /<svg /);
});

test('the bundle patch inserts exactly one row under the package name', () => {
  const patch = read('cordis.patch.yml');
  const inserts = [...patch.matchAll(/^-\s*insert:/gm)];
  assert.equal(inserts.length, 1);
  assert.match(patch, new RegExp(`name:\\s*${pkg.name}\\b`));
  assert.match(patch, /- id: xxnerv-eva/);
  assert.ok(!/disabled:\s*true/.test(patch), 'the row must be enabled');
});

test('the host half is a no-op plugin that DSH can load', async () => {
  const host = await import(path.join(root, 'index.js'));
  assert.equal(typeof host.apply, 'function');
  assert.equal(host.apply(), undefined);
});

test('both locale dictionaries carry plugin-manager metadata', () => {
  for (const language of ['en', 'zh']) {
    const dictionary = JSON.parse(read(`locale/${language}.json`));
    assert.equal(typeof dictionary.meta?.title, 'string');
    assert.ok(dictionary.meta.title.length > 0);
    assert.equal(typeof dictionary.meta?.description, 'string');
    assert.ok(dictionary.meta.description.length > 0);
  }
});

test('the built bundle is committed and newer than every source it inlines', () => {
  const bundle = path.join(root, 'client.js');
  assert.ok(fs.existsSync(bundle), 'run `node tools/build.mjs`');
  const built = fs.statSync(bundle).mtimeMs;
  const sources = fs.readdirSync(path.join(root, 'src')).map(name => path.join(root, 'src', name));
  sources.push(path.join(root, 'assets/unit.svg'), path.join(root, 'package.json'));
  for (const source of sources) {
    assert.ok(fs.statSync(source).mtimeMs <= built + 1000, `${path.relative(root, source)} changed after the last build`);
  }
});
