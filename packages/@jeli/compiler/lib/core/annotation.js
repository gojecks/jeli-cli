const helper = require('@jeli/cli-utils');
const { escogen, parseAst } = require('./ast.generator');
const { isExportedToken, findTokenInGlobalImports } = require('./compilerobject');

/**
 * 
 * @param {*} ast 
 * @param {*} filePath 
 * @param {*} loader 
 * @param {*} compilerObject 
 */
module.exports = function(ast, filePath, loader, compilerObject) {
    const annotations = [escogen(ast.impl)];
    const compilerError = [];
    const fn = ast.impl[0].id.name;
    try {
        _structureDI(ast.definitions);
        switch (ast.type.toLowerCase()) {
            case ('directive'):
            case ('element'):
                _registerOrThrowError(ast.type, fn, ast.definitions,
                    `Class ${fn} is already registered, please use a prefix to differentiate them.`);
                elementParser(ast.definitions, ast.type, fn);
                break;
            case ('service'):
            case ('provider'):
            case ('pipe'):
                _registerOrThrowError('services', fn, ast.definitions,
                    `Service ${fn} is already registered, please rename Class or use a prefix`);
                break;
            case ('jmodule'):
                _registerOrThrowError('modules', fn, ast.definitions, `Modules ${fn} is already registered.`);
                validateModule(ast.definitions, fn);
                break;
        }
    } catch (e) {
        console.log(e)
    }

    if (compilerError.length) {
        loader.spinner.fail(`Errors found in: ${helper.colors.yellow(filePath)}\n`)
        helper.console.error(compilerError.join('\n'));
        helper.abort();
    } else {
        compilerObject.output.push({
            fn,
            type: ast.type,
            annotations
        });
    }


    /**
     * 
     * @param {*} moduleObj 
     * @param {*} fnName 
     */
    function validateModule(moduleObj, fnName) {
        Object.keys(moduleObj).forEach(_validate);

        /**
         * 
         * @param {*} type 
         */
        function _validate(type) {
            switch (type.toLowerCase()) {
                case ('services'):
                    _validateService();
                    break;
                case ('requiredmodules'):
                    _validateRequiredModules();
                    break;
                case ('selectors'):
                    _validateSelectors();
                    break;
                case ('exports'):
                    _validateExports();
                    break;
                case ('rootElement'):
                    _validateRootElement();
                    break;
                default:
                    helper.abort(`unsupported Module definition<${type}>`);
                    break;
            }
        }

        /**
         * Module Service Validator
         */
        function _validateService() {
            moduleObj.services = moduleObj.services.filter(service => {
                if (helper.typeOf(service, 'object')) {
                    if (!isExportedToken(service.name, compilerObject))
                        compilerError.push(`Token<${service.name}> definition not found.`);
                    annotations.push(`${service.name}.register(${getTokenValue(service)});`);
                    return false;
                } else if (!compilerObject.services.hasOwnProperty(service)) {
                    compilerError.push(`service -> ${service} implementation not found.`);
                }
                return true;
            });
        }

        /**
         * validate requiredModules
         */
        function _validateRequiredModules() {
            moduleObj.requiredModules.forEach(reqModule => {
                const module = getExportedModule(reqModule, compilerObject);
                if (!module) {
                    compilerError.push(`required module {${helper.colors.yellow(reqModule)}} -> {${helper.colors.yellow(fnName)}} was not found, please import the module. \n help: "${helper.colors.yellow("import {" +reqModule+"} from 'REQUIRED_PATH';")}"\n`);
                }

                /**
                 * check for circular requiredModules
                 */
                if (module && module.requiredModules && module.requiredModules.includes(fnName)) {
                    compilerError.push(`Circular referrence found:  ${reqModule} -> ${fnName} -> ${reqModule}`);
                }
            });
        }

        /**
         * validate selectors
         */
        function _validateSelectors() {
            moduleObj.selectors.forEach(elementFn => {
                const element = compilerObject.Directive[elementFn] || compilerObject.Element[elementFn];
                if (!element) {
                    compilerError.push(`${elementFn} is register in ${fnName} module but implementation does not exists.`);
                }

                if (element.module) {
                    compilerError.push(`${elementFn} is registered to ${element.module} and ${fnName} modules`);
                }

                element.module = fnName;
            });
        }

        /**
         * validate the rootElement
         */
        function _validateRootElement() {

        }

        /**
         * validate exported elements
         */
        function _validateExports() {

        }

        /**
         * 
         * @param {*} requiredModule 
         * @param {*} compilerObject 
         */
        function getExportedModule(requiredModule, compilerObject) {
            if (compilerObject.modules.hasOwnProperty(requiredModule)) {
                return compilerObject.modules[requiredModule];
            }
            const libModules = findTokenInGlobalImports(requiredModule, compilerObject, 'modules');
            return libModules && libModules[requiredModule];
        }
    }

    /**
     * 
     * @param {*} service 
     */
    function getTokenValue(service) {
        return service.value ? JSON.stringify(service.value) : service.factory;
    }

    /**
     * 
     * @param {*} type 
     * @param {*} message 
     */
    function _registerOrThrowError(type, fn, obj, message) {
        if (compilerObject[type].hasOwnProperty(fn)) {
            compilerError.push(message);
        } else {
            compilerObject[type][fn] = obj;
        }
    }

    /**
     * 
     * @param {*} obj 
     * @param {*} type 
     * @param {*} fnName 
     */
    function elementParser(obj, type, fnName) {
        const isElement = (type !== 'Directive');
        /**
         * Attach the name of the Class to the Annotation
         * this will be use for dictionary purpose
         */
        try {
            if (obj.props && obj.props.length) {
                obj.props = obj.props.reduce((accum, prop) => {
                    const item = helper.stringToObjectNameValueMapping(prop, false);
                    accum[item.name] = item;
                    delete item.name;
                    return accum;
                }, {});
            }

            if (obj.registry && obj.registry.length) {
                obj.registry = _processEventRegistry(obj.registry);
            }

            /**
             * input:type=text:model:form-field, textarea
             */
            if (/[,|:=!]/g.test(obj.selector)) {
                compilerObject.queries[obj.selector] = helper.splitAndTrim(obj.selector, ',').map(key => {
                    const props = helper.splitAndTrim(key, ':');
                    const ret = {
                        name: props.shift()
                    };

                    if (props.length) {
                        ret.match = props.map(prop => {
                            const keyValPair = helper.splitAndTrim(prop, /[=!]/);
                            const matcher = {
                                name: keyValPair.shift()
                            };

                            if (keyValPair.length) {
                                matcher[helper.isContain('!', prop) ? "not" : 'is'] = helper.splitAndTrim(keyValPair.pop(), '|');
                            }

                            return matcher;
                        });
                    }

                    return ret;
                });
            }

            if (isElement) {
                // reference the selector as we can only have one per module
                if (!obj.selector || !helper.isContain('-', obj.selector)) {
                    compilerError.push(`<${obj.selector}/> does not comply  with HTML-Spec standard for custom elements naming.\
                     Which states a custom element should contain an hyphen e.g <my-element>`);
                }

                if (obj.templateUrl) {
                    obj.template = loader.templateContentLoader(obj.templateUrl, filePath);
                }

                if (obj.styleUrl) {
                    obj.style = loader.templateContentLoader(obj.styleUrl, filePath);
                }

                if (obj.viewChild && obj.viewChild.length) {
                    obj.viewChild = obj.viewChild.reduce((accum, item) => {
                        item = helper.stringToObjectNameValueMapping(item, true);
                        if (helper.isContain(':', item.value)) {
                            item.value = helper.camelCase(item.value.replace(':', ''));
                            item.isdir = true;
                        }

                        accum[item.name] = item;
                        delete item.name;

                        return accum;
                    }, {});
                }
            }

            delete obj.templateUrl;
            delete obj.styleUrl;

        } catch (e) {
            console.log(e);
        }
    }

    /**
     * 
     * @param {*} key 
     */
    function _structureDI(obj) {
        if (obj.DI && obj.DI.length) {
            obj.DI = obj.DI.reduce((accum, key) => {
                const useName = helper.isContain("=", key);
                const di = helper.stringToObjectNameValueMapping(key, useName);
                if (useName) {
                    if (helper.isContain(':', di.value)) {
                        di.value = di.value.replace(':', '');
                        di.isdir = true;
                    }
                    obj.dynamicInjectors = true;
                }

                accum[di.name] = di;
                delete di.name;

                return accum;
            }, {});
        }
    }

    /**
     * 
     * @param {*} registry 
     */
    function _processEventRegistry(registry) {
        return registry.reduce((accum, reg) => {
            reg = helper.stringToObjectNameValueMapping(reg, false, true);
            if (reg.type && reg.value) {
                reg.value = parseAst(reg.value, true);
            }

            accum[reg.name] = reg;
            delete reg.name;

            return accum;
        }, {});
    }
}