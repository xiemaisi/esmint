/**
 * Flag comparisons between function objects and primitive values.
 */

function isRelOp(op) {
  return op === '==' || op === '===' || op === '!==' || op === '!=' ||
      op === '<' || op === '>' || op === '<=' || op === '>=';
}

function isPrim(x) {
  return typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean';
}

function isFun(x) {
  return typeof x === 'function';
}

module.exports = {
  evalBinOp: function(ctxt, nd, op, l, r) {
    if (isRelOp(op) && (isFun(l) && isPrim(r) || isPrim(l) && isFun(r))) {
      var id = this.ppPos(nd);
      this.compareFunWithPrim[id] = (this.compareFunWithPrim[id]|0) + 1;
    }
    return this.superCall('evalBinOp', ctxt, nd, op, l, r);
  },

  Program: function(ctxt, nd) {
    this.compareFunWithPrim = {};
    var completion = this.superCall('Program', ctxt, nd);
    for (var pos in this.compareFunWithPrim)
      console.log("A function was compared with a primitive value " + this.compareFunWithPrim[pos] + " times at " + pos);
    return completion;
  }
};
