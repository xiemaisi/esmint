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

Evaluator.prototype.superCall = function(fn) {
  var args = [];
  for (var i=1;i<arguments.length;++i)
    args[i-1] = arguments[i];
  return this.__proto__[fn].apply(this, args);
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
};

Evaluator.prototype.checkFunctionDecls = function(ast) {
  function doit(nd) {
    switch (nd && nd.type) {
      case 'BlockStatement':
        for (var i = 0; i < nd.body.length; ++i) {
          if (nd.body[i].type === 'FunctionDeclaration')
            return new util.SyntaxError("Function declarations not allowed in blocks in strict mode." + nd.body[i].id.name);
          var exn = doit(nd.body[i]);
          if (exn)
            return exn;
        }
        break;
      case 'Program':
        return util.some(nd.body, doit);
      case 'FunctionDeclaration':
        return util.some(nd.body.body, doit);
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'CatchClause':
      case 'LabeledStatement':
      case 'ForInStatement':
      case 'ForStatement':
        return doit(nd.body);
      case 'TryStatement':
        return doit(nd.block) || doit(nd.handler) || doit(nd.finalizer);
      case 'IfStatement':
        return doit(nd.consequent) || doit(nd.alternate);
      case 'SwitchStatement':
        return util.some(nd.cases, doit);
      case 'SwitchCase':
        return util.some(nd.consequent, doit);
    }
  }

  return doit(ast);
};

/** Declaration binding instantiation. */
Evaluator.prototype.processDecl = function(ctxt, decl, name, init, configurable) {
  ctxt.lexicalEnvironment.addBinding(name, init, configurable);
};

Evaluator.prototype.instantiateDeclBindings = function(ctxt, nd, configurable) {
  var self = this;

  function doit(nd) {
    switch (nd && nd.type) {
      case 'FunctionDeclaration':
        var fn = self.ev(ctxt, nd).result.value;
        self.processDecl(ctxt, nd, nd.id.name, fn, configurable);
        break;
      case 'VariableDeclarator':
        self.processDecl(ctxt, nd, nd.id.name, void(0), configurable);
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
      completion = this.ToString(ctxt, nd.property, completion.result.value);
      if (completion.type !== 'normal')
        return completion;
      prop = completion.result.value;
    } else {
      prop = nd.property.name;
    }
    return this.evalPropRef(ctxt, nd, base, prop);
  } else if (nd.type === 'VariableDeclaration') {
    return this.evref(ctxt, nd.declarations[0].id);
  } else if (nd.type === 'Identifier') {
    return this.evalVarRef(ctxt, nd, nd.name);
  } else {
    throw new util.Error("Bad reference: " + nd.type);
  }
};

Evaluator.prototype.evalPropRef = function(ctxt, nd, base, prop) {
  return new Completion('normal', new Result(new PropRef(base, prop, ctxt.strict)), null);
};

Evaluator.prototype.evalVarRef = function(ctxt, nd, name) {
  return new Completion('normal', new Result(new VarRef(ctxt.lexicalEnvironment, name, ctxt.strict)), null);
};

Evaluator.prototype.parse = function(sourceFile, src, isStrict) {
  var p = new acorn.Parser({ locations: true, sourceFile: sourceFile }, src);
  if (isStrict)
    p.strict = true;
  try {
    return new Completion('normal', new Result(p.parse()), null);
  } catch(e) {
    if (e instanceof SyntaxError) {
      // Acorn treats this as a syntax error, but it should be a ReferenceError
      if (e.message.indexOf("Assigning to rvalue") >= 0)
        return new Completion('throw', new Result(new util.ReferenceError(e.message)), null);
      return new Completion('throw', new Result(e), null);
    }
    throw e;
  }
};

Evaluator.prototype.ppPos = function(nd) {
  return nd.loc.source + ":" + nd.loc.start.line + "," + nd.loc.start.column +
                         "-" + nd.loc.end.line + "," + nd.loc.end.column;
};

Evaluator.prototype.evaluate = function(sourceFile, source) {
  var completion = this.parse(sourceFile, source, false);
  if (completion.type === 'normal')
    completion = this.ev(null, completion.result.value);
  return completion;
};

/** Evaluate a statement, an expression, or an entire program. */
Evaluator.prototype.ev = function(ctxt, nd) {
  // invoke visitor method, passing context and node
  return this[nd.type](ctxt, nd);
};

Evaluator.prototype.Program = function(ctxt, nd) {
  this.annotateWithLabels(nd);
  ctxt = new ExecutionContext(globalEnv, util.globalObj, useStrict(nd.body), ctxt && ctxt.isEvalCode);

  if (ctxt.strict) {
    var exn = this.checkFunctionDecls(nd);
    if (exn)
      return new Completion('throw', new Result(exn), null);
  }

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
    var cond = this.processCondition(ctxt, nd.test, completion.result.value);
    if (cond)
      return this.ev(ctxt, nd.consequent);
    if (nd.alternate)
      return this.ev(ctxt, nd.alternate);
    return new Completion('normal', null, null);
};

Evaluator.prototype.processCondition = function(ctxt, nd, cond) {
  return this.ToBoolean(ctxt, nd, cond).result.value;
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

      var cond = this.evalBinOp(ctxt, cse, '===', discr, completion.result.value).result.value;
      if (this.processCondition(ctxt, cse, cond))
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
    var cond = this.processCondition(ctxt, nd.test, completion.result.value);
    if (!cond)
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
      result = null, cond;

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
    cond = this.processCondition(ctxt, nd.test, completion.result.value);
  } while (cond);

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
      var cond = this.processCondition(ctxt, nd.test, completion.result.value);
      if (!cond)
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

  dom = this.processForInObject(ctxt, nd.right, completion.result.value);
  if (dom === null || dom === void(0))
    return new Completion('normal', null, null);

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

Evaluator.prototype.processForInObject = function(ctxt, nd, obj) {
  if (obj === null || obj === void(0))
    return obj;
  return this.ToObject(ctxt, nd, obj).result.value;
};

Evaluator.prototype.BreakStatement = function(ctxt, nd) {
  return new Completion('break', null, nd.label && nd.label.name);
};

Evaluator.prototype.ContinueStatement = function(ctxt, nd) {
  return new Completion('continue', null, nd.label && nd.label.name);
};

Evaluator.prototype.ExpressionStatement = function(ctxt, nd) {
  return this.ev(ctxt, nd.expression);
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
    this.processDecl(ctxt, nd.handler, nd.handler.param.name, completion.result.value, false);
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

  completion = this.processWithObject(ctxt, nd.object, completion.result.value);
  if (completion.type !== 'normal')
    return completion;
  var withObj = completion.result.value;

  var oldEnv = ctxt.lexicalEnvironment;
  ctxt.lexicalEnvironment = new Environment(oldEnv, withObj);
  completion = this.ev(ctxt, nd.body);
  ctxt.lexicalEnvironment = oldEnv;
  return completion;
};

Evaluator.prototype.processWithObject = function(ctxt, nd, v) {
  return this.ToObject(ctxt, nd, v);
};

Evaluator.prototype.FunctionDeclaration =
Evaluator.prototype.FunctionExpression = function(ctxt, nd) {
  return this.Function(ctxt, nd);
};

Evaluator.prototype.Function = function(ctxt, nd) {
    var fn_name = nd.id ? nd.id.name : "",
      fn_param_names = util.map(nd.params, function(param, i) {
        return "p" + i;
      }),
      fn = eval("(function " + fn_name + " (" + util.join(fn_param_names, ", ") + ") {\n" +
        "   'use strict';\n" + // prevents coercion of `this`
        "   return thunk(this, arguments);\n" +
        "})"),
      thunk = this.thunkify(ctxt, nd, fn);

    if (ctxt.strict || useStrict(nd.body.body)) {
      var exn = this.checkFunctionDecls(nd);
      if (exn)
        return new Completion('throw', new Result(exn), null);
    }

    return new Completion('normal', new Result(fn), null);
};

Evaluator.prototype.thunkify = function(ctxt, nd, fn) {
  var self = this,
      strict = ctxt.strict || useStrict(nd.body.body),
      outerEnv = ctxt.lexicalEnvironment,
      isEvalCode = ctxt.isEvalCode;

  return function(thiz, args) {
    if (!strict) {
      if (thiz === null || thiz === void(0))
        thiz = util.globalObj;
      else
        thiz = self.ToObject(ctxt, nd, thiz).result.value;
    }

    var new_env = new Environment(outerEnv),
        new_ctxt = new ExecutionContext(new_env, thiz, strict, isEvalCode);

    // set up binding for named function expression
    if (nd.type === 'FunctionExpression' && nd.id)
      self.processDecl(new_ctxt, nd, nd.id.name, fn, false);

    // set up bindings for parameters
    util.forEach(nd.params, function(param, i) {
      self.processDecl(new_ctxt, nd, param.name, args[i], false);
    });

    // set up bindings for variables declared in body
    self.instantiateDeclBindings(new_ctxt, nd.body, isEvalCode);

    // set up binding for `arguments` variable
    if (!new_env.hasBinding('arguments'))
      self.processDecl(new_ctxt, nd, 'arguments', args, false);

    var completion = self.ev(new_ctxt, nd.body);

    if (completion.type === 'throw')
      throw completion.result.value;
    else if (completion.type === 'return')
      return completion.result.value;
    else
      return void(0);
  };
};

Evaluator.prototype.Literal = function(ctxt, nd) {
  return new Completion('normal', new Result(nd.value), null);
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
    } else {
      ++elts.length;
    }
  }

  return new Completion('normal', new Result(elts), null);
};

Evaluator.prototype.ObjectExpression = function(ctxt, nd) {
  var obj = util.Object_create(util.Object_prototype);

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
      util.defineGetter(obj, name, completion.result.value);
    } else {
      util.defineSetter(obj, name, completion.result.value);
    }
  }

  return new Completion('normal', new Result(obj), null);
};

Evaluator.prototype.CallExpression =
Evaluator.prototype.NewExpression = function(ctxt, nd) {
    var completion, base = void(0),
        callee, args;

    if (nd.type === 'CallExpression' && nd.callee.type === 'MemberExpression') {
      completion = this.evref(ctxt, nd.callee);
      if (completion.type !== 'normal')
        return completion;
      base = completion.result.value.getBase();

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

    // use a raw object instead of an array here to insulate ourselves against
    // monkey patching (cf. test-262 15.4.4.16-7-c-i-16)
    args = util.Object_create(null);
    for (var i = 0, n = nd.arguments.length; i < n; ++i) {
      completion = this.ev(ctxt, nd.arguments[i]);
      if (completion.type !== 'normal')
        return completion;
      args[i] = completion.result.value;
    }
    args.length = n;

    return this.invoke(ctxt, nd, callee, base, args);
};

Evaluator.prototype.invokeEval = function(ctxt, nd, base, args) {
  if (typeof args[0] !== 'string')
    return new Completion('normal', new Result(args[0]), null);

  var completion;
  try {
    var isDirect = nd.callee.type === 'Identifier' && nd.callee.name === 'eval';
    completion = this.parse("eval at " + this.ppPos(nd), args[0], isDirect && ctxt.strict);
    if (completion.type !== 'normal')
      return completion;
    var prog = completion.result.value;

    if (isDirect) {
      var wasEvalCode = ctxt.isEvalCode;
      ctxt.isEvalCode = true;
      completion = this.evseq(ctxt, prog.body);
      ctxt.isEvalCode = wasEvalCode;
    } else {
      completion = this.ev({ isEvalCode: true }, prog);
    }
    if (completion.type === 'normal' && !completion.result)
      completion.result = new Result();
  } catch (e) {
    completion = new Completion('throw', new Result(e), null);
  }
  return completion;
};

Evaluator.prototype.invoke = function(ctxt, nd, callee, base, args) {
  if (nd.type === 'CallExpression' && callee === eval) {
    return this.invokeEval(ctxt, nd, base, args);
  } else {
    try {
      var v;
      if (nd.type === 'NewExpression') {
        v = util.construct(callee, args);
      } else {
        v = util.apply(callee, base, args);
      }
      return new Completion('normal', new Result(v), null);
    } catch (e) {
      return new Completion('throw', new Result(e), null);
    }
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
lconv['in'] = 'ToString';

Evaluator.prototype.evalBinOp = function(ctxt, nd, op, l, r) {
  var completion;

  // apply conversions
  if (lconv[op]) {
    completion = this[lconv[op]](ctxt, nd.left, l);
    if (completion.type !== 'normal')
      return completion;
    l = completion.result.value;
  }

  if (rconv[op]) {
    completion = this[rconv[op]](ctxt, nd.right, r);
    if (completion.type !== 'normal')
      return completion;
    r = completion.result.value;
  }

  // special checks for `in` and `instanceof`
  if (op === 'in' || op === 'instanceof')
    if (this.typeOf(r) !== 'object')
      return new Completion('throw', new Result(new util.TypeError()), null);

  // special conversion for `+`
  if (op === '+' && (typeof l === 'string' || typeof r === 'string')) {
    completion = this.ToString(ctxt, nd.left, l);
    if (completion.type !== 'normal')
      return completion;
    l = completion.result.value;

    completion = this.ToString(ctxt, nd.right, r);
    if (completion.type !== 'normal')
      return completion;
    r = completion.result.value;
  }

  return new Completion('normal', new Result(binop[op](l, r)), null);
};

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

  return this.evalBinOp(ctxt, nd, op, l, r);
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

      return this.evalUnOp(ctxt, nd, nd.operator, completion.result.value);
  }
};

Evaluator.prototype.evalUnOp = function(ctxt, nd, op, arg) {
  // apply conversion
  var conv = (op === '~' && 'ToInt32' || op === '!' && 'ToBoolean' || 'ToNumber');
  completion = this[conv](ctxt, nd, arg);
  if (completion.type !== 'normal')
    return completion;
  arg = completion.result.value;

  // evaluate operator
  var res = unop[op](arg);

  return new Completion('normal', new Result(res), null);
};

Evaluator.prototype.ToInt32 = function(ctxt, nd, x) {
  var completion = this.ToNumber(ctxt, nd, x);
  if (completion.type !== 'normal')
    return completion;
  return new Completion('normal', new Result(completion.result.value|0), null);
};

Evaluator.prototype.ToUint32 = function(ctxt, nd, x) {
  var completion = this.ToNumber(ctxt, nd, x);
  if (completion.type !== 'normal')
    return completion;
  return new Completion('normal', new Result(completion.result.value>>>0), null);
};

Evaluator.prototype.ToNumber = function(ctxt, nd, x) {
  if (this.typeOf(x) === 'object') {
    var completion = this.ToPrimitive(ctxt, nd, x, 'number');
    if (completion.type !== 'normal')
      return completion;
    x = completion.result.value;
  }
  return new Completion('normal', new Result(+x), null);
};

Evaluator.prototype.ToString = function(ctxt, nd, x) {
  if (this.typeOf(x) === 'object') {
    var completion = this.ToPrimitive(ctxt, nd, x, 'string');
    if (completion.type !== 'normal')
      return completion;
    x = completion.result.value;
  }
  return new Completion('normal', new Result(util.String(x)), null);
};

Evaluator.prototype.ToBoolean = function(ctxt, nd, x) {
  return new Completion('normal', new Result(!!x), null);
};

Evaluator.prototype.ToPrimitive = function(ctxt, nd, x, preferredType) {
  if (this.typeOf(x) !== 'object')
    return new Completion('normal', new Result(x), null);
  return this.DefaultValue(ctxt, nd, x, preferredType);
};

Evaluator.prototype.DefaultValue = function(ctxt, nd, o, preferredType) {
  if (!preferredType)
    preferredType = o instanceof util.Date ? 'string' : 'number';

  var completion;
  if (preferredType === 'string') {
    var toString = new PropRef(o, 'toString').get().result.value;
    if (typeof toString === 'function') {
      completion = this.invoke(ctxt, nd, toString, o, [], false);
      if (completion.type !== 'normal' ||
          this.typeOf(completion.result.value) !== 'object')
        return completion;
    }

    var valueOf = new PropRef(o, 'valueOf').get().result.value;
    if (typeof valueOf === 'function') {
      completion = this.invoke(ctxt, nd, valueOf, o, [], false);
      if (completion.type !== 'normal' ||
          this.typeOf(completion.result.value) !== 'object')
        return completion;
    }
  } else {
    var valueOf = new PropRef(o, 'valueOf').get().result.value;
    if (typeof valueOf === 'function') {
      completion = this.invoke(ctxt, nd, valueOf, o, [], false);
      if (completion.type !== 'normal' ||
          this.typeOf(completion.result.value) !== 'object')
        return completion;
    }

    var toString = new PropRef(o, 'toString').get().result.value;
    if (typeof toString === 'function') {
      completion = this.invoke(ctxt, nd, toString, o, [], false);
      if (completion.type !== 'normal' ||
          this.typeOf(completion.result.value) !== 'object')
        return completion;
    }
  }

  return new Completion('throw', new Result(new util.TypeError()), null);
};

Evaluator.prototype.ToObject = function(ctxt, nd, v) {
  if (v === null || v == void(0))
    return new Completion('throw', new Result(new util.TypeError("Cannot convert " + v + " to an object.")), null);
  return new Completion('normal', new Result(util.Object(v)), null);
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
    var cond = this.processCondition(ctxt, nd.left, completion.result.value);
    if (!cond)
      return completion;
    return this.ev(ctxt, nd.right);
  } else {
    completion = this.ev(ctxt, nd.left);
    if (completion.type !== 'normal')
      return completion;
    var cond = this.processCondition(ctxt, nd.left, completion.result.value);
    if (cond)
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

    completion = this.evalBinOp(ctxt, nd, op, completion.result.value, rhs);
    if (completion.type !== 'normal')
      return completion;

    return lhs.set(completion.result.value);
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

  completion = this.ToNumber(ctxt, nd, completion.result.value);
  if (completion.type !== 'normal')
    return completion;
  var oldVal = completion.result.value;

  completion = this.evalBinOp(ctxt, nd, nd.operator[0], oldVal, 1);
  if (completion.type !== 'normal')
    return completion;
  var newVal = completion.result.value;

  completion = ref.set(newVal);
  if (completion.type !== 'normal')
    return completion;

  if (!nd.prefix)
    completion.result.value = oldVal;
  return completion;
};

module.exports = Evaluator;
