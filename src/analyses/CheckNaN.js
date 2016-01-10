/**
 * Flag ToString/ToNumber/ToBoolean conversion of `undefined`.
 */

function conversionChecker(name) {
  return function (ctxt, nd, x) {
    if (x !== x) {
      var id = name + '@' + this.ppPos(nd);
      this.conversions[id] = (this.conversions[id]|0) + 1;
    }
    return this.superCall(name, ctxt, nd, x);
  };
}

module.exports = {
  ToString: conversionChecker('ToString'),
  ToNumber: conversionChecker('ToNumber'),
  ToBoolean: conversionChecker('ToBoolean'),
  Program: function(ctxt, nd) {
    this.conversions = {};
    var completion = this.superCall('Program', ctxt, nd);
    for (var id in this.conversions) {
      var tmp = id.split('@');
      var conv = tmp[0], pos = tmp[1];
      console.log("A " + conv + " conversion was applied to NaN " + this.conversions[id] + " times at " + pos);
    }
    return completion;
  }
};
