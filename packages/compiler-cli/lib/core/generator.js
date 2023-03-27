const helper = require('@jeli/cli/lib/utils');
const htmlParser = require('./html_parser');
const loader = require('./loader');
const { outputApplicationFiles, outputLibraryFiles, pushStyle, styleChanges, copyAndUpdateAssetsFile } = require('./output');
const { attachViewSelectorProviders } = require('./view.provider');
const annotationProps = ['name', 'selector', 'exportAs', 'module'];
/**
 * 
 * @param {*} compilerObject 
 * @param {*} entry 
 * @param {*} fileChanged 
 */
async function CoreGenerator(componentsResolver, entry, changes) {
    const compilerObject = componentsResolver.compilerObject;
    const isLib = helper.is('library', compilerObject.options.type);
    const viewSelectorProvider = attachViewSelectorProviders(compilerObject, isLib);

    /**
     * 
     * @param {*} ctors 
     * @param {*} definition 
     * @returns ctors 
     */
    const getCtors = (ctors, definition) => ctors.reduce((accum, key) => (((definition[key]) ? accum[key] = definition[key] : null), accum), {});
    /**
     * 
     * @param {*} definition 
     */
    function compile(definition, filePath) {
        let obj = null;
        let ctorAttrs = [];
        switch (definition.type.toLowerCase()) {
            case ('service'):
            case ('pipe'):
                obj = compilerObject.Service[definition.fn];
                ctorAttrs = ['name', 'DI'];
                // attach ctor attributes
                attachCtorToDefinition();
                if (obj.static) {
                    definition.annotations.push(`${definition.fn}.ctors.instance = ${definition.fn};`);
                }
                break;
            case ('directive'):
            case ('element'):
                obj = compilerObject[definition.type][definition.fn];
                if (!obj.module) {
                    helper.console.warn(`${helper.colors.yellow(definition.fn)} is not registered to any Module`);
                    return;
                }
                // attach ctor attributes
                ctorAttrs = ['selector', 'events', 'exposeView', 'props', 'DI', 'resolve', 'exportAs']
                attachCtorToDefinition();
                if (helper.is(definition.type, 'Element')) {
                    generateElementAst();
                }
                break;
            case ('jmodule'):
                /**
                 * compile @config and @initializers
                 */
                if (compilerObject.jModule[definition.fn].rootElement) {
                    definition.annotations.push(`${definition.fn}.rootElement = ${compilerObject.jModule[definition.fn].rootElement};`)
                }

                if (compilerObject.jModule[definition.fn].requiredModules && compilerObject.jModule[definition.fn].requiredModules.length) {
                    const requiredModule = compilerObject.jModule[definition.fn].requiredModules; // .map(dep => (!componentsResolver.hasModule(dep) ? `%${dep}%` : dep));
                    definition.annotations.push(`${definition.fn}.fac = () =>/** bootstrap module**/${helper.objectStringToAsIs(requiredModule)}.forEach(m => { if(!m.k && typeof m == 'function') return (m.fac && m.fac(), m(), m.k = 1); });\n;`);
                }
                break;
        }


        function attachCtorToDefinition() {
            const ctors = getCtors(ctorAttrs, obj);
            definition.annotations.push(`${definition.fn}.ctors = ${helper.objectStringToAsIs(ctors, annotationProps)};`);
            helper.quoteFix(annotationProps, obj);
        }

        function generateElementAst() {
            let template = obj.template;
            let styleUrl = obj.styleUrl;
            const style = obj.style;
            if (styleUrl) {
                styleUrl = loader.joinFilePath(filePath, '..', styleUrl);
                compilerObject.output.styles[styleUrl] = filePath;
            }

            // style parser
            if (style || styleUrl) {
                pushStyle({
                    name: definition.fn,
                    selector: obj.selector,
                    style,
                    styleUrl,
                    elementFilePath: filePath
                });
            }

            if (obj.templateUrl) {
                const templatePath = loader.joinFilePath(filePath, '..', obj.templateUrl);
                template = loader.templateContentLoader(templatePath);
                compilerObject.output.templates[templatePath] = filePath;
            }

            if (template) {
                const parsedHtml = htmlParser(template, obj, componentsResolver, definition.fn, !!changes);
                if (parsedHtml.errorLogs.length) {
                    helper.console.header(`TemplateCompilerError -> Element<${definition.fn}> : ${filePath}`);
                    parsedHtml.errorLogs.forEach(helper.console.error);
                }

                if (!parsedHtml.pendingDependencies) {
                    pushView(definition, filePath, parsedHtml);
                } else {
                    definition.pending = parsedHtml;
                }
            }

            // remove template and styles mapping
            ['template', 'templateUrl', 'styleUrl', 'style', 'viewChild', 'viewChildren'].forEach(key => (delete obj[key]));
        }
    }

    /**
     * 
     * @param {*} definition 
     * @param {*} filePath 
     * @param {*} parsedHtml 
     */
    function pushView(definition, filePath, parsedHtml) {
        definition.annotations.push(`${definition.fn}.view = /** jeli template **/ ${generateView(filePath, parsedHtml)}/** template loader **/`);
    }

    /**
     * 
     * @param {*} t 
     * @param {*} prop 
     * @returns 
     */
    function tmplToScript(t, viewRef, childVar) {
        var s = ``;
        if (t) {
            var templates = null;
            var children = null;
            if (t.templates) {
                templates = constructTemplate(t.templates);
            }

            if (t.children) {
                children = `function(parentRef){${constructContents(t.children, 'parentRef')}.forEach(function(child,i){if(child){parentRef.children.add(child, i); parentRef.nativeElement.appendChild(child.nativeElement || child.nativeNode); } });}`;
            }

            if (t.type === 3) {
                s += `core["ViewParser"].builder.text(${JSON.stringify(t.ast || null)}, ${viewRef})`;
            } else {
                const definitions = ['name', 'text', 'index', 'vc', 'isc', 'attr', 'props', 'providers'].reduce((accum, key) => { if (t.hasOwnProperty(key)) { accum[key] = t[key]; } return accum; }, {});
                s += `core["ViewParser"].builder.${t.type}(${JSON.stringify(definitions)}, ${viewRef}, ${children}, ${templates})`;
            }
        }

        return `${s}`;
    }

    /**
     * 
     * @param {*} templates 
     * @returns 
     */
    function constructTemplate(templates) {
        var ret = [];
        for (const tprop in templates) {
            const tid = `${tprop}_tmpl`;
            ret.push(`${tprop}: function(){ return ${tmplToScript(templates[tprop], tid)}}`);
        }
        return `{${ret.join(',')}}`;
    }

    /**
     * 
     * @param {*} templates 
     */
    function constructContents(templates, viewRef) {
        const contents = templates.map((child, idx) => {
            return tmplToScript(child, viewRef, `${viewRef}_child_${idx}`);
        });

        return `[${contents.join(',')}]`;
    }


    /**
     * 
     * @param {*} processFilePath 
     * @param {*} parsedHtml 
     */
    function generateView(processFilePath, parsedHtml) {
        const imports = compilerObject.files[processFilePath].imports;
        const templateKeys = Object.keys(parsedHtml.templatesMapHolder);
        let output = '';
        if (compilerObject.buildOptions.AOT) {
            output = `var $tmpl=${constructTemplate(parsedHtml.templatesMapHolder)}; ${constructContents(parsedHtml.parsedContent, 'viewRef')};`;
        } else {
            output = `function(){ 'use strict'; var compiler = new core["ViewParser"].JSONCompiler( (id) => (${replaceTemplateMappers(parsedHtml.templatesMapHolder, true)}[id]) );  return function(viewRef){ return compiler.compile(${replaceTemplateMappers(parsedHtml.parsedContent)}, viewRef);}}()`;
        }

        viewSelectorProvider(parsedHtml.providers, imports).forEach(replaceProviders);

        function replaceProviders(viewProvider) {
            output = output.replace(new RegExp(`"%${viewProvider.providerName}%"`, 'g'), !viewProvider.outputName ? `${viewProvider.providerName}` : `${viewProvider.outputName}.${viewProvider.providerName}`);
        }

        /**
         * 
         * @param {*} template 
         * @param {*} attachWrapper 
         * @returns 
         */
        function replaceTemplateMappers(template, attachWrapper) {
            return JSON.stringify(template).replace(new RegExp(`"<%(.*?)%>"`, 'g'), (_, expr) => {
                if (expr.startsWith('compiler')) return expr;
                if (expr === 'GT') return `compiler._GT`;
                const templateExpr = expr.split('|');
                const tmpscript = `compiler._GT('${templateExpr[0]}', ${templateExpr[1] ? JSON.stringify(parsedHtml.templateOptionsMapper[templateExpr[1]]) : null})`;
                return `${attachWrapper ? 'function(){ return ' + tmpscript + ';}' : tmpscript}`;
            });
        }

        return output;
    }

    function generateScript(definition) {
        return `/** compiled ${definition.fn} **/\nvar ${definition.fn} = function(){\n"use strict";\n\n${definition.annotations.join('\n\n')}\nreturn ${definition.fn};\n}();\n`;
    }

    function compileModules() {
        const pendingCompilation = [];
        for (const filePath in compilerObject.output.modules) {
            scriptGeneratorParser(filePath);
        }
        // recompile all pending scripts
        if (pendingCompilation.length) {
            while (pendingCompilation.length) {
                const pending = pendingCompilation.pop();
                const implementation = compilerObject.output.modules[pending.filePath];
                if (pending.annotation.pending) {
                    pushView(pending.annotation, pending.filePath, pending.annotation.pending);
                    delete pending.annotation.pending;
                    implementation.source.push(generateScript(pending.annotation));
                }
            }
        }

        /**
         * 
         * @param {*} filePath 
         */
        function scriptGeneratorParser(filePath) {
            if (changes && changes.filePath && !helper.is(changes.filePath, filePath)) {
                return;
            }

            const implementation = compilerObject.output.modules[filePath];
            if (implementation.annotations) {
                for (const annotation of implementation.annotations) {
                    compile(annotation, filePath);
                    if (!annotation.pending) {
                        implementation.source.push(generateScript(annotation));
                    } else {
                        pendingCompilation.push({ filePath, annotation })
                    }
                }
            }
        }
    }

    compileModules();

    /**
     * save files
     */
    helper.writeline('');
    if (isLib) {
        await outputLibraryFiles(compilerObject, entry);
    } else {
        await outputApplicationFiles(compilerObject, changes);
    }
}

exports.generateApp = async function (componentsResolver, name, changes) {
    if (changes && changes.isStyles) {
        styleChanges(componentsResolver.compilerObject, changes);
    } else {
        await CoreGenerator(componentsResolver, name, changes);
    }
};

exports.updatesAppAssets = copyAndUpdateAssetsFile;