/**
 * Flag function calls that pass extra arguments.
 */

function isNative(f) {
  return f.toString().indexOf('[native code]') > -1 || f.toString().indexOf('[object ') === 0;
}

module.exports = {
  invoke: function(ctxt, nd, callee, base, args, asConstructor) {
    if (callee.length < args.length && !isNative(callee)) {
      var pos = this.ppPos(nd);
      this.funCalledWithMoreArgs[pos] = (this.funCalledWithMoreArgs[pos]|0) + 1;
    }
    return this.superCall('invoke', ctxt, nd, callee, base, args, asConstructor);
  },

  Program: function(ctxt, nd) {
    this.funCalledWithMoreArgs = {};
    var completion = this.superCall('Program', ctxt, nd);
    for (var pos in this.funCalledWithMoreArgs)
      console.log("A function was invoked with extra arguments " + this.funCalledWithMoreArgs[pos] + " times at " + pos);
    return completion;
  }
};
