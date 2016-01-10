var completions = require('./completions'),
    Completion = completions.Completion,
    Result = completions.Result,
    util = require('./util');

/** A property reference. */
function PropRef(base, prop, strict) {
  this.base = base;
  this.prop = prop;
  this.strict = strict;
}
PropRef.prototype = util.Object_create(null);

PropRef.prototype.get = function() {
  try {
    var res = this.base[this.prop];
    return new Completion('normal', new Result(res), null);
  } catch (e) {
    return new Completion('throw', new Result(e), null);
  }
};

PropRef.prototype.set = function(v) {
  try {
    var res = (this.base[this.prop] = v);
    return new Completion('normal', new Result(res), null);
  } catch (e) {
    return new Completion('throw', new Result(e), null);
  }
};

PropRef.prototype.del = function() {
  try {
    var res = delete this.base[this.prop];
    return new Completion('normal', new Result(res), null);
  } catch (e) {
    return new Completion('throw', new Result(e), null);
  }
};

PropRef.prototype.isUnresolvable = function() {
  return this.base === null || this.base === void(0);
};

PropRef.prototype.getBase = function() {
  return this.base;
};

/** A variable reference. */
function VarRef(env, name, strict) {
  this.env = env;
  this.name = name;
  this.strict = strict;
}
VarRef.prototype = util.Object_create(null);

VarRef.prototype.get = function() {
  return this.env.get(this.name);
};

VarRef.prototype.set = function(v) {
  if (this.strict && this.isUnresolvable())
    return new Completion('throw', new Result(new util.ReferenceError("Unresolvable variable " + this.name)), null);

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
