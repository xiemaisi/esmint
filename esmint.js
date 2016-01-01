/**
 * ESMint command line interface.
 *
 * Usage:
 *
 *    node esmint.js (--mixin FILE | FILE | STRING )*
 *
 * Arguments are interpreted one by one from left to right as follows:
 *
 *   - `--mixin FILE`: load `FILE` as a Node.js module; if the module exports
 *     an object, then the current evaluator is replaced with a new evaluator
 *     that has the old one as its `__proto__` and contains all properties of
 *     the exported object; in other words, the mixin can overwrite any
 *     properties of the evaluator, but the old values will still be available
 *     on `__proto__`;
 *   - `FILE`: read `FILE` as UTF-8 source text and evaluate it with the current
 *     evaluator;
 *   - `SOURCE`: interpret `SOURCE` directly as source text and evaluate it with
 *     the current evaluator.
 *
 * Note that any argument that is not `--mixin` and cannot be resolved as a `FILE` is interpreted
 * as a `SOURCE`.
 *
 * If at any point the evaluation results in an abnormal completion, evaluation is terminated.
 *
 * If the final completion is an exceptional completion, the exception is printed to stdout and
 * ESMint returns exit code 1. Otherwise, nothing is printed and the exit code is 0.
 *
 * @module esmint
 */

var fs = require('fs'),
  Evaluator = require('./Evaluator'),
  ev = new Evaluator(),
  completion = {};

for (var i = 2, n = process.argv.length; i < n; ++i) {
  var arg = process.argv[i];
  if (arg === '--mixin') {
    var newProps = require(process.argv[++i]);
    if (newProps && typeof newProps === 'object') {
      // create property descriptor object to pass to Object.create
      var newPropDescs = {};
      for (var p in newProps) {
        newPropDescs[p] = {
          writable: true,
          configurable: true,
          value: newProps[p]
        };
      }
      ev = Object.create(ev, newPropDescs);
    }
  } else {
    completion = ev.ev(null, fs.existsSync(arg) ? fs.readFileSync(arg, 'utf-8') : arg);
    if (completion.type !== 'normal')
      break;
  }
}

if (completion.type === 'throw') {
  console.error(String(completion.result.value));
  process.exit(1);
}
