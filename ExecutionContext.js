/** Execution contexts. */
function ExecutionContext(env, thiz, strict) {
  this.lexicalEnvironment = this.variableEnvironment = env;
  this.thisBinding = thiz;
  this.strict = strict;
}

module.exports = ExecutionContext;
