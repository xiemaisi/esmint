/** Execution contexts. */
function ExecutionContext(env, thiz) {
  this.lexicalEnvironment = this.variableEnvironment = env;
  this.thisBinding = thiz;
}

module.exports = ExecutionContext;
