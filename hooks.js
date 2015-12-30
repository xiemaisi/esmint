/**
 * Analysis hooks.
 */

// the default hooks do nothing
exports.defaultHooks = {
  declare: function() {},
  read: function() {},
  write: function() {},
  getFieldPre: function() {},
  getField: function() {},
  putFieldPre: function() {},
  putField: function() {},
  _return: function() {},
  _throw: function() {},
  _with: function() {},
  conditional: function() {},
  binaryPre: function() {},
  binary: function() {},
  forinObject: function() {},
  endExpression: function() {},
  functionEnter: function() {},
  functionExit: function() {},
  literal: function() {},
  invokeFunPre: function() {},
  invokeFun: function() {},
  unaryPre: function() {},
  unary: function() {}
};
