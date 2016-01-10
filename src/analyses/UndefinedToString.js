/**
 * Flag ToString conversion of `undefined`.
 */

module.exports = {
  ToString: function(ctxt, nd, x) {
    if (x === void(0))
      console.log("Undefined converted to string at " + this.ppPos(nd) + ".");
    return this.superCall('ToString', ctxt, nd, x);
  }
};
