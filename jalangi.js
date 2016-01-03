/**
 * A partial re-implementation of Jalangi's instrumentation framework on top
 * of ESMint.
 */

var next_iid = 1;
var iid2nd = [];

function iid(nd) {
  return nd.iid || (iid2nd[next_iid] = nd, nd.iid = next_iid++);
}

function InterceptingPropRef(evaluator, nd, propref) {
  this.evaluator = evaluator;
  this.nd = nd;
  this.propref = propref;
}

InterceptingPropRef.prototype.get = function() {
  var h = this.evaluator.getFieldPre(iid(this.nd), this.propref.base, this.propref.prop);
  if (h) {
    this.propref.base = h.base;
    this.propref.prop = h.offset;
  }

  var completion = this.propref.get();

  if (completion.type === 'normal') {
    h = this.evaluator.getField(iid(this.nd), this.propref.base, this.propref.prop, completion.result.value);
    if (h)
      completion.result.value = h.result;
  }

  return completion;
};

InterceptingPropRef.prototype.set = function(v) {
  var h = this.evaluator.putFieldPre(iid(this.nd), this.propref.base, this.propref.prop, v);
  if (h) {
    this.propref.base = h.base;
    this.propref.prop = h.offset;
    v = h.val;
  }

  var completion = this.propref.set(v);

  if (completion.type === 'normal') {
    h = this.evaluator.putField(iid(this.nd), this.propref.base, this.propref.prop, completion.result.value);
    if (h)
      completion.result.value = h.result;
  }

  return completion;
};

InterceptingPropRef.prototype.del = function() {
  var h = this.evaluator.binaryPre(iid(this.nd), 'delete', this.propref.base, this.propref.prop, false, false, false);
  if (h) {
    this.propref.base = h.left;
    this.propref.prop = h.right;
  }

  var completion = this.propref.del();

  if (completion.type === 'normal') {
    h = this.evaluator.binary(iid(this.nd), 'delete', this.propref.base, this.propref.prop, completion.result.value, false, false, false);
    if (h)
      completion.result.value = h.result;
  }

  return completion;
};

InterceptingPropRef.prototype.isUnresolvable = function() {
  return this.propref.isUnresolvable();
};

InterceptingPropRef.prototype.getBase = function() {
  return this.propref.getBase()
};

function InterceptingVarRef(evaluator, nd, varref) {
  this.evaluator = evaluator;
  this.nd = nd;
  this.varref = varref;
}

InterceptingVarRef.prototype.get = function() {
  var completion = this.varref.get();
  if (completion.type === 'normal') {
    var h = this.evaluator.read(iid(this.nd), this.varref.name, completion.result.value);
    if (h)
      completion.result.value = h.result;
  }
  return completion;
};

InterceptingVarRef.prototype.set = function(v) {
  var completion = this.varref.env.get(this.varref.name);
  if (completion.type === 'normal') {
    var h = this.evaluator.write(iid(this.nd), this.varref.name, v, completion.result.value);
    if (h)
      v = h.result;
  }
  return this.varref.set(v);
};

InterceptingVarRef.prototype.del = function() {
  return this.varref.del();
};

InterceptingVarRef.prototype.isUnresolvable = function() {
  return this.varref.isUnresolvable();
};

module.exports = {
  processDecl: function(ctxt, decl, name, init, configurable) {
    var isArgument = false, argumentIndex = -1, isCatchParam = false;

    if (decl.type === 'FunctionDeclaration' || decl.type === 'FunctionExpression') {
      for (var i=0; i<decl.params.length; ++i)
        if (decl.params[i].name === name) {
          isArgument = true;
          argumentIndex = i;
          break;
        }
      if (name === 'argument' && argumentIndex === -1)
        isArgument = true;
    } else if (decl.type === 'CatchClause') {
      isCatchParam = true;
    }

    var h = this.declare(iid(decl), name, init, isArgument, argumentIndex, isCatchParam);
    if (decl.type === 'FunctionDeclaration' && h)
      init = h.result;
    this.superCall('processDecl', ctxt, decl, name, init, configurable);
  },

  ReturnStatement: function(ctxt, nd) {
    var completion = this.superCall('ReturnStatement', ctxt, nd);
    if (completion.type === 'normal') {
      var h = this._return(iid(nd), completion.result.value);
      if (h)
        completion.result.value = h.result;
    }
    return completion;
  },

  ThrowStatement: function(ctxt, nd) {
    var completion = this.superCall('ThrowStatement', ctxt, nd);
    var h = this._throw(iid(nd), completion.result.value);
    if (h)
      completion.result.value = h.result;
    return completion;
  },

  processCondition: function(ctxt, nd, cond) {
    var h = this.conditional(iid(nd), cond);
    if (h)
      cond = h.result;
    return this.superCall('processCondition', ctxt, nd, cond);
  },

  evalBinOp: function(ctxt, nd, op, l, r) {
    var isOpAssign = nd.type === 'AssignmentExpression';
    var isSwitchCaseComparison = nd.type === 'SwitchCase';
    var isComputed = nd.type === 'UnaryExpression' && nd.argument.computed;

    var h = this.binaryPre(iid(nd), op, l, r, isOpAssign, isSwitchCaseComparison, isComputed);
    if (h) {
      op = h.op;
      l = h.left;
      r = h.right;
    }

    var completion = this.superCall('evalBinOp', ctxt, nd, op, l, r);

    if (completion.type === 'normal') {
      h = this.binary(iid(nd), op, l, r, completion.result.value, isOpAssign, isSwitchCaseComparison, isComputed);
      if (h)
        completion.result.value = h.result;
    }

    return completion;
  },

  processForInObject: function(ctxt, nd, obj) {
    var h = this.forInObject(iid(nd), obj);
    if (h)
      obj = h.result;
    return this.superCall('processForInObject', ctxt, nd, obj);
  },

  ExpressionStatement: function(ctxt, nd) {
    var completion = this.superCall('ExpressionStatement', ctxt, nd);
    if (completion.type === 'normal')
      this.endExpression(iid(nd));
    return completion;
  },

  processWithObject: function(ctxt, nd, v) {
    var h = this._with(iid(nd), v);
    if (h)
      v = h.result;
    return this.superCall('processWithObject', ctxt, nd, v);
  },

  Function: function(ctxt, nd) {
    var completion = this.superCall('Function', ctxt, nd);
    var h = this.literal(iid(nd), completion.result.value, false);
    if (h)
      completion.result.value = h.result;
    return completion;
  },

  thunkify: function(ctxt, nd, fn) {
    var self = this, thunk = this.superCall('thunkify', ctxt, nd, fn);

    return function(thiz, args) {
      var isBacktrack, h, returnVal, wrappedExceptionVal;

      self.functionEnter(iid(nd), fn, thiz, args);
      while (true) {
        isBacktrack = false;
        returnVal = wrappedExceptionVal = void(0);

        try {
          returnVal = thunk(thiz, args);
        } catch (e) {
          wrappedExceptionVal = { exception: e };
        }
        h = self.functionExit(iid(nd), returnVal, wrappedExceptionVal);
        if (h) {
          returnVal = h.returnVal;
          wrappedExceptionVal = h.wrappedExceptionVal;
          isBacktrack = !!h.isBacktrack;
        }

        if (!isBacktrack) {
          if (wrappedExceptionVal)
            throw wrappedExceptionVal.exception;
          else
            return returnVal;
        }
      }
    };
  },

  Literal: function(ctxt, nd) {
    var completion = this.superCall('Literal', ctxt, nd);
    var h = this.literal(iid(nd), completion.result.value, false);
    if (h)
      completion.result.value = h.result;
    return completion;
  },

  ArrayExpression: function(ctxt, nd) {
    var completion = this.superCall('ArrayExpression', ctxt, nd);
    var h = this.literal(iid(nd), completion.result.value, false);
    if (h)
      completion.result.value = h.result;
    return completion;
  },

  evalUnOp: function(ctxt, nd, op, arg) {
    var h = this.unaryPre(iid(nd), op, arg);
    if (h) {
      op = h.op;
      arg = h.left;
    }

    var completion = this.superCall('evalUnOp', ctxt, nd, op, arg);

    if (completion.type === 'normal') {
      h = this.unary(iid(nd), op, arg, completion.result.value);
      if (h)
        completion.result.value = h.result;
    }

    return completion;
  },

  invoke: function(ctxt, nd, callee, base, args) {
    var isConstructor = nd.type === 'NewExpression',
        isMethod = nd.callee && nd.callee.type === 'MemberExpression';
    var h = this.invokeFunPre(iid(nd), callee, base, args, isConstructor, isMethod);
    var skip = false;
    if (h) {
      callee = h.f;
      base = h.base;
      args = h.args;
      skip = h.skip;
    }

    if (skip) {
      return new Completion('return', new Result(), null);
    } else {
      var completion = this.superCall('invoke', ctxt, nd, callee, base, args);
      if (completion.type === 'return') {
        h = this.invokeFun(iid(nd), callee, base, args, completion.result.value, isConstructor, isMethod);
        if (h)
          completion.result.value = r.result;
      }
      return completion;
    }
  },

  ObjectExpression: function(ctxt, nd) {
    var hasAccessors = false;
    for (var i = 0, n = nd.properties.length; i < n; ++i) {
      if (nd.properties[i].kind !== 'init') {
        hasAccessors = true;
        break;
      }
    }

    var completion = this.superCall('ObjectExpression', ctxt, nd);
    var h = this.literal(iid(nd), completion.result.value, hasAccessors);
    if (h)
      completion.result.value = h.result;
    return completion;
  },

  evalPropRef: function(ctxt, nd, base, prop) {
    var completion = this.superCall('evalPropRef', ctxt, nd, base, prop);
    if (completion.type === 'normal')
      completion.result.value = new InterceptingPropRef(this, nd, completion.result.value);
    return completion;
  },

  evalVarRef: function(ctxt, nd, name) {
    var completion = this.superCall('evalVarRef', ctxt, nd, name);
    if (completion.type === 'normal')
      completion.result.value = new InterceptingVarRef(this, nd, completion.result.value);
    return completion;
  },

  // default no-op hooks
  declare: function(iid, name, init, isArgument, argumentIndex, isCatchParam) {},
  _return: function(iid, result) {},
  _throw: function(iid, exception) {},
  conditional: function(iid, condition) {},
  binaryPre: function(iid, op, left, right, isOpAssign, isSwitchCaseComparison, isComputed) {},
  binary: function(iid, op, left, right, result, isOpAssign, isSwitchCaseComparison, isComputed) {},
  forinObject: function(iid, obj) {},
  endExpression: function(iid) {},
  _with: function(iid, obj) {},
  literal: function(iid, val, hasGetterSetter) {},
  unaryPre: function(iid, op, arg) {},
  unary: function(iid, op, arg, res) {},
  invokeFunPre: function(iid, callee, base, args, isConstructor, isMethod) {},
  invokeFun: function(iid, callee, base, args, result, isConstructor, isMethod) {},
  functionEnter: function(iid, fn, thiz, args) {},
  functionExit: function(iid, returnVal, wrappedExceptionVal) {},
  write: function(iid, name, val, lhs, isGlobal, isScriptLocal) {},
  getFieldPre: function(iid, base, offset, isComputed, isOpAssign, isMethodCall) {},
  getField: function(iid, base, offset, val, isComputed, isOpAssign, isMethodCall) {},
  putFieldPre: function(iid, base, offset, val, isComputed, isOpAssign) {},
  putField: function(iid, base, offset, val, isComputed, isOpAssign) {},
  read: function(iid, name, val, isGlobal, isScriptLocal) {}
};
