function NotFoundException(message){
    Error.call(this, message);
    this.name = "FileNotFound";
    this.message = message;
    Error.captureStackTrace(this, NotFoundException);
}
NotFoundException.prototype = Object.create(Error.prototype);
NotFoundException.prototype.constructor = NotFoundException;

module.exports = NotFoundException;