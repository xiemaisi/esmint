/**
 * The evaluator itself.
 */

var util = require('./util'),
  eval = util.eval,
  acorn = require('acorn'),
  walk = require('acorn/dist/walk'),
  ExecutionContext = require('./ExecutionContext'),
  Environment = require('./Environment'),
  completions = require('./completions'),
  Completion = completions.Completion, Result = completions.Result,
  references = require('./references'),
  VarRef = references.VarRef, PropRef = references.PropRef,
  operators = require('./operators'),
  unop = operators.unop, binop = operators.binop;

function parse(src, isStrict) {
  var p = new acorn.Parser({}, src);
  if (isStrict)
    p.strict = true;
  return p.parse();
}

function useStrict(stmts) {
  for (var i=0; i<stmts.length; ++i) {
    var stmt = stmts[i];
    if (stmt.type !== 'ExpressionStatement')
      return false;
    if (stmt.expression.type !== 'Literal')
      return false;
    if (stmt.expression.raw === '"use strict"' ||
        stmt.expression.raw === "'use strict'")
      return true;
  }
  return false;
}

/** The global environment. */
var globalEnv = new Environment(null, util.globalObj);

function Evaluator() {}

Evaluator.prototype.hooks = require('./hooks').defaultHooks;

Evaluator.prototype.applyHook = function(completion, hook, nd) {
  var r = this.hooks[hook](nd, completion.result.value);
  if (r)
    completion.result.value = r.result;
  return completion;
};

/** Annotate every loop in a subtree with its set of labels. */
Evaluator.prototype.annotateWithLabels = function(ast) {
  var self = this;

  function record(nd, ancestors) {
    nd.labels = [null];
    for (var n = ancestors.length, i = n - 2; i >= 0 && ancestors[i].type === 'LabeledStatement'; --i)
      util.push(nd.labels, ancestors[i].label.name);
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
Evaluator.prototype.instantiateDeclBindings = function(ctxt, nd, configurable) {
  var self = this;

  function doit(nd) {
    switch (nd && nd.type) {
      case 'FunctionDeclaration':
        var fn = self.ev(ctxt, nd).result.value;
        var h = self.hooks.declare(nd, nd.id.name, fn, false, -1, false);
        if (h) {
          fn = h.result;
        }
        ctxt.variableEnvironment.addBinding(nd.id.name, fn, configurable);
        break;
      case 'VariableDeclarator':
        self.hooks.declare(nd, nd.id.name, void(0), false, -1, false);
        ctxt.variableEnvironment.addBinding(nd.id.name, void(0), configurable);
        break;
      case 'VariableDeclaration':
        util.forEach(nd.declarations, doit);
        break;
      case 'Program':
      case 'BlockStatement':
        util.forEach(nd.body, doit);
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
        util.forEach(nd.handlers || [], doit);
        doit(nd.handler);
        doit(nd.finalizer);
        break;
      case 'IfStatement':
        doit(nd.consequent);
        doit(nd.alternate);
        break;
      case 'SwitchStatement':
        util.forEach(nd.cases, doit);
        break;
      case 'SwitchCase':
        util.forEach(nd.consequent, doit);
        break;
    }
  }

  doit(nd);
}

/**
 * Evaluate a sequence of statements (or, in fact, expressions), and return the completion
 * of the last one.
 */
Evaluator.prototype.evseq = function(ctxt, stmts, result) {
  var completion = new Completion('normal', null, null);
  for (var i = 0, n = stmts.length; i < n; ++i) {
    completion = this.ev(ctxt, stmts[i]);
    if (completion.type !== 'normal')
      return completion;
    result = completion.result || result;
  }
  completion.result = result;
  return completion;
}

/** Evaluate an expression as a reference. */
Evaluator.prototype.evref = function(ctxt, nd) {
  var completion;
  if (nd.type === 'MemberExpression') {
    var base, prop;
    completion = this.ev(ctxt, nd.object);
    if (completion.type !== 'normal')
      return completion;
    base = completion.result.value;
    if (base === null || base === void(0))
      return new Completion('throw', new Result(new util.TypeError()), null);
    if (nd.computed) {
      completion = this.ev(ctxt, nd.property);
      if (completion.type !== 'normal')
        return completion;
      prop = util.String(completion.result.value);
    } else {
      prop = util.String(nd.property.name);
    }
    return new Completion('normal', new Result(new PropRef(this, base, prop, ctxt.strict)), null);
  } else if (nd.type === 'VariableDeclaration') {
    return this.evref(ctxt, nd.declarations[0].id);
  } else if (nd.type === 'Identifier') {
    return new Completion('normal', new Result(new VarRef(this, ctxt.lexicalEnvironment, nd.name, ctxt.strict)), null);
  } else {
    throw new util.Error("Bad reference: " + nd.type);
  }
}

/** Evaluate a statement, an expression, or an entire program. */
Evaluator.prototype.ev = function(ctxt, nd) {
  if (typeof nd === 'string') {
    try {
      nd = parse(nd, ctxt && ctxt.strict);
    } catch (e) {
      if (e instanceof SyntaxError) {
        // Acorn treats this as a syntax error, but it should be a ReferenceError
        if (e.message.indexOf("Assigning to rvalue") >= 0)
          return new Completion('throw', new Result(new util.ReferenceError()), null);
        return new Completion('throw', new Result(e), null);
      }
      throw e;
    }
  }

  // invoke visitor method, passing context and node
  return this[nd.type](ctxt, nd);
};

Evaluator.prototype.Program = function(ctxt, nd) {
  this.annotateWithLabels(nd);
  ctxt = new ExecutionContext(globalEnv, util.globalObj, useStrict(nd.body), ctxt && ctxt.isEvalCode);
  this.instantiateDeclBindings(ctxt, nd, ctxt.isEvalCode);
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
  if (completion.type === 'return')
    this.applyHook(completion, '_return', nd);
  return completion;
};

Evaluator.prototype.EmptyStatement = function(ctxt, nd) {
  return new Completion('normal', null, null);
};

Evaluator.prototype.ThrowStatement = function(ctxt, nd) {
  var completion = this.ev(ctxt, nd.argument);
  completion.type = 'throw';
  this.applyHook(completion, '_throw', nd);
  return completion;
};

Evaluator.prototype.IfStatement =
Evaluator.prototype.ConditionalExpression = function(ctxt, nd) {
    var completion = this.ev(ctxt, nd.test);
    if (completion.type !== 'normal')
      return completion;
    this.applyHook(completion, 'conditional', nd.test);
    if (!!completion.result.value)
      return this.ev(ctxt, nd.consequent);
    if (nd.alternate)
      return this.ev(ctxt, nd.alternate);
    return new Completion('normal', null, null);
  };

Evaluator.prototype.SwitchStatement = function(ctxt, nd) {
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

      var op = '===',
          l = discr,
          r = completion.result.value;
      var h = this.hooks.binaryPre(nd, op, l, r, false, true, false);
      if (h) {
        op = h.op;
        l = h.left;
        r = h.right;
      }
      var res = binop[op](l, r);
      h = this.hooks.binary(nd, op, l, r, res, false, false, false);
      if (h) {
        res = h.res;
      }

      completion.result.value = res;
      this.applyHook(completion, 'conditional', cse.test);
      if (completion.result.value)
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

Evaluator.prototype.WhileStatement = function(ctxt, nd) {
  var completion,
      result = null;
  for (;;) {
    completion = this.ev(ctxt, nd.test);
    if (completion.type !== 'normal')
      return completion;
    this.applyHook(completion, 'conditional', nd.test);
    if (!completion.result.value)
      return new Completion('normal', result, null);
    completion = this.ev(ctxt, nd.body);
    result = completion.result || result;
    if (completion.type !== 'continue' || !util.contains(nd.labels, completion.target))
      if (completion.type === 'break' && util.contains(nd.labels, completion.target))
        return new Completion('normal', result, null);
      else if (completion.type !== 'normal')
        return completion;
  }
};

Evaluator.prototype.DoWhileStatement = function(ctxt, nd) {
  var completion,
      result = null;

  do {
    completion = this.ev(ctxt, nd.body);
    result = completion.result || result;
    if (completion.type !== 'continue' || !util.contains(nd.labels, completion.target))
      if (completion.type === 'break' && util.contains(nd.labels, completion.target))
        break;
      else if (completion.type !== 'normal')
        return completion;
    completion = this.ev(ctxt, nd.test);
    if (completion.type !== 'normal')
      return completion;
    this.applyHook(completion, 'conditional', nd.test);
  } while (!!completion.result.value);

  return new Completion('normal', result, null);
};

Evaluator.prototype.ForStatement = function(ctxt, nd) {
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
      this.applyHook(completion, 'conditional', nd.test);
      if (!completion.result.value)
        return new Completion('normal', result, null);
    }

    completion = this.ev(ctxt, nd.body);
    result = completion.result || result;

    if (completion.type !== 'continue' || !util.contains(nd.labels, completion.target))
      if (completion.type === 'break' && util.contains(nd.labels, completion.target))
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

Evaluator.prototype.ForInStatement = function(ctxt, nd) {
  var completion = null, result = null, dom;

  completion = this.ev(ctxt, nd.right);
  if (completion.type !== 'normal')
    return completion;
  this.applyHook(completion, 'forinObject', nd.right);
  if (completion.result.value === null || completion.result.value === void(0))
    return new Completion('normal', null, null);
  dom = util.Object(completion.result.value);

  for (var p in dom) {
    completion = this.evref(ctxt, nd.left);
    if (completion.type !== 'normal')
      return completion;
    completion.result.value.set(p)
    completion = this.ev(ctxt, nd.body);
    result = completion.result || result;
    if (completion.type !== 'continue' || !util.contains(nd.labels, completion.target))
      if (completion.type === 'break' && util.contains(nd.labels, completion.target))
        break;
      else if (completion.type !== 'normal')
        return completion;
  }

  return new Completion('normal', result, null);
};

Evaluator.prototype.BreakStatement = function(ctxt, nd) {
  return new Completion('break', null, nd.label && nd.label.name);
};

Evaluator.prototype.ContinueStatement = function(ctxt, nd) {
  return new Completion('continue', null, nd.label && nd.label.name);
};

Evaluator.prototype.ExpressionStatement = function(ctxt, nd) {
  var completion = this.ev(ctxt, nd.expression);
  this.hooks.endExpression(nd);
  return completion;
};

Evaluator.prototype.BlockStatement = function(ctxt, nd) {
  return this.evseq(ctxt, nd.body);
};

Evaluator.prototype.VariableDeclaration = function(ctxt, nd) {
  var completion = this.evseq(ctxt, nd.declarations);
  if (completion.type !== 'normal')
    return completion;
  return new Completion('normal', new Result(), null);
};

Evaluator.prototype.LabeledStatement = function(ctxt, nd) {
  var completion = this.ev(ctxt, nd.body);
  if (completion.type === 'break' && completion.target === nd.label.id) {
    completion.type === 'normal';
    completion.target = null;
  }
  return completion;
};

Evaluator.prototype.TryStatement = function(ctxt, nd) {
  var completion = this.ev(ctxt, nd.block);

  if (completion.type === 'throw' && nd.handler) {
    var oldEnv = ctxt.lexicalEnvironment;
    ctxt.lexicalEnvironment = new Environment(oldEnv);
    var exn = completion.result.value;
    var h = this.hooks.declare(nd.handler, nd.handler.param.name, exn, false, -1, true);
    if (h) {
      exn = h.result;
    }
    ctxt.lexicalEnvironment.addBinding(nd.handler.param.name, exn);
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

Evaluator.prototype.WithStatement = function(ctxt, nd) {
  var completion = this.ev(ctxt, nd.object);
  if (completion.type !== 'normal')
    return completion;
  this.applyHook(completion, '_with', nd.object);
  if (completion.result.value === null || completion.result.value === void(0))
    return new Completion('throw', new Result(new util.TypeError()), null);

  var oldEnv = ctxt.lexicalEnvironment;
  ctxt.lexicalEnvironment = new Environment(oldEnv, util.Object(completion.result.value));
  completion = this.ev(ctxt, nd.body);
  ctxt.lexicalEnvironment = oldEnv;
  return completion;
};

Evaluator.prototype.FunctionDeclaration =
Evaluator.prototype.FunctionExpression = function(ctxt, nd) {
    var fn_name = nd.id ? nd.id.name : "",
      self = this,
      strict = ctxt.strict || useStrict(nd.body.body),
      isEvalCode = ctxt.isEvalCode,
      fn_param_names = util.map(nd.params, function(param) {
        return param.name;
      }),
      fn = eval("(function " + fn_name + " (" + util.join(fn_param_names, ", ") + ") {\n" +
        "   return thunk(this, arguments);\n" +
        "})");

    function thunk(thiz, args) {
      self.hooks.functionEnter(nd, fn, thiz, args);
      while (true) {
        var isBacktrack = false;
        var new_env = new Environment(ctxt.lexicalEnvironment),
            new_ctxt = new ExecutionContext(new_env, thiz, strict, isEvalCode);
        if (nd.type === 'FunctionExpression' && fn_name) {
          var h = self.hooks.declare(nd, fn_name, fn, false, -1, false);
          if (h) {
            fn = h.result;
          }
          new_env.addBinding(fn_name, fn);
        }
        util.forEach(fn_param_names, function(param, i) {
          var arg = args[i];
          var h = self.hooks.declare(nd, param, arg, true, i, false);
          if (h) {
            arg = h.result;
          }
          new_env.addBinding(param, arg);
        });
        self.instantiateDeclBindings(new_ctxt, nd.body, ctxt.isEvalCode);
        if (!new_env.hasBinding('arguments')) {
          var h = self.hooks.declare(nd, 'arguments', args, true, -1, false);
          if (h) {
            args = h.result;
          }
          new_env.addBinding('arguments', args);
        }

        var completion = self.ev(new_ctxt, nd.body);

        var returnVal = completion.type === 'return' && completion.result ? completion.result.value : void(0);
        var wrappedExceptionVal = completion.type === 'throw' ? {
          exception: completion.result.value
        } : void(0);
        var r = self.hooks.functionExit(nd, returnVal, wrappedExceptionVal);
        if (r) {
          returnVal = r.returnVal;
          wrappedExceptionVal = r.wrappedExceptionVal;
          isBacktrack = !!r.isBacktrack;
        }
        if (!isBacktrack) {
          if (wrappedExceptionVal)
            throw wrappedExceptionVal.exception;
          else
            return returnVal;
        }
      }
    }
    return this.applyHook(new Completion('normal', new Result(fn), null), 'literal', nd, false);
  };

Evaluator.prototype.Literal = function(ctxt, nd) {
  return this.applyHook(new Completion('normal', new Result(nd.value), null), 'literal', nd, false);
};

Evaluator.prototype.ThisExpression = function(ctxt, nd) {
  return new Completion('normal', new Result(ctxt.thisBinding), null);
};

Evaluator.prototype.Identifier =
Evaluator.prototype.MemberExpression = function(ctxt, nd) {
    var completion = this.evref(ctxt, nd);
    if (completion.type !== 'normal')
      return completion;
    return completion.result.value.get();
};

Evaluator.prototype.ArrayExpression = function(ctxt, nd) {
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

  return this.applyHook(new Completion('normal', new Result(elts), null), 'literal', nd, false);
};

Evaluator.prototype.ObjectExpression = function(ctxt, nd) {
  var obj = util.Object_create(util.Object_prototype),
      hasAccessors = false;

  for (var i = 0, n = nd.properties.length; i < n; ++i) {
    var prop = nd.properties[i],
        completion, name;

    completion = this.ev(ctxt, prop.value);
    if (completion.type !== 'normal')
      return completion;

    if (prop.key.type === 'Literal')
      name = util.String(prop.key.value);
    else
      name = prop.key.name;

    if (prop.kind === 'init') {
      obj[name] = completion.result.value;
    } else if (prop.kind === 'get') {
      hasAccessors = true;
      util.defineGetter(obj, name, completion.result.value);
    } else {
      hasAccessors = true;
      util.defineSetter(obj, name, completion.result.value);
    }
  }

  return this.applyHook(new Completion('normal', new Result(obj), null), 'literal', nd, hasAccessors);
};

Evaluator.prototype.CallExpression =
Evaluator.prototype.NewExpression = function(ctxt, nd) {
    var completion, base = util.globalObj,
        callee, args;

    if (nd.type === 'CallExpression' && nd.callee.type === 'MemberExpression') {
      completion = this.evref(ctxt, nd.callee);
      if (completion.type !== 'normal')
        return completion;
      base = completion.result.value.base;
      if (base === null || base === void(0))
        return new Completion('throw', new Result(new util.ReferenceError()), null);
      base = util.Object(base);

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

    var isConstructor = nd.type === 'NewExpression',
        isMethod = nd.callee.type === 'MemberExpression';
    var r = this.hooks.invokeFunPre(nd, callee, base, args, isConstructor, isMethod);
    var skip = false;
    if (r) {
      callee = r.f;
      base = r.base;
      args = r.args;
      skip = r.skip;
    }

    if (skip) {
      completion = new Completion('return', new Result(), null);
    } else {
      if (nd.type === 'CallExpression' && callee === eval) {
        if (typeof args[0] !== 'string')
          return new Completion('normal', new Result(args[0]), null);
        try {
          var isDirect = nd.callee.type === 'Identifier' && nd.callee.name === 'eval';
          var prog = parse(args[0], isDirect && ctxt.strict);

          if (isDirect) {
            var wasEvalCode = ctxt.isEvalCode;
            ctxt.isEvalCode = true;
            completion = this.evseq(ctxt, prog.body);
            ctxt.isEvalCode = wasEvalCode;
          } else {
            completion = this.ev({ isEvalCode: true }, prog);
          }
        } catch (e) {
          completion = new Completion('throw', new Result(e), null);
        }
      } else {
        completion = this.invoke(callee, base, args, isConstructor);
      }
      if (completion.type === 'return') {
        r = this.hooks.invokeFun(nd, callee, base, args, completion.result.value, isConstructor, isMethod);
        if (r)
          completion.result.value = r.result;
      }
    }
    return completion;
};

Evaluator.prototype.invoke = function(callee, base, args, isConstructor) {
  try {
    var v;
    if (isConstructor) {
      v = util.construct(callee, args);
    } else {
      v = util.apply(callee, base, args);
    }
    return new Completion('normal', new Result(v), null);
  } catch (e) {
    return new Completion('throw', new Result(e), null);
  }
};

var lconv = {}, rconv = {};
util.forEach(['*', '/', '%', '-'], function(op) {
  lconv[op] = rconv[op] = 'ToNumber';
});
lconv['+'] = rconv['+'] = 'ToPrimitive';
util.forEach(['<<', '>>'], function(op) {
  lconv[op] = 'ToInt32';
  rconv[op] = 'ToUint32';
});
lconv['>>>'] = rconv['>>>'] = 'ToUint32';
util.forEach(['&', '|', '^'], function(op) {
  lconv[op] = rconv[op] = 'ToInt32';
});

Evaluator.prototype.BinaryExpression = function(ctxt, nd) {
  var completion, op = nd.operator, l, r;

  completion = this.ev(ctxt, nd.left);
  if (completion.type !== 'normal')
    return completion;
  l = completion.result.value;

  completion = this.ev(ctxt, nd.right);
  if (completion.type !== 'normal')
    return completion;
  r = completion.result.value;

  var h = this.hooks.binaryPre(nd, op, l, r, false, false, false);
  if (h) {
    op = h.op;
    l = h.left;
    r = h.right;
  }

  // apply conversions
  if (lconv[op]) {
    completion = this[lconv[op]](l);
    if (completion.type !== 'normal')
      return completion;
    l = completion.result.value;
  }
  if (rconv[op]) {
    completion = this[rconv[op]](r);
    if (completion.type !== 'normal')
      return completion;
    r = completion.result.value;
  }

  // special checks for `in` and `instanceof`
  if (op === 'in' || op === 'instanceof')
    if (this.typeOf(r) !== 'object')
      return new Completion('throw', new Result(new util.TypeError()), null);

  var res = binop[op](l, r);

  h = this.hooks.binary(nd, op, l, r, res, false, false, false);
  if (h) {
    res = h.res;
  }

  return new Completion('normal', new Result(res), null);
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
      // evaluate operand
      completion = this.ev(ctxt, nd.argument);
      if (completion.type !== 'normal')
        return completion;
      var op = nd.operator, arg = completion.result.value;

      var h = this.hooks.unaryPre(nd, op, arg);
      if (h) {
        op = h.op;
        arg = h.left;
      }

      // apply conversion
      var conv = (op === '~' && 'ToInt32' || op === '!' && 'ToBoolean' || 'ToNumber');
      completion = this[conv](arg);
      if (completion.type !== 'normal')
        return completion;
      arg = completion.result.value;

      // evaluate operator
      var res = unop[op](arg);

      h = this.hooks.unary(nd, op, arg, res);
      if (h) {
        res = h.result;
      }

      return new Completion('normal', new Result(res), null);
  }
};

Evaluator.prototype.ToInt32 = function(x) {
  var completion = this.ToNumber(x);
  if (completion.type !== 'normal')
    return completion;
  return new Completion('normal', new Result(completion.result.value|0), null);
};

Evaluator.prototype.ToUint32 = function(x) {
  var completion = this.ToNumber(x);
  if (completion.type !== 'normal')
    return completion;
  return new Completion('normal', new Result(completion.result.value>>>0), null);
};

Evaluator.prototype.ToNumber = function(x) {
  if (this.typeOf(x) !== 'object')
    return new Completion('normal', new Result(+x), null);
  var completion = this.ToPrimitive(x, 'number');
  if (completion.type !== 'normal')
    return completion;
  return new Completion('normal', new Result(+completion.result.value), null);
};

Evaluator.prototype.ToBoolean = function(x) {
  return new Completion('normal', new Result(!!x), null);
};

Evaluator.prototype.ToPrimitive = function(x, preferredType) {
  if (this.typeOf(x) !== 'object')
    return new Completion('normal', new Result(x), null);
  return this.DefaultValue(x, preferredType);
};

Evaluator.prototype.DefaultValue = function(o, preferredType) {
  if (!preferredType)
    preferredType = o instanceof util.Date ? 'string' : 'number';

  var completion;
  if (preferredType === 'string') {
    var toString = new PropRef(this, o, 'toString').get().result.value;
    if (typeof toString === 'function') {
      completion = this.invoke(toString, o, [], false);
      if (completion.type !== 'normal' ||
          this.typeOf(completion.result.value) !== 'object')
        return completion;
    }

    var valueOf = new PropRef(this, o, 'valueOf').get().result.value;
    if (typeof valueOf === 'function') {
      completion = this.invoke(valueOf, o, [], false);
      if (completion.type !== 'normal' ||
          this.typeOf(completion.result.value) !== 'object')
        return completion;
    }
  } else {
    var valueOf = new PropRef(this, o, 'valueOf').get().result.value;
    if (typeof valueOf === 'function') {
      completion = this.invoke(valueOf, o, [], false);
      if (completion.type !== 'normal' ||
          this.typeOf(completion.result.value) !== 'object')
        return completion;
    }

    var toString = new PropRef(this, o, 'toString').get().result.value;
    if (typeof toString === 'function') {
      completion = this.invoke(toString, o, [], false);
      if (completion.type !== 'normal' ||
          this.typeOf(completion.result.value) !== 'object')
        return completion;
    }
  }

  return new Completion('throw', new Result(new util.TypeError()), null);
};

Evaluator.prototype.typeOf = function(x) {
  if (x === null)
    return 'null';
  if (typeof x === 'function')
    return 'object';
  return typeof x;
}

Evaluator.prototype.LogicalExpression = function(ctxt, nd) {
  var completion;

  if (nd.operator === '&&') {
    completion = this.ev(ctxt, nd.left);
    if (completion.type !== 'normal')
      return completion;
    this.applyHook(completion, 'conditional', nd.left);
    if (!completion.result.value)
      return completion;
    return this.ev(ctxt, nd.right);
  } else {
    completion = this.ev(ctxt, nd.left);
    if (completion.type !== 'normal')
      return completion;
    this.applyHook(completion, 'conditional', nd.left);
    if (!!completion.result.value)
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
    var op = util.substring(nd.operator, 0, nd.operator.length - 1);
    completion = lhs.get();
    if (completion.type !== 'normal')
      return completion;

    var l = completion.result.value,
      r = rhs;
    var h = this.hooks.binaryPre(nd, op, l, r, true, false, false);
    if (h) {
      op = h.op;
      l = h.left;
      r = h.right;
    }

    var res = binop[op](l, r);

    h = this.hooks.binary(nd, op, l, r, res, true, false, false);
    if (h) {
      res = h.res;
    }

    return lhs.set(res);
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

  var op = nd.operator[0],
    l = oldval,
    r = 1;
  var h = this.hooks.binaryPre(nd, op, l, r, false, false, false);
  if (h) {
    op = h.op;
    l = h.left;
    r = h.right;
  }
  var res = binop[op](l, r);
  h = this.hooks.binary(nd, op, l, r, res, false, false, false);
  if (h) {
    res = h.res;
  }

  completion = ref.set(res);
  if (completion.type !== 'normal')
    return completion;
  if (!nd.prefix)
    completion.result.value = oldval;
  return completion;
};

module.exports = Evaluator;
