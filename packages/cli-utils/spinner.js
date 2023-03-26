const oraAsync = import('ora');
exports.start = text => {
    return new SpinnerInstance(text);
};

class SpinnerInstance {
    constructor(text) {
        oraAsync.then(ins => this.instance = ins.default(text).start());
    }

    stop() {
        this.instance.stop();
    }

    changeText(txt) {
        this.instance.text = txt;
    }

    changeColor(color) {
        this.instance.color = color;
    }

    warn(text) {
        return this.instance.warn(text);
    }

    info(text) {
        return this.instance.info(text);
    }

    success(text) {
        return this.instance.success(text);
    }

    fail(text) {
        return this.instance.fail(text);
    }
}
