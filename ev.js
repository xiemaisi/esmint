(function (exports) {
    // make our own copies of important library objects
    var globalObj = (function () { return this; })(),
        Error = globalObj.Error,
        eval = globalObj.eval,
        Function = globalObj.Function,
        Function_prototype_apply = Function.prototype.apply,
        Object = globalObj.Object,
        Object_create = Object.create,
        Object_getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor,
        Object_defineProperty = Object.defineProperty,
        Object_prototype = Object.prototype,
        ReferenceError = globalObj.ReferenceError,
        String = globalObj.String,
        String_prototype_substring = String.prototype.substring,
        TypeError = globalObj.TypeError;

    // load acorn
    var acorn, walk;
    if (typeof require === 'function') {
        acorn = require('acorn');
        walk = require('acorn/util/walk');
    } else {
        acorn = globalObj.acorn;
        walk = acorn.walk;
    }

    function Evaluator(mixin) {
        for (var p in mixin)
            this[p] = mixin[p];
    }

    // shims for some library functions we need; these have to be robust against monkey patching
    Evaluator.prototype.forEach = function(xs, fn) {
        for (var i=0, n=xs.length; i<n; ++i)
            fn(xs[i], i);
    };

    Evaluator.prototype.map = function(xs, fn) {
        var res = [];
        for (var i=0, n=xs.length; i<n; ++i)
            res[i] = fn(xs[i], i);
        return res;
    };

    Evaluator.prototype.contains = function(xs, x) {
        for (var i=xs.length; i>=0; --i)
            if (xs[i] === x)
                return true;
        return false;
    };

    Evaluator.prototype.join = function(xs, sep) {
        var res = "";
        for (var i=0, n=xs.length; i<n; ++i) {
            if (i > 0)
                res += sep;
            res += xs[i];
        }
        return res;
    };

    Evaluator.prototype.push = function(xs, x) {
        xs[xs.length] = x;
    };

    Evaluator.prototype.substring = function(str, start, end) {
        return this.apply(String_prototype_substring, str, [start, end]);
    };

    Evaluator.prototype.apply = function(fn, base, args) {
        if (fn.apply === Function_prototype_apply)
            return fn.apply(base, args);
        for (var i=0;;++i) {
            var tmpname = "___apply$" + i;
            if (!(tmpname in fn)) {
                Object_defineProperty(fn, tmpname, {
                    value: Function_prototype_apply,
                    configurable: true,
                    enumerable: false,
                    writable: false
                });
                try {
                    return fn[tmpname](base, args);
                } finally {
                    delete fn[tmpname];
                }
            }
        }
    };

    Evaluator.prototype.construct = function(fn, args) {
        return eval("new fn(" + this.join(this.map(args, function(_, i) { return "args[" + i + "]"; }), ", ") + ")");
    };

    Evaluator.prototype.defineGetter = function(o, p, getter) {
        var desc = Object_getOwnPropertyDescriptor(o, p);
        Object_defineProperty(o, p, {
            get: getter,
            set: desc && desc.set || void(0),
            configurable: desc && desc.configurable || true,
            enumerable: desc && desc.enumerable || true
        });
    }

    Evaluator.prototype.defineSetter = function(o, p, setter) {
        var desc = Object_getOwnPropertyDescriptor(o, p);
        Object_defineProperty(o, p, {
            set: setter,
            get: desc && desc.get || void(0),
            configurable: desc && desc.configurable || true,
            enumerable: desc && desc.enumerable || true
        });
    }

    Evaluator.prototype.getGetter = function(o, p) {
        var desc = Object_getOwnPropertyDescriptor(o, p);
        return desc && desc.get;
    }

    Evaluator.prototype.getSetter = function(o, p) {
        var desc = Object_getOwnPropertyDescriptor(o, p);
        return desc && desc.set;
    }

    /** Execution contexts. */
    ExecutionContext = function(env, thiz) {
        this.lexicalEnvironment = this.variableEnvironment = env;
        this.thisBinding = thiz;
    }

    /** Environments. */
    function Environment(outer, obj) {
        this.bindings = obj || Object_create(null);
        this.outer = outer;
    }

    Environment.prototype.get = function(name) {
        if (this.hasBinding(name))
            return new Completion('normal', new Result(this.bindings[name]), null);
        if (!this.outer)
            return new Completion('throw', new Result(new ReferenceError(name + " is not defined")), null);
        return this.outer.get(name);
    };

    Environment.prototype.put = function(name, value) {
        if (this.hasBinding(name) || !this.outer)
            return new Completion('normal', new Result(this.bindings[name] = value), null);
        return this.outer.put(name, value);
    };

    Environment.prototype.del = function(name) {
        if (this.hasBinding(name))
            return new Completion('normal', new Result(delete this.bindings[name]), null);
        if (!this.outer)
            return new Completion('throw', new Result(true), null);
        return this.outer.del(name);
    };

    Environment.prototype.hasBinding = function(name) {
        return name in this.bindings;
    };

    Environment.prototype.addBinding = function(name, value) {
        this.bindings[name] = value;
    };

    Environment.prototype.isUnresolvable = function(name) {
        if (this.hasBinding(name))
            return false;
        return !this.outer || this.outer.isUnresolvable(name);
    };

    /** The global environment. */
    var globalEnv = new Environment(null, globalObj);

    /** Annotate every loop in a subtree with its set of labels. */
    Evaluator.prototype.annotateWithLabels = function(ast) {
        var self = this;

        function record(nd, ancestors) {
            nd.labels = [null];
            for (var n=ancestors.length, i=n-2; i>=0 && ancestors[i].type === 'LabeledStatement'; --i)
                self.push(nd.labels, ancestors[i].label.name);
        }

        walk.ancestor(ast, {
            'DoWhileStatement': record,
            'ForInStatement': record,
            'ForStatement': record,
            'SwitchStatement': record,
            'WhileStatement': record
        });
    }

    /** Declaration binding instantiation. */
    Evaluator.prototype.instantiateDeclBindings = function(ctxt, nd) {
        var self = this;

        function doit(nd) {
            switch (nd && nd.type) {
            case 'FunctionDeclaration':
                ctxt.variableEnvironment.addBinding(nd.id.name, self.ev(ctxt, nd).result.value);
                break;
            case 'VariableDeclarator':
                ctxt.variableEnvironment.addBinding(nd.id.name);
                break;
            case 'VariableDeclaration':
                self.forEach(nd.declarations, doit);
                break;
            case 'Program':
            case 'BlockStatement':
                self.forEach(nd.body, doit);
                break;
            case 'WhileStatement':
            case 'DoWhileStatement':
            case 'CatchClause':
            case 'LabeledStatement':
                doit(nd.body);
                break;
            case 'ForInStatement':
                doit(nd.left);
                doit(nd.body);
                break;
            case 'ForStatement':
                doit(nd.init);
                doit(nd.body);
                break;
            case 'TryStatement':
                doit(nd.block);
                self.forEach(nd.handlers||[], doit);
                doit(nd.handler);
                doit(nd.finalizer);
                break;
            case 'IfStatement':
                doit(nd.consequent);
                doit(nd.alternate);
                break;
            case 'SwitchStatement':
                self.forEach(nd.cases, doit);
                break;
            case 'SwitchCase':
                self.forEach(nd.consequent, doit);
                break;
            }
        }

        doit(nd);
    }

    /** Implementations of operators. */
    var binop = {
            '+': function(x, y) { return x+y; },
            '-': function(x, y) { return x-y; },
            '*': function(x, y) { return x*y; },
            '/': function(x, y) { return x/y; },
            '%': function(x, y) { return x%y; },
            '>>': function(x, y) { return x>>y; },
            '>>>': function(x, y) { return x>>>y; },
            '<<': function(x, y) { return x<<y; },
            '&': function(x, y) { return x&y; },
            '|': function(x, y) { return x|y; },
            '^': function(x, y) { return x^y; },
            '==': function(x, y) { return x==y; },
            '===': function(x, y) { return x===y; },
            '!=': function(x, y) { return x!=y; },
            '!==': function(x, y) { return x!==y; },
            '>': function(x, y) { return x>y; },
            '<': function(x, y) { return x<y; },
            '>=': function(x, y) { return x>=y; },
            '<=': function(x, y) { return x<=y; },
            'instanceof': function(x, y) { return x instanceof y; },
            'in': function(x, y) { return x in y; }
        },
        unop = {
            '+': function(x) { return +x; },
            '-': function(x) { return -x; },
            '!': function(x) { return !x; },
            '~': function(x) { return ~x; },
            'void': function(x) { return void(x); }
        };
    Evaluator.binop = binop;
    Evaluator.unop = unop;

    /** Completions. */
    function Completion(type, result, target) {
        this.type = type; // 'normal', 'throw', 'return', 'continue', 'break'
        this.result = result; // null or a Result
        this.target = target; // null or an identifier
    }

    /** Results are simply wrappers around values. */
    function Result(v) {
        this.value = v;
    }

    /** A property reference. */
    function PropRef(base, prop) {
        this.base = base;
        this.prop = prop;
    }

    PropRef.prototype.get = function() {
        try {
            return new Completion('normal', new Result(this.base[this.prop]), null);
        } catch(e) {
            return new Completion('throw', new Result(e), null);
        }
    };

    PropRef.prototype.set = function(v) {
        try {
            return new Completion('normal', new Result(this.base[this.prop] = v), null);
        } catch(e) {
            return new Completion('throw', new Result(e), null);
        }
    };

    PropRef.prototype.del = function() {
        try {
            return new Completion('normal', new Result(delete this.base[this.prop]), null);
        } catch(e) {
            return new Completion('throw', new Result(e), null);
        }
    };

    PropRef.prototype.isUnresolvable = function() {
        return this.base === null || this.base === void(0);
    };

    /** A variable reference. */
    function VarRef(env, name) {
        this.env = env;
        this.name = name;
    }
    VarRef.prototype.get = function() { return this.env.get(this.name); };
    VarRef.prototype.set = function(v) { return this.env.put(this.name, v); };
    VarRef.prototype.del = function() { return this.env.del(this.name); };
    VarRef.prototype.isUnresolvable = function() { return this.env.isUnresolvable(this.name); };

    /**
     * Evaluate a sequence of statements (or, in fact, expressions), and return the completion
     * of the last one.
     */
    Evaluator.prototype.evseq = function(ctxt, stmts, result) {
        var completion = new Completion('normal', null, null);
        for (var i=0, n=stmts.length; i<n; ++i) {
            completion = this.ev(ctxt, stmts[i]);
            if (completion.type !== 'normal')
                return completion;
            result = completion.result || result;
        }
        completion.result = result;
        return completion;
    }

    /** Evaluate a reference. */
    Evaluator.prototype.evref = function(ctxt, nd) {
        var completion;
        if (nd.type === 'MemberExpression') {
            var base, prop;
            completion = this.ev(ctxt, nd.object);
            if (completion.type !== 'normal')
                return completion;
            base = completion.result.value;
            if (base === null || base === void(0))
                return new Completion('throw', new Result(new TypeError()), null);
            if (nd.computed) {
                completion = this.ev(ctxt, nd.property);
                if (completion.type !== 'normal')
                    return completion;
                prop = String(completion.result.value);
            } else {
                prop = String(nd.property.name);
            }
            return new Completion('normal', new Result(new PropRef(base, prop)), null);
        } else if (nd.type === 'VariableDeclaration') {
            return this.evref(ctxt, nd.declarations[0].id);
        } else if (nd.type === 'Identifier') {
            return new Completion('normal', new Result(new VarRef(ctxt.lexicalEnvironment, nd.name)), null);
        } else {
            throw new Error("Bad reference: " + nd.type);
        }
    }

    /** Evaluate a statement, an expression, or an entire program. */
    Evaluator.prototype.ev = function(ctxt, nd) {
        if (typeof nd === 'string') {
            try {
                nd = acorn.parse(nd, { forbidReserved: true });
            } catch (e) {
                if (e instanceof SyntaxError) {
                    if (e.message.indexOf("Assigning to rvalue") >= 0)
                        return new Completion('throw', new Result(new ReferenceError()), null);
                    return new Completion('throw', new Result(e), null);
                }
                throw e;
            }
        }

        return this[nd.type](ctxt, nd, Evaluator.prototype[nd.type]);
    };

    Evaluator.prototype.Program = function(ctxt, nd) {
        this.annotateWithLabels(nd);
        ctxt = new ExecutionContext(globalEnv, globalObj);
        this.instantiateDeclBindings(ctxt, nd);
        return this.evseq(ctxt, nd.body);
    };

    Evaluator.prototype.DebuggerStatement = function(ctxt, nd) {
        debugger;
        return new Completion('normal', null, null);
    };

    Evaluator.prototype.ReturnStatement = function(ctxt, nd) {
        var completion;
        if (nd.argument) {
            completion = this.ev(ctxt, nd.argument);
            if (completion.type === 'normal')
                completion.type = 'return';
        } else {
            completion = new Completion('return', new Result(), null);
        }
        return completion;
    };

    Evaluator.prototype.EmptyStatement = function(ctxt, nd) {
        return new Completion('normal', null, null);
    };

    Evaluator.prototype.ThrowStatement = function(ctxt, nd) {
        var completion = this.ev(ctxt, nd.argument);
        completion.type = 'throw';
        return completion;
    };

    Evaluator.prototype.IfStatement =
    Evaluator.prototype.ConditionalExpression = function(ctxt, nd) {
        var completion = this.ev(ctxt, nd.test);
        if (completion.type !== 'normal')
            return completion;
        if (!!completion.result.value)
            return this.ev(ctxt, nd.consequent);
        if (nd.alternate)
            return this.ev(ctxt, nd.alternate);
        return new Completion('normal', null, null);
    };

    Evaluator.prototype.SwitchStatement = function (ctxt, nd) {
        var completion = this.ev(ctxt, nd.discriminant);
        if (completion.type !== 'normal')
            return completion;
        var discr = completion.result.value;
        for (var i = 0, n = nd.cases.length, deflt = n; i < n; ++i) {
            var cse = nd.cases[i];
            if (!cse.test) {
                deflt = i;
            } else {
                completion = this.ev(ctxt, cse.test);
                if (completion.type !== 'normal')
                    return completion;
                if (discr === completion.result.value)
                    break;
            }
        }
        if (i === n)
            i = deflt;

        completion.result = null;
        for (; i < n; ++i) {
            completion = this.evseq(ctxt, nd.cases[i].consequent, completion.result);
            if (completion.type === 'break' && !completion.target) {
                completion.type === 'normal';
                break;
            } else if (completion.type !== 'normal') {
                return completion;
            }
        }
        return completion;
    };

    Evaluator.prototype.WhileStatement = function (ctxt, nd) {
        var completion,
            result = null;
        for (;;) {
            completion = this.ev(ctxt, nd.test);
            if (completion.type !== 'normal')
                return completion;
            if (!completion.result.value)
                return new Completion('normal', result, null);
            completion = this.ev(ctxt, nd.body);
            result = completion.result || result;
            if (completion.type !== 'continue' || !this.contains(nd.labels, completion.target))
                if (completion.type === 'break' && this.contains(nd.labels, completion.target))
                    return new Completion('normal', result, null);
                else if (completion.type !== 'normal')
                    return completion;
        }
    };

    Evaluator.prototype.DoWhileStatement = function (ctxt, nd) {
        var completion,
            result = null;

        do {
            completion = this.ev(ctxt, nd.body);
            result = completion.result || result;
            if (completion.type !== 'continue' || !this.contains(nd.labels, completion.target))
                if (completion.type === 'break' && this.contains(nd.labels, completion.target))
                    break;
                else if (completion.type !== 'normal')
                return completion;
            completion = this.ev(ctxt, nd.test);
            if (completion.type !== 'normal')
                return completion;
        } while (!!completion.result.value);
        return new Completion('normal', result, null);
    };

    Evaluator.prototype.ForStatement = function (ctxt, nd) {
        var completion,
            result = null;

        if (nd.init) {
            completion = this.ev(ctxt, nd.init)
            if (completion.type !== 'normal')
                return completion;
        }

        for (;;) {
            if (nd.test) {
                completion = this.ev(ctxt, nd.test);
                if (completion.type !== 'normal')
                    return completion;
                if (!completion.result.value)
                    return new Completion('normal', result, null);
            }
            completion = this.ev(ctxt, nd.body);
            result = completion.result || result;
            if (completion.type !== 'continue' || !this.contains(nd.labels, completion.target))
                if (completion.type === 'break' && this.contains(nd.labels, completion.target))
                    return new Completion('normal', result, null);
                else if (completion.type !== 'normal')
                return completion;

            if (nd.update) {
                completion = this.ev(ctxt, nd.update);
                if (completion.type !== 'normal')
                    return completion;
            }
        }
    };

    Evaluator.prototype.ForInStatement = function (ctxt, nd) {
        var completion = null,
            result = null,
            dom;

        completion = this.ev(ctxt, nd.right);
        if (completion.type !== 'normal')
            return completion;
        if (completion.result.value === null || completion.result.value === void(0))
            return new Completion('normal', null, null);
        dom = Object(completion.result.value);

        for (var p in dom) {
            completion = this.evref(ctxt, nd.left);
            if (completion.type !== 'normal')
                return completion;
            completion.result.value.set(p)
            completion = this.ev(ctxt, nd.body);
            result = completion.result || result;
            if (completion.type !== 'continue' || !this.contains(nd.labels, completion.target))
                if (completion.type === 'break' && this.contains(nd.labels, completion.target))
                    break;
                else if (completion.type !== 'normal')
                return completion;
        }
        return new Completion('normal', result, null);
    };

    Evaluator.prototype.BreakStatement = function (ctxt, nd) {
        return new Completion('break', null, nd.label && nd.label.name);
    };

    Evaluator.prototype.ContinueStatement = function (ctxt, nd) {
        return new Completion('continue', null, nd.label && nd.label.name);
    };

    Evaluator.prototype.ExpressionStatement = function (ctxt, nd) {
        return this.ev(ctxt, nd.expression);
    };

    Evaluator.prototype.BlockStatement = function (ctxt, nd) {
        return this.evseq(ctxt, nd.body);
    };

    Evaluator.prototype.VariableDeclaration = function (ctxt, nd) {
        return this.evseq(ctxt, nd.declarations);
    };

    Evaluator.prototype.LabeledStatement = function (ctxt, nd) {
        var completion = this.ev(ctxt, nd.body);
        if (completion.type === 'break' && completion.target === nd.label.id) {
            completion.type === 'normal';
            completion.target = null;
        }
        return completion;
    };

    Evaluator.prototype.TryStatement = function (ctxt, nd) {
        var completion = this.ev(ctxt, nd.block);

        if (completion.type === 'throw' && nd.handler) {
            var oldEnv = ctxt.lexicalEnvironment;
            ctxt.lexicalEnvironment = new Environment(oldEnv);
            ctxt.lexicalEnvironment.addBinding(nd.handler.param.name, completion.result.value);
            completion = this.ev(ctxt, nd.handler.body);
            ctxt.lexicalEnvironment = oldEnv;
        }

        if (nd.finalizer) {
            var fin_completion = this.ev(ctxt, nd.finalizer);
            if (fin_completion.type !== 'normal')
                completion = fin_completion;
        }

        return completion;
    };

    Evaluator.prototype.WithStatement = function (ctxt, nd) {
        var completion = this.ev(ctxt, nd.object);
        if (completion.type !== 'normal')
            return completion;
        if (completion.result.value === null || completion.result.value === void(0))
            return new Completion('throw', new Result(new TypeError()), null);

        var oldEnv = ctxt.lexicalEnvironment;
        ctxt.lexicalEnvironment = new Environment(oldEnv, Object(completion.result.value));
        completion = this.ev(ctxt, nd.body);
        ctxt.lexicalEnvironment = oldEnv;
        return completion;
    };

    Evaluator.prototype.FunctionDeclaration =
    Evaluator.prototype.FunctionExpression = function (ctxt, nd) {
        var fn_name = nd.id ? nd.id.name : "",
            self = this,
            fn_param_names = this.map(nd.params, function (param) {
                return param.name;
            }),
            fn = eval("(function " + fn_name + " (" + this.join(fn_param_names, ", ") + ") {\n" +
                "   return thunk(this, arguments);\n" +
                "})");

        function thunk(thiz, args) {
            var new_env = new Environment(ctxt.lexicalEnvironment),
                new_ctxt = new ExecutionContext(new_env, thiz);
            if (nd.type === 'FunctionExpression' && fn_name)
                new_env.addBinding(fn_name, fn);
            self.forEach(fn_param_names, function (param, i) {
                new_env.addBinding(param, args[i]);
            });
            self.instantiateDeclBindings(new_ctxt, nd.body);
            if (!new_env.hasBinding('arguments'))
                new_env.addBinding('arguments', args);
            var completion = self.ev(new_ctxt, nd.body);
            if (completion.type === 'throw')
                throw completion.result.value;
            else if (completion.type === 'return' && completion.result)
                return completion.result.value;
            else
                return void(0);
        }
        return new Completion('normal', new Result(fn), null);
    };

    Evaluator.prototype.Literal = function (ctxt, nd) {
        return new Completion('normal', new Result(nd.value), null);
    };

    Evaluator.prototype.ThisExpression = function (ctxt, nd) {
        return new Completion('normal', new Result(ctxt.thisBinding), null);
    };

    Evaluator.prototype.Identifier =
    Evaluator.prototype.MemberExpression = function (ctxt, nd) {
        var completion = this.evref(ctxt, nd);
        if (completion.type !== 'normal')
            return completion;
        return completion.result.value.get();
    };

    Evaluator.prototype.ArrayExpression = function (ctxt, nd) {
        var elts = [],
            completion;

        for (var i = 0, n = nd.elements.length; i < n; ++i) {
            if (nd.elements[i]) {
                completion = this.ev(ctxt, nd.elements[i]);
                if (completion.type !== 'normal')
                    return completion;
                elts[i] = completion.result.value;
            }
        }

        return new Completion('normal', new Result(elts), null);
    };

    Evaluator.prototype.ObjectExpression = function (ctxt, nd) {
        var obj = Object_create(Object_prototype);

        for (var i = 0, n = nd.properties.length; i < n; ++i) {
            var prop = nd.properties[i],
                completion, name;
            completion = this.ev(ctxt, prop.value);
            if (completion.type !== 'normal')
                return completion;
            if (prop.key.type === 'Literal')
                name = String(prop.key.value);
            else
                name = prop.key.name;
            if (prop.kind === 'init') {
                obj[name] = completion.result.value;
            } else if (prop.kind === 'get') {
                this.defineGetter(obj, name, completion.result.value);
            } else {
                this.defineSetter(obj, name, completion.result.value);
            }
        }

        return new Completion('normal', new Result(obj), null);
    };

    Evaluator.prototype.CallExpression =
    Evaluator.prototype.NewExpression = function (ctxt, nd) {
        var completion, base = globalObj,
            callee, args;

        if (nd.type === 'CallExpression' && nd.callee.type === 'MemberExpression') {
            completion = this.evref(ctxt, nd.callee);
            if (completion.type !== 'normal')
                return completion;
            base = completion.result.value.base;
            if (base === null || base === void(0))
                return new Completion('throw', new Result(new ReferenceError()), null);
            base = Object(base);

            completion = completion.result.value.get();
            if (completion.type !== 'normal')
                return completion;
            callee = completion.result.value;
        } else {
            completion = this.ev(ctxt, nd.callee);
            if (completion.type !== 'normal')
                return completion;
            callee = completion.result.value;
        }

        args = [];
        for (var i = 0, n = nd.arguments.length; i < n; ++i) {
            completion = this.ev(ctxt, nd.arguments[i]);
            if (completion.type !== 'normal')
                return completion;
            args[i] = completion.result.value;
        }

        if (nd.type === 'CallExpression' && callee === eval) {
            if (typeof args[0] !== 'string')
                return new Completion('normal', new Result(args[0]), null);
            try {
                var prog = acorn.parse(args[0], { forbidReserved: true });

                if (nd.callee.type === 'Identifier' && nd.callee.name === 'eval') {
                    return this.evseq(ctxt, prog.body);
                } else {
                    return this.ev(null, prog);
                }
            } catch (e) {
                return new Completion('throw', new Result(e), null);
            }
        }

        try {
            var v;
            if (nd.type === 'CallExpression') {
                v = this.apply(callee, base, args);
            } else {
                v = this.construct(callee, args);
            }
            return new Completion('normal', new Result(v), null);
        } catch (e) {
            return new Completion('throw', new Result(e), null);
        }
    };

    Evaluator.prototype.BinaryExpression = function (ctxt, nd) {
        var completion, l, r;

        completion = this.ev(ctxt, nd.left);
        if (completion.type !== 'normal')
            return completion;
        l = completion.result.value;

        completion = this.ev(ctxt, nd.right);
        if (completion.type !== 'normal')
            return completion;
        r = completion.result.value;

        return new Completion('normal', new Result(binop[nd.operator](l, r)), null);
    };

    Evaluator.prototype.UnaryExpression = function(ctxt, nd) {
        var completion;

        switch (nd.operator) {
        case 'delete':
            if (nd.argument.type === 'Identifier' ||
                nd.argument.type === 'MemberExpression') {
                completion = this.evref(ctxt, nd.argument);
                if (completion.type !== 'normal')
                    return completion;
                return completion.result.value.del();
            } else {
                completion = this.ev(ctxt, nd.argument);
                if (completion.type !== 'normal')
                    return completion;
                return new Completion('normal', new Result(true), null);
            }
        case 'typeof':
            if (nd.argument.type === 'Identifier' ||
                nd.argument.type === 'MemberExpression') {
                completion = this.evref(ctxt, nd.argument);
                if (completion.type !== 'normal')
                    return completion;
                if (completion.result.value.isUnresolvable())
                    return new Completion('normal', new Result('undefined'), null);
                completion = completion.result.value.get();
                if (completion.type !== 'normal')
                    return completion;
                return new Completion('normal', new Result(typeof completion.result.value), null);
            } else {
                completion = this.ev(ctxt, nd.argument);
                if (completion.type !== 'normal')
                    return completion;
                return new Completion('normal', new Result(typeof completion.result.value), null);
            }
        default:
            completion = this.ev(ctxt, nd.argument);
            if (completion.type !== 'normal')
                return completion;
            return new Completion('normal', new Result(unop[nd.operator](completion.result.value)), null);
        }
    };

    Evaluator.prototype.LogicalExpression = function(ctxt, nd) {
        var completion;

        if (nd.operator === '&&') {
            completion = this.ev(ctxt, nd.left);
            if (completion.type !== 'normal' || !completion.result.value)
                return completion;
            return this.ev(ctxt, nd.right);
        } else {
            completion = this.ev(ctxt, nd.left);
            if (completion.type === 'normal' && !!completion.result.value)
                return completion;
            return this.ev(ctxt, nd.right);
        }
    };

    Evaluator.prototype.SequenceExpression = function(ctxt, nd) {
        return this.evseq(ctxt, nd.expressions);
    };

    Evaluator.prototype.VariableDeclarator = function(ctxt, nd) {
        var completion;

        if (nd.init) {
            completion = this.ev(ctxt, nd.init);
            if (completion.type !== 'normal')
                return completion;
            ctxt.lexicalEnvironment.put(nd.id.name, completion.result.value);
        }
        return new Completion('normal', new Result(nd.id.name), null);
    };

    Evaluator.prototype.AssignmentExpression = function(ctxt, nd) {
        var completion, lhs, rhs;
        completion = this.evref(ctxt, nd.left);
        if (completion.type !== 'normal')
            return completion;
        lhs = completion.result.value;
        completion = this.ev(ctxt, nd.right);
        if (completion.type !== 'normal')
            return completion;
        rhs = completion.result.value;

        if (nd.operator === '=') {
            return lhs.set(rhs);
        } else {
            var op = this.substring(nd.operator, 0, nd.operator.length-1);
            completion = lhs.get();
            if (completion.type !== 'normal')
                return completion;
            return lhs.set(binop[op](completion.result.value, rhs));
        }
    };

    Evaluator.prototype.UpdateExpression = function(ctxt, nd) {
        var completion, ref, oldval;
        completion = this.evref(ctxt, nd.argument);
        if (completion.type !== 'normal')
            return completion;
        var ref = completion.result.value;
        completion = ref.get();
        if (completion.type !== 'normal')
            return completion;
        oldval = +completion.result.value;
        completion = ref.set(binop[nd.operator[0]](oldval, 1));
        if (completion.type !== 'normal')
            return completion;
        if (!nd.prefix)
            completion.result.value = oldval;
        return completion;
    };

    exports.Evaluator = Evaluator;
    exports.Completion = Completion;
    exports.Result = Result;
}(typeof exports === 'undefined' ? (esmint = {}) : exports));
