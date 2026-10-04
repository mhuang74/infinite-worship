/**
 * Zen draw-module test harness (issues #38–#41 testing decisions).
 *
 * Plain Node scripts with `assert` — deliberately no test framework, matching
 * the repo's avoidance of one (spec: "plain-Node assertion scripts"). The
 * pure draw module is transpiled with the TypeScript compiler already in
 * node_modules and executed in-process against a scripted fake 2D context.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // application/frontend/zen-tests
const frontend = path.dirname(here);
const require = createRequire(import.meta.url);
const ts = require(path.join(frontend, 'node_modules', 'typescript'));

/** Transpile a TS module from src/ to a temp .js file and return its URL. */
export function compileTs(relPath) {
  const source = readFileSync(path.join(frontend, relPath), 'utf8');
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'zen-draw-'));
  const file = path.join(dir, path.basename(relPath).replace(/\.ts$/, '.js'));
  writeFileSync(file, out.outputText);
  return pathToFileURL(file).href;
}

/** Fake 2D context recording each method call with its style state. */
export class FakeCtx {
  constructor({ width = 800, height = 600 } = {}) {
    this.width = width;
    this.height = height;
    this.canvas = { width, height };
    this.calls = [];
    this.fillStyle = '';
    this.strokeStyle = '';
    this.lineWidth = 1;
    this.globalAlpha = 1;
  }

  _record(method, args) {
    this.calls.push({
      method,
      args: [...args],
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
    });
  }

  beginPath() { this._record('beginPath', []); }
  closePath() { this._record('closePath', []); }
  arc(...args) { this._record('arc', args); }
  ellipse(...args) { this._record('ellipse', args); }
  rect(...args) { this._record('rect', args); }
  moveTo(...args) { this._record('moveTo', args); }
  lineTo(...args) { this._record('lineTo', args); }
  quadraticCurveTo(...args) { this._record('quadraticCurveTo', args); }
  fill() { this._record('fill', []); }
  stroke() { this._record('stroke', []); }
  clearRect(...args) { this._record('clearRect', args); }
  fillRect(...args) { this._record('fillRect', args); }
  strokeRect(...args) { this._record('strokeRect', args); }
  save() { this._record('save', []); }
  restore() { this._record('restore', []); }
  translate(...args) { this._record('translate', args); }
  rotate(...args) { this._record('rotate', args); }
  setLineDash(...args) { this._record('setLineDash', args); }
  fillText(...args) { this._record('fillText', args); }
}

export function callsOf(ctx, method) {
  return ctx.calls.filter((c) => c.method === method);
}