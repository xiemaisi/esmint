var completions = require('./completions'),
    Completion = completions.Completion,
    Result = completions.Result;

/** A property reference. */
function PropRef(evaluator, base, prop) {
  this.hooks = evaluator.hooks;
  this.base = base;
  this.prop = prop;
}

PropRef.prototype.get = function() {
  try {
    var h = this.hooks.getFieldPre(null, this.base, this.prop);
    if (h) {
      this.base = h.base;
      this.prop = h.offset;
    }
    var res = this.base[this.prop];
    h = this.hooks.getField(null, this.base, this.prop, res);
    if (h) {
      res = h.result;
    }
    return new Completion('normal', new Result(res), null);
  } catch (e) {
    return new Completion('throw', new Result(e), null);
  }
};

PropRef.prototype.set = function(v) {
  try {
    var h = this.hooks.putFieldPre(null, this.base, this.prop, v);
    if (h) {
      this.base = h.base;
      this.prop = h.offset;
      v = h.val;
    }
    var res = (this.base[this.prop] = v);
    h = this.hooks.putField(null, this.base, this.prop, res);
    if (h) {
      res = h.result;
    }
    return new Completion('normal', new Result(res), null);
  } catch (e) {
    return new Completion('throw', new Result(e), null);
  }
};

PropRef.prototype.del = function() {
  try {
    var h = this.hooks.binaryPre(null, 'delete', this.base, this.prop, false, false, false);
    if (h) {
      this.base = h.left;
      this.prop = h.right;
    }
    var res = delete this.base[this.prop];
    h = this.hooks.binary(null, 'delete', this.base, this.prop, res, false, false, false);
    if (h) {
      res = h.result;
    }
    return new Completion('normal', new Result(res), null);
  } catch (e) {
    return new Completion('throw', new Result(e), null);
  }
};

PropRef.prototype.isUnresolvable = function() {
  return this.base === null || this.base === void(0);
};

/** A variable reference. */
function VarRef(evaluator, env, name) {
  this.hooks = evaluator.hooks;
  this.env = env;
  this.name = name;
}

VarRef.prototype.get = function() {
  var res = this.env.get(this.name);
  var h = this.hooks.read(null, this.name, res);
  if (h) {
    res = h.result;
  }
  return res;
};

VarRef.prototype.set = function(v) {
  var oldVal = this.env.get(this.name);
  var h = this.hooks.write(null, this.name, v, oldVal);
  if (h) {
    v = h.result;
  }
  return this.env.put(this.name, v);
};

VarRef.prototype.del = function() {
  return this.env.del(this.name);
};

VarRef.prototype.isUnresolvable = function() {
  return this.env.isUnresolvable(this.name);
};

exports.PropRef = PropRef;
exports.VarRef = VarRef;
