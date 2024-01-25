function NotFoundException(message){
    this.name = "FileNotFound";
    this.message = message;
}
NotFoundException.prototype = Error.prototype;

module.exports = NotFoundException;