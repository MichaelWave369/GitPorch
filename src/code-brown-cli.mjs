#!/usr/bin/env node
// Usage: node src/code-brown-cli.mjs report.json [--require-pass]
import { readFile } from 'node:fs/promises';
import { assessCodeBrown, CHECKS } from './code-brown.mjs';

const args = process.argv.slice(2);
const path = args.find(arg => !arg.startsWith('--'));
const options = args.filter(arg => arg.startsWith('--'));
if (!path || options.some(arg => arg !== '--require-pass')) {
  console.error('Usage: node src/code-brown-cli.mjs REPORT.json [--require-pass]');
  process.exitCode = 2;
} else {
  try {
    const report = JSON.parse(await readFile(path, 'utf8'));
    const result = assessCodeBrown(report);
    console.log('CODE BROWN: ' + result.outcome +
      ' (' + result.passed + '/' + CHECKS.length + ' pass, ' +
      result.failed + ' fail, ' + result.untested + ' not tested)');
    console.log('Scope: self-reported human usability; NOT an automated browser or accessibility certification.');
    for (const error of result.errors) console.error('ERROR: ' + error);
    if (result.outcome === 'INVALID' || result.outcome === 'FAIL' ||
        (options.includes('--require-pass') && result.outcome !== 'PASS')) process.exitCode = 1;
  } catch (error) {
    console.error('Unable to read report: ' + error.message);
    process.exitCode = 2;
  }
}
