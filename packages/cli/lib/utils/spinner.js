const oraAsync = import('ora');
exports.start = text => {
    return new SpinnerInstance(text);
}

class SpinnerInstance {
    _stopped = false;
    constructor(text) {
        oraAsync.then(ins => {
            this.instance = ins.default(text);
            if (!this._stopped){
                this.instance.start();
            }
        });
    }

    stop() {
        this._stopped = true;
        if (!this.instance) return;
        this.instance.stop();
    }

    changeText(txt) {
        if(!this.instance) return;
        this.instance.text = txt;
    }

    changeColor(color) {
        if(!this.instance) return;
        this.instance.color = color;
    }

    warn(text) {
        if(!this.instance) return;
        return this.instance.warn(text);
    }

    info(text) {
        if(!this.instance) return;
        return this.instance.info(text);
    }

    success(text) {
        if(!this.instance) return;
        return this.instance.success(text);
    }

    fail(text) {
        if (!this.instance) return;
        return this.instance.fail(text);
    }
}
