var acorn = require('acorn'),
    fs = require('fs'),
    Evaluator = require('./ev').Evaluator,
    e = new Evaluator(),
    arg, src, completion;

for (var i=2, n=process.argv.length; i<n; ++i) {
    arg = process.argv[i];
    src = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf-8') : arg;
    completion = e.ev(null, src);
    if (completion.type !== 'normal')
        break;
}

if (completion.type === 'throw')
    throw completion.result.value;
else
    console.log(completion.type + ": " + (completion.result && completion.result.value));