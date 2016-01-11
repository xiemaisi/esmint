/**
 * Flag property writes that shadow a prototype property.
 */

var util = require('../core/util'),
    HOP = util.hasOwnProperty,
    sort = Array.prototype.sort;

var info = {};

function InterceptingPropRef(evaluator, nd, propref) {
  this.evaluator = evaluator;
  this.nd = nd;
  this.propref = propref;
}
InterceptingPropRef.prototype = util.Object.create(null);

InterceptingPropRef.prototype.get = function() { return this.propref.get(); };
InterceptingPropRef.prototype.isUnresolvable = function() { return this.propref.isUnresolvable(); };
InterceptingPropRef.prototype.getBase = function() { return this.propref.getBase() };
InterceptingPropRef.prototype.del = function() { return this.propref.del() };

InterceptingPropRef.prototype.set = function(val) {
  var base = this.propref.base, offset = this.propref.prop;

  if (typeof val !== 'function' && base && !HOP(base, offset)) {
    var id = this.evaluator.ppPos(this.nd);
    var tmp = base.__proto__;
    while(tmp) {
      if (HOP(tmp, offset)) {
        if (!info[id])
          info[id] = {};
        info[id][offset] = (info[id][offset]|0) + 1;
        break;
      }
      tmp = tmp.__proto__;
    }
  }

  return this.propref.set(val);
 };

module.exports = {
  evalPropRef: function(ctxt, nd, base, prop) {
    var completion = this.superCall('evalPropRef', ctxt, nd, base, prop);
    if (completion.type === 'normal')
      completion.result.value = new InterceptingPropRef(this, nd, completion.result.value);
    return completion;
  },

  Program: function(ctxt, nd) {
    var completion = this.superCall('Program', ctxt, nd);

    var tmp = [];
    for (var id in info) {
      var props = info[id];
      for (var prop in props)
        tmp.push({ id: id, prop: prop, count: props[prop] });
    }
    sort.call(tmp, function(a,b) {
      return b.count - a.count;
    });

    for (var x in tmp) {
      x = tmp[x];
      console.log(x.count + " shadowing writes to property " + x.prop + " at " + x.id + ".");
    }

    return completion;
  }
};
