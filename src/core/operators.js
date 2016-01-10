/** Implementations of operators. */
var util = require('./util');

exports.binop = {};
exports.unop = {};

util.map(['+', '-', '*', '/', '%',
          '>>', '>>>', '<<', '&', '|', '^',
          '==', '===', '!=', '!==',
          '>', '<', '>=', '<=',
          'instanceof', 'in'],
         function(op) {
           exports.binop[op] = new Function("x, y", "return x " + op + " y;");
         });

// `delete` and `typeof` are special
util.map(['+', '-', '!', '~', 'void'],
         function(op) {
           exports.unop[op] = new Function("x", "return " + op + " x;");
         });
