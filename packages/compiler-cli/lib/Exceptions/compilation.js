function CompilationException(message){
    Error.call(this, message);
    this.name = "CompilationError";
    this.message = message;
    Error.captureStackTrace(this, CompilationException);
}
CompilationException.prototype = Object.create(Error.prototype);
CompilationException.prototype.constructor = CompilationException;

module.exports = CompilationException;