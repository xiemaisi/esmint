/** Execution contexts. */
function ExecutionContext(env, thiz, strict, isEvalCode) {
  this.lexicalEnvironment = this.variableEnvironment = env;
  this.thisBinding = thiz;
  this.strict = strict;
  this.isEvalCode = isEvalCode;
}

module.exports = ExecutionContext;
