/**
 * Flag ToString conversion of `undefined`.
 */

module.exports = {
  ToString: function(ctxt, nd, x) {
    if (x === void(0)) {
      var id = this.ppPos(nd);
      this.undefToString[id] = (this.undefToString[id]|0) + 1;
    }
    return this.superCall('ToString', ctxt, nd, x);
  },
  Program: function(ctxt, nd) {
    this.undefToString = {};
    var completion = this.superCall('Program', ctxt, nd);
    for (var pos in this.undefToString)
      console.log("An undefined value was converted to a string " + this.undefToString[pos] + " times at " + pos);
    return completion;
  }
};
