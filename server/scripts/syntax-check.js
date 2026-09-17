#!/usr/bin/env node
'use strict';

/** Parses every source file. Cheap insurance before starting the server. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const root = path.resolve(__dirname, '..');
const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'tests')), ...walk(path.join(root, 'scripts'))];

let failures = 0;
for (const file of files) {
  try {
    new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${path.relative(root, file)}\n     ${err.message}`);
  }
}

console.log(`${files.length} files checked, ${failures} failed`);
process.exit(failures ? 1 : 0);
