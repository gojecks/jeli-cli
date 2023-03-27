const helper = require('@jeli/cli/lib/utils');
const { escogen, parseAst } = require('./ast.generator');
const { parseQuery } = require('./query_selector');
const loader = require('./loader');
const AnnotationsEnum = {
    SERVICES: 'SERVICES',
    REQUIREDMODULES: 'REQUIREDMODULES',
    SELECTORS: 'SELECTORS',
    EXPORTS: 'EXPORTS',
    ROOTELEMENT: 'ROOTELEMENT'
};

/**
 * 
 * @param {*} ast 
 * @param {*} filePath 
 * @param {*} outputInstance 
 * @param {*} componentsResolver 
 */
function processAst(ast, filePath, outputInstance, componentsResolver) {
    const annotations = [escogen(ast.impl)];
    const compilerError = [];
    const fn = ast.impl[0].id.name;

    try {
        _structureDI(ast.definitions);
        _validateDI(ast.definitions.DI, fn, fn);
        switch (ast.type.toLowerCase()) {
            case ('directive'):
            case ('element'):
                _registerOrThrowError(ast.type, fn, ast.definitions,
                    `Class ${helper.colors.yellow(fn)} is already registered, please use a prefix to differentiate them.`);
                elementParser(ast.definitions, ast.type, fn);
                break;
            case ('service'):
            case ('provider'):
            case ('pipe'):
                _registerOrThrowError('Service', fn, ast.definitions,
                    `Service ${helper.colors.yellow(fn)} is already registered, please rename Class or use a prefix`);
                break;
            case ('jmodule'):
                _registerOrThrowError(ast.type, fn, ast.definitions, `Modules ${helper.colors.yellow(fn)} is already registered.`);
                validateModule(ast.definitions, fn);
                break;
        }
    } catch (e) {
        console.log(e)
    }

    if (compilerError.length) {
        loader.spinner.fail(`Errors found in: ${helper.colors.yellow(filePath)}\n`)
        helper.console.error(compilerError.join('\n'));
    } else {
        outputInstance.annotations.push({
            fn,
            type: ast.type,
            isModule: helper.is(ast.type, 'jModule'),
            annotations
        })
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
            switch (type.toUpperCase()) {
                case (AnnotationsEnum.SERVICES):
                    _validateService();
                    break;
                case (AnnotationsEnum.REQUIREDMODULES):
                    _validateRequiredModules();
                    break;
                case (AnnotationsEnum.SELECTORS):
                    _validateSelectors();
                    break;
                case (AnnotationsEnum.EXPORTS):
                    _validateExports();
                    break;
                case (AnnotationsEnum.ROOTELEMENT):
                    _validateRootElement();
                    break;
                default:
                    loader.spinner.fail(`\nunsupported Module definition<${helper.colors.yellow(type)}> defined in ${helper.colors.yellow(filePath)}`);
                    helper.abort();
                    break;
            }
        }

        /**
         * Module Service Validator
         */
        function _validateService() {
            moduleObj.services = moduleObj.services.filter(service => {
                const serviceDefinition = componentsResolver.getLocalService(service);
                if (helper.typeOf(service, 'object')) {
                    validateToken(service);
                    annotations.push(`${service.name}.register(${getTokenValue(service)}, true);`);
                    return false;
                } else if (!serviceDefinition) {
                    compilerError.push(`service -> ${service} implementation not found.`);
                    return false;
                }

                if (!serviceDefinition.module) {
                    serviceDefinition.module = fnName;
                }

                return true;
            });
        }

        /**
         * validate requiredModules
         */
        function _validateRequiredModules() {
            moduleObj.requiredModules = moduleObj.requiredModules.map(reqModule => {
                if (helper.typeOf(reqModule, 'object')) {
                    const moduleDef = reqModule;
                    reqModule = reqModule.namespaces.shift();
                    annotations.push(`/** initialize ${reqModule} static call **/ ${reqModule}${moduleDef.namespaces.join('.')}.${moduleDef.fn}.apply(null, ${helper.objectStringToAsIs(moduleDef.args)});`);
                }

                const module = componentsResolver.getExportedModule(reqModule);
                if (!module) {
                    compilerError.push(`required module {${helper.colors.yellow(reqModule)}} -> {${helper.colors.yellow(fnName)}} was not found, please import the module. \n help: "${helper.colors.green("import {" +reqModule+"} from 'REQUIRED_PATH';")}"\n`);
                }

                /**
                 * check for circular requiredModules
                 */
                if (module && module.requiredModules && module.requiredModules.includes(fnName)) {
                    compilerError.push(`Circular referrence found:  ${helper.colors.yellow(reqModule)} -> ${helper.colors.yellow(fnName)} -> ${helper.colors.yellow(reqModule)}`);
                }

                return reqModule;
            });
        }

        /**
         * validate selectors
         */
        function _validateSelectors() {
            moduleObj.selectors.forEach(elementFn => {
                const element = componentsResolver.getLocalSelector(elementFn);
                if (helper.typeOf(elementFn, 'object')) {
                    if (elementFn.useExisting && elementFn.selector) {
                        if (!element) {
                            return compilerError.push(`${elementFn.useExisting} is registered in ${fnName} module but implementation does not exists.`);
                        }

                        // create a new reactive class from build
                        const newClassName = helper.pascalCase(elementFn.selector);
                        elementFn.selector = helper.removeDoubleQuote(elementFn.selector);
                        const newInstance = Object.assign(elementFn, {
                            module: fnName,
                            link: element
                        });
                        componentsResolver.addEntry(elementFn.selector.includes('-') ? 'Element' : 'Directive', newClassName, newInstance)
                        return;
                    }

                    return compilerError.push(`Invalid definition ${JSON.stringify(elementFn)}, missing property "useExisiting|selector"`);
                }

                if (!element) {
                    compilerError.push(`${elementFn} is registered in ${fnName} module but implementation does not exists.`);
                    return;
                }

                if (element.module && element.module !== fnName) {
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
    }

    /**
     * 
     * @param {*} token 
     */
    function validateToken(token) {
        if (!componentsResolver.isExportedToken(token.name))
            compilerError.push(`Token<${token.name}> definition not found.`);
        if (token.useClass) {
            const serviceImpl = componentsResolver.getLocalService(token.useClass);
            if (!serviceImpl) {
                compilerError.push(`Missing implementation for ${token.useClass} provided in ${token.name}`);
            } else if (serviceImpl.DI) {
                _validateDI(serviceImpl.DI, token.name, token.useClass);
            }
        } else if (token.factory && token.DI) {
            token.DI.forEach(di => {
                if (helper.typeOf(di, 'string') && !/['"]/.test(di.charAt(0)) && !componentsResolver.isExportedToken(di)) {
                    compilerError.push(`unable to find dependency ${helper.colors.yellow(di)}`);
                }
            });
        }
    }

    /**
     * 
     * @param {*} deps 
     * @param {*} tokenName 
     * @param {*} className 
     */
    function _validateDI(deps, tokenName, className, entryClass) {
        if (!deps) return;
        deps.forEach(di => {
            if (helper.typeOf(di, 'string')) {
                const service = componentsResolver.getService(di);
                if (service) {
                    if (service.DI) {
                        if (service.DI.includes(tokenName))
                            compilerError.push(`\nFound circular dependency: ${helper.colors.yellow(tokenName)} in ${helper.colors.yellow(di)} -> ${helper.colors.yellow(className)} ${entryClass ? '-> '+ helper.colors.yellow(entryClass): ''} as ${helper.colors.yellow(tokenName)}`);
                        else
                            _validateDI(service.DI, tokenName, di, className);
                    }
                } else if (!entryClass) {
                    compilerError.push(`\nservice not found: ${helper.colors.yellow(di)}`);
                }
            } else if (helper.typeOf(di, 'object') && !di.optional) {
                compilerError.push(`unable to resolve dependency: ${helper.colors.yellow(di.name)} -> ${helper.colors.yellow(fn)}}`);
            }
        });
    }

    /**
     * 
     * @param {*} service 
     */
    function getTokenValue(service) {
        const token = Object.keys(service).reduce((accum, key) => {
            if (key !== 'name') {
                accum.push(`${key}: ${toObjectString(service[key], key == 'DI')}`);
            }
            return accum;
        }, []);

        /**
         * 
         * @param {*} value 
         * @param {*} isdeps 
         */
        function toObjectString(value, isdeps) {
            const strinifyObj = v => helper.typeOf(v, 'object') ? JSON.stringify(v) : v;
            const parseDI = v => v.map(di => {
                if (helper.typeOf(di, 'string') && !/['"]/.test(di.charAt(0))) {
                    return di;
                } else {
                    return `{instance:${strinifyObj(di)}}`;
                }
            });

            if (Array.isArray(value)) {
                if (isdeps) return `[${parseDI(value)}]`;
                return `[${d.map(v => strinifyObj(v))}]`;
            }
            return value;
        }

        return `{${token.join(', ')}}`;
    }

    /**
     * 
     * @param {*} type 
     * @param {*} message 
     */
    function _registerOrThrowError(type, fn, obj, message) {
        if (!componentsResolver.addEntry(type, fn, obj)) {
            compilerError.push(message);
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
            ParseProps(obj);
            ParseAndValidateResolvers(obj);
            if (obj.events && obj.events.length) {
                obj.events = _processEventRegistry(obj.events);
            }

            /**
             * input:type=text:model:form-field, textarea
             */
            if (/[,|:=!]/g.test(obj.selector)) {
                componentsResolver.addEntry('queries', obj.selector, parseQuery(obj.selector))
            }

            /**
             * validate registerAs
             */
            if (obj.registerAs && !componentsResolver.isExportedToken(obj.registerAs)) {
                compilerError.push(`Token<${obj.registerAs}> definition not found.`);
            }

            if (isElement) {
                // reference the selector as we can only have one per module
                if (!obj.selector || !helper.isContain('-', obj.selector)) {
                    compilerError.push(`<${obj.selector}/> does not comply  with HTML-Spec standard for custom elements naming.\
                     Which states a custom element should contain an hyphen e.g <my-element>`);
                }

                ParseChild(obj,['viewChild','contentChild','contentChildren']);
            }

        } catch (e) {
            console.log(e);
        }
    }

    /**
     * 
     * @param {*} obj 
     */
    function ParseProps(obj) {
        if (obj.props && obj.props.length) {
            obj.props = obj.props.reduce((accum, prop) => {
                const item = helper.stringToObjectNameValueMapping(prop, false);
                accum[item.name] = item;
                delete item.name;
                return accum;
            }, {});
        }
    }

    /**
     * 
     * @param {*} obj 
     * @param {*} listOfAnnotations 
     */
    function ParseChild(obj, listOfAnnotations) {
        listOfAnnotations.forEach(prop => {
            if (obj[prop] && obj[prop].length) {
                // QueryList not allowed for @contentChild 
                
    
                obj[prop] = obj[prop].reduce((accum, item) => {
                    item = helper.stringToObjectNameValueMapping(item, true, true, true);
                    if(['contentChild'].includes(prop) && item.ql){
                        compilerError.push(`QueryList cannot be used with ${prop} -> ${item}`);
                        return accum;
                    } else if ('contentChildren' == prop && !item.ql){
                        compilerError.push(`${prop} must be used with a QueryList  -> ${item}`);
                        return accum;
                    }
                    accum.push(item);
                    return accum;
                }, []);
            }
        });
    }

    /**
     * 
     * @param {*} obj 
     */
    function ParseAndValidateResolvers(obj) {
        if (obj.resolve && obj.resolve.length) {
            obj.resolve.forEach(item => {
                if (helper.typeOf(item, 'string') && !componentsResolver.isExportedToken(item)) return;
                else if (helper.typeOf(item, 'object')) {}
            });
        }
    }

    /**
     * 
     * @param {*} key 
     */
    function _structureDI(obj) {
        if (obj.DI && obj.DI.length) {
            obj.DI = obj.DI.map(di => {
                if (/[=:?]/.test(di)) {
                    const useName = helper.isContain("=", di);
                    const stValue = helper.stringToObjectNameValueMapping(di, useName);
                    if (useName) {
                        obj.dynamicInjectors = true;
                    }
                    stValue.tokenName = `'${stValue.name}'`;

                    delete stValue.name;
                    return stValue;
                } else {
                    return di;
                }
            });
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
                /**
                 * workaroud to add quote to arguments
                 */
                if (Array.isArray(reg.value)) {
                    for (const ast of reg.value) {
                        if (ast.type === "'call'") {
                            parseToString(ast.args);
                        }
                    }
                }
            }

            accum[`'${reg.name}'`] = reg;
            delete reg.name;
            return accum;
        }, {});
    }

    function parseToString(list) {
        list.forEach((arg, idx) => {
            if (helper.typeOf(arg, 'string')) {
                list[idx] = `'${arg}'`;
            } else if (Array.isArray(arg)) {
                parseToString(arg);
            }
        });
    }
}

/**
 * 
 * @param {*} annotations 
 * @param {*} filePath 
 * @param {*} outputInstance 
 * @param {*} componentsResolver 
 */
module.exports = async (annotations, filePath, outputInstance, componentsResolver) => {
    annotations.forEach(ast => processAst(ast, filePath, outputInstance, componentsResolver));
}