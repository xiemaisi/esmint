/**
 * ESMint command line interface.
 *
 * Usage:
 *
 *    node esmint.js (--mixin FILE | FILE | STRING )*
 *
 * Arguments are interpreted one by one from left to right as follows:
 *
 *   - `--mixin FILE`: load `FILE` as a Node.js module, and mix the
 *     object exported by that module into the evaluator, overwriting any
 *     existing properties of the same name and recursively mixing in
 *     objects;
 *   - `FILE`: read `FILE` as UTF-8 source text and evaluate it;
 *   - `SOURCE`: interpret `SOURCE` directly as source text and evaluate it.
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
    ev = new Evaluator(), completion = {};

for (var i=2, n=process.argv.length; i<n; ++i) {
    var arg = process.argv[i];
    if (arg === '--mixin') {
      util.extend(ev, require(process.argv[++i]));
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
