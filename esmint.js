var fs = require('fs'),
    Evaluator = require('./ev').Evaluator,
    srcs = [], mixins = {};

for (var i=2, n=process.argv.length; i<n; ++i) {
    var arg = process.argv[i];
    if (arg === '--mixin')
      util.extend(mixins, require(process.argv[++i]));
    else
      srcs.push(fs.existsSync(arg) ? fs.readFileSync(arg, 'utf-8') : arg);
}

var e = new Evaluator(mixins);
for (var i=0; i<srcs.length; ++i) {
    completion = e.ev(null, srcs[i]);
    if (completion.type !== 'normal')
        break;
}

if (completion.type === 'throw')
    throw completion.result.value;
else
    console.log(completion.type + ": " + (completion.result && completion.result.value));
