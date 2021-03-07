const helper = require('@jeli/cli-utils');
const { escogen, parseAst } = require('./ast.generator');
const { isExportedToken, findTokenInGlobalImports } = require('./compilerobject');
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
 * @param {*} compilerObject 
 */
module.exports = async function(ast, filePath, outputInstance, compilerObject) {
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
                    _registerOrThrowError('Service', fn, ast.definitions,
                        `Service ${fn} is already registered, please rename Class or use a prefix`);
                    break;
                case ('jmodule'):
                    _registerOrThrowError(ast.type, fn, ast.definitions, `Modules ${fn} is already registered.`);
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
                    if (helper.typeOf(service, 'object')) {
                        validateToken(service.name);
                        annotations.push(`${service.name}.register(${getTokenValue(service)}, true);`);
                        return false;
                    } else if (!compilerObject.Service.hasOwnProperty(service)) {
                        compilerError.push(`service -> ${service} implementation not found.`);
                    }

                    if (!compilerObject.Service[service].module) {
                        compilerObject.Service[service].module = fnName;
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
                        compilerError.push(`required module {${helper.colors.yellow(reqModule)}} -> {${helper.colors.yellow(fnName)}} was not found, please import the module. \n help: "${helper.colors.green("import {" +reqModule+"} from 'REQUIRED_PATH';")}"\n`);
                    }

                    /**
                     * check for circular requiredModules
                     */
                    if (module && module.requiredModules && module.requiredModules.includes(fnName)) {
                        compilerError.push(`Circular referrence found:  ${helper.colors.yellow(reqModule)} -> ${helper.colors.yellow(fnName)} -> ${helper.colors.yellow(reqModule)}`);
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

            /**
             * 
             * @param {*} requiredModule 
             * @param {*} compilerObject 
             */
            function getExportedModule(requiredModule, compilerObject) {
                if (compilerObject.jModule.hasOwnProperty(requiredModule)) {
                    return compilerObject.jModule[requiredModule];
                }
                const libModules = findTokenInGlobalImports(requiredModule, compilerObject, 'jModule');
                return libModules && libModules[requiredModule];
            }
        }

        /**
         * 
         * @param {*} token 
         */
        function validateToken(token) {
            if (!isExportedToken(token, compilerObject))
                compilerError.push(`Token<${token}> definition not found.`);
        }

        /**
         * 
         * @param {*} service 
         */
        function getTokenValue(service) {
            const token = Object.keys(service).reduce((accum, key) => {
                if (key !== 'name') {
                    accum.push(`${key} : ${toObjectString(service[key], key == 'DI')}`);
                }
                return accum;
            }, []);

            /**
             * 
             * @param {*} value 
             * @param {*} isdeps 
             */
            function toObjectString(value, isdeps) {
                if (Array.isArray(value)) {
                    if (isdeps) return `{${value.map(key => `${key} : {factory: ${key}}`)}}`;
                    return `[${value}]`;
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
            ParseProps(obj);
            ParseAndValidateResolvers(obj);
            if (obj.events && obj.events.length) {
                obj.events = _processEventRegistry(obj.events);
            }

            /**
             * input:type=text:model:form-field, textarea
             */
            if (/[,|:=!]/g.test(obj.selector)) {
                compilerObject.queries[obj.selector] = parseQuery(obj.selector);
            }

            /**
             * validate registerAs
             */
            if (obj.registerAs && !isExportedToken(obj.registerAs, compilerObject)) {
                compilerError.push(`Token<${obj.registerAs}> definition not found.`);
            }

            if (isElement) {
                // reference the selector as we can only have one per module
                if (!obj.selector || !helper.isContain('-', obj.selector)) {
                    compilerError.push(`<${obj.selector}/> does not comply  with HTML-Spec standard for custom elements naming.\
                     Which states a custom element should contain an hyphen e.g <my-element>`);
                }

                if (obj.templateUrl) {
                    const templatePath = loader.joinFilePath(filePath, '..', obj.templateUrl);
                    obj.template = loader.templateContentLoader(templatePath);
                    compilerObject.output.templates[templatePath] = filePath;
                }

                if (obj.styleUrl) {
                    const stylePath = loader.joinFilePath(filePath, '..', obj.styleUrl);
                    obj.style = loader.templateContentLoader(stylePath);
                    compilerObject.output.styles[stylePath] = filePath;
                }

                ParseViewChild(obj);
            }

            delete obj.templateUrl;
            delete obj.styleUrl;

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

    function ParseViewChild(obj) {
        if (obj.viewChild && obj.viewChild.length) {
            obj.viewChild = obj.viewChild.reduce((accum, item) => {
                item = helper.stringToObjectNameValueMapping(item, true, true, true);
                accum.push(item);
                return accum;
            }, []);
        }
    }

    /**
     * 
     * @param {*} obj 
     */
    function ParseAndValidateResolvers(obj) {
        if (obj.resolve && obj.resolve.length) {
            obj.resolve.forEach(item => {
                if (helper.typeOf(item, 'string') && !isExportedToken(item, compilerObject)) return;
                else if (helper.typeOf(item, 'object')) {
                }
            });
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
                /**
                 * workaroud to add quote to arguments
                 */
                if (Array.isArray(reg.value)){
                    for(const ast of reg.value) {
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
            if (helper.typeOf(arg, 'string')){
                list[idx] = `'${arg}'`;
            } else if(Array.isArray(arg)){
                parseToString(arg);
            }
        });
    }
}