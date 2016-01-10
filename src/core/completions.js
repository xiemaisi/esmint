/** Completions. */
function Completion(type, result, target) {
    this.type = type; // 'normal', 'throw', 'return', 'continue', 'break'
    this.result = result; // null or a Result
    this.target = target; // null or an identifier
}

/** Results are simply wrappers around values. */
function Result(v) {
    this.value = v;
}

exports.Completion = Completion;
exports.Result = Result;
