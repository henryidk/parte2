/*
  Mojibake fixer: detects typical UTF-8→Latin1 mis-decoding (Ã, Â, â)
  and rewrites files with corrected UTF-8 text.

  Usage: node scripts/fix-encoding.js [paths...]
  If no paths are provided, defaults to scanning: README.md, public, src, database
*/
const fs = require('fs');
const path = require('path');

const DEFAULT_DIRS = ['README.md', 'public', 'src', 'database'];
const TEXT_EXTS = new Set(['.md', '.html', '.css', '.js', '.json', '.txt', '.sql']);
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'imagenes', 'Capturas']);

function isTextFile(file) {
  const ext = path.extname(file).toLowerCase();
  return TEXT_EXTS.has(ext);
}

function shouldSkip(file) {
  const parts = file.split(path.sep);
  return parts.some((p) => EXCLUDE_DIRS.has(p)) || /\.(png|jpg|jpeg|gif|svg|ico|pdf|map)$/i.test(file);
}

function findFiles(start) {
  const out = [];
  function walk(p) {
    if (shouldSkip(p)) return;
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      const entries = fs.readdirSync(p);
      for (const e of entries) walk(path.join(p, e));
    } else if (st.isFile()) {
      if (isTextFile(p)) out.push(p);
    }
  }
  walk(start);
  return out;
}

function looksMojibake(s) {
  return /[ÃÂâ]/.test(s) || /Gesti..n|Sesi..n|Contrase..a/i.test(s);
}

function fixString(s) {
  // Convert by interpreting current string as latin1 bytes, then decode as utf8
  const fixed = Buffer.from(s, 'latin1').toString('utf8');
  return fixed;
}

function processFile(file) {
  const original = fs.readFileSync(file, 'utf8');
  if (!looksMojibake(original)) return { file, changed: false };
  const fixed = fixString(original);
  // If fixing produced fewer mojibake markers and more valid accents, accept.
  const beforeScore = (original.match(/[ÃÂâ]/g) || []).length;
  const afterScore = (fixed.match(/[ÃÂâ]/g) || []).length;
  if (afterScore < beforeScore) {
    fs.writeFileSync(file, fixed, 'utf8');
    return { file, changed: true, beforeScore, afterScore };
  }
  return { file, changed: false };
}

function run(paths) {
  const targets = new Set();
  const inputs = paths.length ? paths : DEFAULT_DIRS;
  for (const p of inputs) {
    if (!fs.existsSync(p)) continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const f of findFiles(p)) targets.add(f);
    } else if (st.isFile() && isTextFile(p)) {
      targets.add(p);
    }
  }

  const results = [];
  for (const f of targets) {
    try {
      results.push(processFile(f));
    } catch (e) {
      results.push({ file: f, error: e.message });
    }
  }

  const changed = results.filter(r => r.changed);
  const summary = {
    scanned: targets.size,
    changed: changed.length,
    files: changed.map(r => ({ file: r.file, beforeScore: r.beforeScore, afterScore: r.afterScore }))
  };
  console.log(JSON.stringify(summary, null, 2));
}

run(process.argv.slice(2));

