// Minimal read-only asar reader, for inspecting the installed DSH app bundle.
// Usage:
//   node tools/asar.mjs list   [substring]
//   node tools/asar.mjs cat    <inner/path>
//   node tools/asar.mjs extract <substring> <outDir>
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const ARCHIVE = process.env.DSH_ASAR ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';

async function readHeader() {
  const fh = await fs.open(ARCHIVE, 'r');
  try {
    const buf = Buffer.alloc(16);
    await fh.read(buf, 0, 16, 0);
    const headerSize = buf.readUInt32LE(4);
    const jsonSize = buf.readUInt32LE(12);
    const json = Buffer.alloc(jsonSize);
    await fh.read(json, 0, jsonSize, 16);
    // Layout: [u32=4][u32=headerSize][header pickle: u32 len, u32 jsonLen, json..., pad]
    // Size fields total 8 bytes before the pickle, so content starts at 8 + headerSize.
    return { header: JSON.parse(json.toString('utf8')), contentOffset: 8 + headerSize };
  } finally {
    await fh.close();
  }
}

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (entry.files) walk(entry, p, out);
    else out.push({ path: p, size: Number(entry.size ?? 0), offset: entry.offset === undefined ? null : Number(entry.offset) });
  }
  return out;
}

async function readFileAt(offset, size) {
  const fh = await fs.open(ARCHIVE, 'r');
  try {
    const buf = Buffer.alloc(size);
    await fh.read(buf, 0, size, offset);
    return buf;
  } finally {
    await fh.close();
  }
}

function toBuffer(entry, contentOffset) {
  if (entry.offset === null) throw new Error('unpacked entry, read from app.asar.unpacked');
  return readFileAt(contentOffset + entry.offset, entry.size);
}

const [, , cmd, ...rest] = process.argv;
const { header, contentOffset } = await readHeader();
const files = walk(header, '', []);

if (cmd === 'list') {
  const needle = rest[0] ?? '';
  const rows = files.filter(f => f.path.includes(needle));
  for (const f of rows) console.log(`${String(f.size).padStart(10)}  ${f.path}`);
  console.error(`-- ${rows.length} of ${files.length} entries`);
} else if (cmd === 'cat') {
  const entry = files.find(f => f.path === rest[0]);
  if (!entry) throw new Error(`not found: ${rest[0]}`);
  process.stdout.write(await toBuffer(entry, contentOffset));
} else if (cmd === 'extract') {
  const [needle, outDir] = rest;
  const rows = files.filter(f => f.path.includes(needle) && f.offset !== null);
  for (const f of rows) {
    const dest = path.join(outDir, f.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, await toBuffer(f, contentOffset));
  }
  console.error(`-- extracted ${rows.length} files into ${outDir}`);
} else {
  console.error('usage: list [needle] | cat <path> | extract <needle> <outDir>');
  process.exit(2);
}
