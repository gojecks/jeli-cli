const helper = require('@jeli/cli-utils');
const htmlParser = require('./html_parser');
const runQuery = require('./query_selector');
const { outputApplicationFiles, outputLibraryFiles } = require('./output');
const annotationProps = ['name', 'selector', 'exportAs', 'module'];

/**
 * 
 * @param {*} compilerObject 
 * @param {*} loader 
 * @param {*} entry 
 */
async function CoreGenerator(compilerObject, loader, entry) {
    let scriptBody = '';
    /**
     * 
     * @param {*} definition 
     */
    function compile(definition) {
        switch (definition.type.toLowerCase()) {
            case ('service'):
            case ('provider'):
            case ('pipe'):
                _resolveDependecies(compilerObject.services[definition.fn], definition.fn);
                definition.annotations.push(`${definition.fn}.annotations = ${writeAnnot(compilerObject.services[definition.fn], annotationProps)};`);
                quoteFix(annotationProps, compilerObject.services[definition.fn]);
                if (compilerObject.services[definition.fn].static) {
                    definition.annotations.push(`${definition.fn}.annotations.instance = ${definition.fn};`);
                }
                break;
            case ('directive'):
            case ('element'):
                const obj = compilerObject[definition.type][definition.fn];
                if (!obj.module) {
                    throw new Error(`${definition.fn} is not registered to any Module`);
                }
                const template = obj.template;
                const style = obj.style;
                delete obj.template;
                delete obj.style;
                _resolveDependecies(obj, definition.fn);
                definition.annotations.push(`${definition.fn}.annotations = ${writeAnnot(obj, annotationProps)};`);
                quoteFix(annotationProps, obj);
                if (helper.is(definition.type, 'Element')) {
                    if (template) {
                        const parsedHtml = htmlParser(template, obj, compilerResolver, definition.fn);
                        if (parsedHtml.errorLogs.length) {
                            helper.console.header(`TemplateCompilerError -> Element<${definition.fn}>`);
                            parsedHtml.errorLogs.forEach(helper.console.error);
                            helper.abort();
                        }
                        definition.annotations.push(`${definition.fn}.view = /** jeli template **/ new HtmlParser(${JSON.stringify(parsedHtml.parsedContent)}, ${JSON.stringify(parsedHtml.templatesMapHolder)}, ${writeAnnot(parsedHtml.providers)}) /** template loader **/;`);
                    }

                    // style parser
                    if (style) {
                        definition.annotations.push(`${definition.fn}.style = ${helper.stringifyContent(style)};`);
                    }
                }
                break;
            case ('jmodule'):
                /**
                 * compile @config and @initializers
                 */
                definition.annotations.push(`${definition.fn}.annotations = ${writeAnnot(compilerObject.modules[definition.fn])};`);
                definition.annotations.push(`${definition.fn}._name = '${definition.fn}';`);
                break;
        }

        return generateScript(definition);
    }

    /**
     * 
     * @param {*} annot 
     */
    function writeAnnot(annot, props) {
        if (props) {
            quoteFix(props, annot, true);
        }
        return JSON.stringify(annot, null, 4).replace(/["]/g, '');
    }

    /**
     * This function set or remove singleQuote from property value
     * e.g ["'selector'","'exportAs'"]
     * @param {*} props 
     * @param {*} annot 
     */
    function quoteFix(props, annot, addQuote) {
        props.forEach(prop => {
            if (annot.hasOwnProperty(prop)) {
                annot[prop] = addQuote ? `'${annot[prop]}'` : helper.removeSingleQuote(annot[prop]);
            }
        });
    }

    /**
     * 
     * @param {*} name 
     * @param {*} obj 
     */
    function _resolveDependecies(obj, fn) {
        if (obj.DI) {
            Object.keys(obj.DI).forEach(name => {
                const config = obj.DI[name];
                const service = compilerResolver.getService(name);
                if (!service && !config.optional) {
                    helper.throwError(`Unable to find Depenedecy: ${name} -> ${fn}`);
                }

                if (service) {
                    if (service.DI && service.DI.hasOwnProperty(fn)) {
                        helper.throwError(`Found circular dependency: ${fn} -> ${name}`);
                    }

                    config.factory = service;
                }
            });
        }
    }

    function generateScript(definition) {
        return `/** compiled ${definition.fn} **/\nvar ${definition.fn} = function(){\n"use strict";\n\n${definition.annotations.join('\n\n')}\nreturn ${definition.fn};\n}();\n`;
    }

    /**
     * 
     * @param {*} moduleObj 
     */
    function _compileOnBootStrapFns(moduleObj) {
        if (moduleObj.initializers) {
            for (let config of moduleObj.initializers) {
                if (helper.typeOf(config, 'object')) {
                    if (config.factory && config.DI) {
                        config.DI = compilerResolver.getServices(config.DI, moduleObj, true);
                    }
                }
            }
        }


        if (moduleObj.requiredModules) {
            moduleObj.requiredModules.forEach(function(moduleName) {
                _compileOnBootStrapFns(compilerObject.modules[moduleName], state);
            });
        }
    }

    const compilerResolver = {
        getFn: directiveConfiguration => directiveConfiguration && directiveConfiguration.map(def => def.fn),
        getElement: (selector, component) => {
            return runQuery(compilerObject, 'Element', selector, component);
        },
        getDirectives: (selector, element, component) => {
            return runQuery(compilerObject, 'Directive', selector, component, element);
        },
        getModule: moduleName => compilerObject.modules[moduleName],
        getService: serviceName => {
            if (compilerObject.services.hasOwnProperty(serviceName)) {
                return compilerObject.services[serviceName];
            }

            return Object.keys(compilerObject.services).find(name => helper.is(serviceName, compilerObject.services[name].name));
        }
    };

    /**
     * 
     * @param {*} requiredFilePaths 
     */
    function resolveRequired() {
        const required = Object.keys(compilerObject.required);
        if (required.length) {
            const files = required.map(filePath => {
                const req = compilerObject.required[filePath];
                return `    '${filePath}': function(){return ${typeof req == 'string' ? loader.readFile(req): req.join('') }}`;
            });
            compilerObject.output.push(`/** JELI CONTEXT **/ \nvar ${loader.getRequiredId()} = {\n${files.join(',\n')}\n};`);
        }
    }

    resolveRequired(compilerObject);
    scriptBody = compilerObject.output.map(element => helper.typeOf(element, 'object') ? compile(element) : element).join('\n');
    /**
     * save files
     */
    if (helper.is('library', compilerObject.options.type)) {
        await outputLibraryFiles(compilerObject, scriptBody, entry);
    } else {
        await outputApplicationFiles(compilerObject, scriptBody);
    }
}



module.exports = async function(compilerObject, loader) {
    loader.spinner.stop();
    for (const name in compilerObject) {
        await CoreGenerator(compilerObject[name], loader, name);
    }
};