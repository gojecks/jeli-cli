const helper = require('@jeli/cli-utils');
const htmlParser = require('./html_parser');
const { CoreQuerySelector } = require('./query_selector');
const { outputApplicationFiles, outputLibraryFiles, pushStyle, styleChanges } = require('./output');
const { findTokenInGlobalImports, isExportedToken, getPipeProvider } = require('./compilerobject');
const { attachViewSelectorProviders } = require('./view.provier');
const annotationProps = ['name', 'selector', 'exportAs', 'module'];

/**
 * 
 * @param {*} compilerObject 
 * @param {*} entry 
 * @param {*} fileChanged 
 */
async function CoreGenerator(compilerObject, entry, changes) {
    let scriptBody = '';
    /**
     * 
     * @param {*} definition 
     */
    function compile(definition, filePath) {
        switch (definition.type.toLowerCase()) {
            case ('service'):
            case ('provider'):
            case ('pipe'):
                _resolveDependecies(compilerObject.Service[definition.fn], definition.fn, filePath);
                definition.annotations.push(`${definition.fn}.annotations = ${writeAnnot(compilerObject.Service[definition.fn], annotationProps)};`);
                quoteFix(annotationProps, compilerObject.Service[definition.fn]);
                if (compilerObject.Service[definition.fn].static) {
                    definition.annotations.push(`${definition.fn}.annotations.instance = ${definition.fn};`);
                }
                break;
            case ('directive'):
            case ('element'):
                const obj = compilerObject[definition.type][definition.fn];
                if (!obj.module) {
                    helper.abort(`${helper.colors.yellow(definition.fn)} is not registered to any Module`);
                }
                const template = obj.template;
                const style = obj.style;
                delete obj.template;
                delete obj.style;
                _resolveDependecies(obj, definition.fn, filePath);
                definition.annotations.push(`${definition.fn}.annotations = ${writeAnnot(obj, annotationProps)};`);
                quoteFix(annotationProps, obj);
                if (helper.is(definition.type, 'Element')) {
                    if (template) {
                        const parsedHtml = htmlParser(template, obj, compilerResolver, definition.fn);
                        if (parsedHtml.errorLogs.length) {
                            helper.console.header(`TemplateCompilerError -> Element<${definition.fn}> : ${filePath}`);
                            parsedHtml.errorLogs.forEach(helper.console.error);
                        }
                        definition.annotations.push(`${definition.fn}.view = /** jeli template **/ new ViewParser(${attachViewProviders(filePath, parsedHtml)}, ${JSON.stringify(parsedHtml.templatesMapHolder)}) /** template loader **/;`);
                    }

                    // style parser
                    if (style) {
                        pushStyle({
                            name: definition.fn,
                            style,
                            elementFilePath: filePath
                        });
                        // definition.annotations.push(`${definition.fn}.style = ${helper.stringifyContent(style)};`);
                    }
                }
                break;
            case ('jmodule'):
                /**
                 * compile @config and @initializers
                 */
                if (compilerObject.jModule[definition.fn].rootElement) {
                    definition.annotations.push(`${definition.fn}.rootElement = ${compilerObject.jModule[definition.fn].rootElement};`)
                }

                if (compilerObject.jModule[definition.fn].requiredModules) {
                    definition.annotations.push(`!function(){/** bootstrap module**/${writeAnnot(compilerObject.jModule[definition.fn].requiredModules)}.forEach(function(_module){ _module()});\n}();`);
                }
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
     * @param {*} processFilePath 
     * @param {*} parsedHtml 
     */
    function attachViewProviders(processFilePath, parsedHtml) {
        const imports = compilerObject.files[processFilePath].imports;
        let output = JSON.stringify(parsedHtml.parsedContent);
        attachViewSelectorProviders(parsedHtml.providers, compilerObject, imports).forEach(replaceProviders);

        function replaceProviders(providerName) {
            output = output.replace(new RegExp(`"%${providerName}%"`, 'g'), providerName);
        }

        return output;
    }

    /**
     * 
     * @param {*} obj 
     * @param {*} fn 
     * @param {*} filePath 
     */
    function _resolveDependecies(obj, fn, filePath) {
        if (obj.DI) {
            Object.keys(obj.DI).forEach(name => {
                const config = obj.DI[name];
                const service = compilerResolver.getService(name, filePath);
                if (!service && !config.optional) {
                    helper.console.error(`Unable to resolve depenedecy: ${helper.colors.yellow(name)} -> ${helper.colors.yellow(fn)} in ${helper.colors.yellow(filePath)}`);
                }

                if (service) {
                    if (service.DI && service.DI.hasOwnProperty(fn)) {
                        helper.console.error(`Found circular dependency: ${helper.colors.yellow(fn)} -> ${helper.colors.yellow(name)} in ${helper.colors.yellow(filePath)}`);
                    }

                    config.factory = name;
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
                _compileOnBootStrapFns(compilerObject.jModule[moduleName], state);
            });
        }
    }

    function generateScriptBody() {
        return Object.keys(compilerObject.output.modules)
            .reduce((accum, filePath) => scriptGeneratorParser(accum, filePath), [])
            .concat(compilerObject.output.global).join('\n')

        /**
         * 
         * @param {*} output 
         * @param {*} filePath 
         */
        function scriptGeneratorParser(output, filePath) {
            if (changes && changes.filePath && !helper.is(changes.filePath, filePath)) {
                return output;
            }

            const element = compilerObject.output.modules[filePath];
            if (element.annotations) {
                for (const annotation of element.annotations) {
                    element.source.push(compile(annotation, filePath));
                }
            }

            if (isLib) {
                output.push(element.source.join(''));
            }

            return output;
        }

    }

    const compilerResolver = {
        getFn: directiveConfiguration => directiveConfiguration && directiveConfiguration.map(def => def.fn),
        getElement: (selector, component, module) => {
            return CoreQuerySelector(compilerObject, 'Element', selector, component);
        },
        getDirectives: (selector, element, component, module) => {
            return CoreQuerySelector(compilerObject, 'Directive', selector, component, element);
        },
        getModule: moduleName => compilerObject.jModule[moduleName],
        getService: (serviceName, filePath) => {
            if (compilerObject.Service.hasOwnProperty(serviceName)) {
                return compilerObject.Service[serviceName];
            }

            const inGlobalImports = findTokenInGlobalImports(serviceName, compilerObject, 'Service');
            if (inGlobalImports) {
                return inGlobalImports[serviceName] || {
                    internal: true
                }
            }

            return isExportedToken(serviceName, compilerObject);
        },
        getPipe: pipeName => {
            return getPipeProvider(pipeName, compilerObject)
        }
    };
    const isLib = helper.is('library', compilerObject.options.type);
    scriptBody = generateScriptBody();
    /**
     * save files
     */
    if (isLib) {
        await outputLibraryFiles(compilerObject, scriptBody, entry);
    } else {
        await outputApplicationFiles(compilerObject, scriptBody, changes);
    }
}

module.exports = async function(compilerObject, changes) {
    for (const name in compilerObject) {
        if (changes && changes.isStyles) {
            styleChanges(compilerObject[name], changes);
        } else {
            await CoreGenerator(compilerObject[name], name, changes);
        }
    }
};