var completions = require('./completions'),
  Completion = completions.Completion,
  Result = completions.Result,
  util = require('./util');

/** Environments. */
function Environment(outer, obj) {
  this.bindings = obj || util.Object_create(null);
  this.outer = outer;
}

Environment.prototype.get = function(name) {
  if (this.hasBinding(name))
    return new Completion('normal', new Result(this.bindings[name]), null);
  if (!this.outer)
    return new Completion('throw', new Result(new util.ReferenceError(name + " is not defined")), null);
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

module.exports = Environment;
