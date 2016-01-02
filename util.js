/**
 * Copies of important library objects and functions that are immune against
 * monkey patching.
 */

/* Obtain a copy of the global object */
var globalObj;
// browser
if (typeof window !== 'undefined')
  globalObj = window;
// Node.js
else if (typeof global !== 'undefined')
  globalObj = global;
// other platform
else
  globalObj = (function() {
    return this;
  })();

exports.globalObj = globalObj;
exports.Error = globalObj.Error;
var eval = exports.eval = globalObj.eval;
exports.Function = globalObj.Function;
exports.Function_prototype_apply = exports.Function.prototype.apply;
exports.Object = globalObj.Object;
exports.Object_create = exports.Object.create;
exports.Object_getOwnPropertyDescriptor = exports.Object.getOwnPropertyDescriptor;
exports.Object_defineProperty = exports.Object.defineProperty;
exports.Object_prototype = exports.Object.prototype;
exports.ReferenceError = globalObj.ReferenceError;
exports.SyntaxError = globalObj.SyntaxError;
exports.String = globalObj.String;
exports.String_prototype_substring = exports.String.prototype.substring;
exports.TypeError = globalObj.TypeError;
exports.Date = globalObj.Date;

exports.forEach = function(xs, fn) {
  for (var i = 0, n = xs.length; i < n; ++i)
    fn(xs[i], i);
};

exports.some = function(xs, fn) {
  for (var i = 0, n = xs.length; i < n; ++i) {
    var r = fn(xs[i], i);
    if (r)
      return r;
  }
};

exports.map = function(xs, fn) {
  var res = [];
  for (var i = 0, n = xs.length; i < n; ++i)
    res[i] = fn(xs[i], i);
  return res;
};

exports.contains = function(xs, x) {
  for (var i = xs.length; i >= 0; --i)
    if (xs[i] === x)
      return true;
  return false;
};

exports.join = function(xs, sep) {
  var res = "";
  for (var i = 0, n = xs.length; i < n; ++i) {
    if (i > 0)
      res += sep;
    res += xs[i];
  }
  return res;
};

exports.push = function(xs, x) {
  xs[xs.length] = x;
};

exports.substring = function(str, start, end) {
  return exports.apply(exports.String_prototype_substring, str, [start, end]);
};

exports.apply = function(fn, base, args) {
  if (fn.apply === exports.Function_prototype_apply)
    return fn.apply(base, args);
  for (var i = 0;; ++i) {
    var tmpname = "___apply$" + i;
    if (!(tmpname in fn)) {
      exports.Object_defineProperty(fn, tmpname, {
        value: exports.Function_prototype_apply,
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

exports.construct = function(fn, args) {
  return eval("new fn(" + exports.join(exports.map(args, function(_, i) {
    return "args[" + i + "]";
  }), ", ") + ")");
};

exports.defineGetter = function(o, p, getter) {
  var desc = exports.Object_getOwnPropertyDescriptor(o, p);
  exports.Object_defineProperty(o, p, {
    get: getter,
    set: desc && desc.set || void(0),
    configurable: desc && desc.configurable || true,
    enumerable: desc && desc.enumerable || true
  });
};

exports.defineSetter = function(o, p, setter) {
  var desc = exports.Object_getOwnPropertyDescriptor(o, p);
  exports.Object_defineProperty(o, p, {
    set: setter,
    get: desc && desc.get || void(0),
    configurable: desc && desc.configurable || true,
    enumerable: desc && desc.enumerable || true
  });
};

exports.getGetter = function(o, p) {
  var desc = exports.Object_getOwnPropertyDescriptor(o, p);
  return desc && desc.get;
};

exports.getSetter = function(o, p) {
  var desc = exports.Object_getOwnPropertyDescriptor(o, p);
  return desc && desc.set;
};
