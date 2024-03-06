/**
 * 
 * @param {*} fileEntry 
 * @param {*} options 
 * @param {*} buildOptions 
 */
module.exports = function OutPutObject(fileEntry, options, buildOptions) {
    Object.defineProperties(this, {
        options: {
            get: () => options
        },
        buildOptions: {
            get: () => buildOptions || {}
        }
    });

    this.files = {};
    this.globalImports = {};
    this.Directive = {};
    this.Element = {};
    this.jModule = {};
    this.Service = {};
    this.queries = {};
    this.output = {
        modules: {},
        global: [],
        templates: {},
        styles: {},
        tokens: {},
        lazyLoads: []
    };
    this.required = {};
    this.exports = [];
    this.entryFile = fileEntry;
    this.isLib = ('library' == options?.type);
    this.entryModule = null;
}