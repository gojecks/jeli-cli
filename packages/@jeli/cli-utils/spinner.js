const ora = require('ora');
exports.start = text => {
    return new SpinnerInstance(text);
};

function SpinnerInstance(text) {
    this.instance = ora(text).start();
}

SpinnerInstance.prototype.stop = function() {
    this.instance.stop();
};

SpinnerInstance.prototype.changeText = function(txt) {
    this.instance.text = txt;
};

SpinnerInstance.prototype.changeColor = function(color) {
    this.instance.color = color;
};

SpinnerInstance.prototype.warn = function(text) {
    return this.instance.warn(text);
};

SpinnerInstance.prototype.info = function(text) {
    return this.instance.info(text);
};

SpinnerInstance.prototype.success = function(text) {
    return this.instance.success(text);
};

SpinnerInstance.prototype.fail = function(text) {
    return this.instance.fail(text);
};