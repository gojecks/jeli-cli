 function CompilationException(message){
    this.name = "CompilationError";
    this.message = message;
}
CompilationException.prototype = Error.prototype;

module.exports = CompilationException;