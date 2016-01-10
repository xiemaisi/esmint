# ESMint: **E**CMA**S**cript **M**eta-circular **Int**erpreter

ESMint is a hackable, extensible [meta-circular interpreter](https://en.wikipedia.org/wiki/Meta-circular_evaluator)
for [ECMAScript 5](https://en.wikipedia.org/wiki/ECMAScript#5th_Edition). It is currently in the early stages of development,
but already passes about 96% of the [official conformance suite](https://github.com/tc39/test262).

## Installation

Currently, ESMint runs on Node.js only.

    git clone https://github.com/xiemaisi/esmint.git
    cd esmint
    npm install

## Usage

A command-line driver is provided in [bin/esmint.js](bin/esmint.js). It accepts
zero or more arguments, which may either be files, code snippets, or `--mixin`
arguments explained below.

Code is interpreted meta-circularly on top of the hosting Node.js instance, hence
Node.js globals such as `console` are available, while module-scoped variables
such as `require` or `exports` are not:

```
$ ./bin/esmint.js 'var me = { name: "Me" }; console.log("My name is " + me.nme);'
My name is undefined
```

```
$ ./bin/esmint.js 'require("fs")'
ReferenceError: require is not defined
```

Interpretation overhead is significant (in the area of 200x according to some
entirely unscientific measurements of mine).

The behaviour of ESMint can be customised and extended by providing  `--mixin`
arguments: these are interpreted as Node.js modules and should export an object,
which is mixed into the evaluator as described below.

For instance, this can be used to implement dynamic analyses like the ones in
[src/analyses](src/analyses):

```
$ ./bin/esmint.js --mixin src/analyses/UndefinedToString.js 'var me = { name: "Me" }; console.log("My name is " + me.nme);'
Undefined converted to string at command line argument #3:1,53-1,59.
My name is undefined
```

## Documentation

Source code is parsed using [Acorn](https://github.com/ternjs/acorn), and then
evaluated using a fairly simple-minded AST interpreter, implemented as an object
of class `Evaluator` (see [src/core/Evaluator.js](src/core/Evaluator.js)).

The evaluator object has methods named after [ESTree](https://github.com/estree/)
node types: `Program` evaluates entire programs, `IfStatement` evaluates `if`
statements, etc. The individual interpreter methods are invoked with two arguments:
the current execution context `ctxt` (see [src/core/ExecutionContext.js](src/core/ExecutionContext.js)) and the AST node
`nd` being interpreted.

The driver program starts out by constructing a vanilla `Evaluator` object and
then processes its command-line arguments from left to right. When it encounters
a file or code snippet, it uses the current evaluator to run it. When it encounters
a `--mixin` argument, it loads the mixin as a Node.js module. If the module
exports a single object `o`, it creates a new evaluator object that has all the
properties of `o`, and has the previous evaluator as its prototype. Thus, the
new evaluator can override the behaviour of the old evaluator as desired, and
fall back on the old evaluator's implementation where necessary.

## License

MIT, see [included license file](LICENSE).
