const helper = require('@jeli/cli/lib/utils');
const htmlParser = require('./html_parser');
const loader = require('./loader');
const aotCompiler = require('./compilers/aot');
const jitCompiler = require('./compilers/jit');
const { outputApplicationFiles, outputLibraryFiles, pushStyle, styleChanges, copyAndUpdateAssetsFile } = require('./output');
const { attachViewSelectorProviders } = require('./view.provider');
const { ckeyWords } = require('../utils/keywords');
const annotationProps = [ckeyWords.NAME, ckeyWords.SELECTOR, ckeyWords.EXPORTAS, ckeyWords.MODULE];
/**
 * 
 * @param {*} compilerObject 
 * @param {*} entry 
 * @param {*} fileChanged 
 */
async function CoreGenerator(componentsResolver, entry, changes) {
    const compilerObject = componentsResolver.compilerObject;
    const viewSelectorProvider = attachViewSelectorProviders(compilerObject);

    /**
     * 
     * @param {*} ctors 
     * @param {*} definition 
     * @returns ctors 
     */
    const getCtors = (ctors, definition) => ctors.reduce((accum, key) => (((definition[key]) ? accum[key] = definition[key] : null), accum), {});

    /**
     * compiles each annotation type found in project workspace
     * @param {*} definition 
     * @param {*} filePath 
     * @returns 
     */
    async function annotationViewCompiler(definition, filePath) {
        let ctor = null;
        let ctorAttrs = [];
        const annotationName = definition.type.toLowerCase();

        if ([ckeyWords.SERVICE, ckeyWords.PIPE].includes(annotationName)) {
            ctor = compilerObject.Service[definition.fn];
            ctorAttrs = [ckeyWords.DI];
            // attach ctor attributes
            attachCtorToDefinition();
            if (ctor.static) {
                definition.annotations.push(`${definition.fn}.ctors.instance = ${definition.fn};`);
            }
        } else if ([ckeyWords.DIRECTIVE, ckeyWords.ELEMENT].includes(annotationName)) {
            ctor = compilerObject[definition.type][definition.fn];
            if (!ctor.module && !ctor.standAlone) {
                helper.console.warn(`${helper.colors.yellow(definition.fn)} is not registered to any Module`);
                return;
            }

            if (ctor.module && ctor.standAlone) {
                helper.console.warn(`${helper.colors.red(definition.fn)} is registered to Module<${helper.colors.red(ctor.module)}> and cannot be standalone`);
                return;
            }
            // attach ctor attributes
            ctorAttrs = [
                ckeyWords.SELECTOR,
                ckeyWords.EVENTS,
                ckeyWords.EXPOSEVIEW,
                ckeyWords.PROPS,
                ckeyWords.DI,
                ckeyWords.RESOLVE,
                ckeyWords.EXPORTAS,
                ckeyWords.ASNATIVE
            ];

            attachCtorToDefinition();
            if (helper.is(definition.type, 'Element')) {
                await generateElementAst();
            }
        } else if (annotationName == 'jmodule') {
            /**
             * compile @config and @initializers
             */
            if (compilerObject.jModule[definition.fn].rootElement) {
                definition.annotations.push(`${definition.fn}.rootElement = ${compilerObject.jModule[definition.fn].rootElement};`)
            }

            if (compilerObject.jModule[definition.fn].requiredModules && compilerObject.jModule[definition.fn].requiredModules.length) {
                const requiredModule = compilerObject.jModule[definition.fn].requiredModules;
                definition.annotations.push(`${definition.fn}.fac = () =>/** bootstrap module**/${helper.objectStringToAsIs(requiredModule)}.forEach(m => { if(!m.k && typeof m == 'function') return (m.fac && m.fac(), new m(), m.k = 1); });\n;`);
            }
        }


        function attachCtorToDefinition() {
            const ctors = getCtors(ctorAttrs, ctor);
            const asNative = ctors.asNative;
            if (asNative && helper.typeOf(asNative, 'object'))
                ctors.asNative = true;

            definition.annotations.push(`${definition.fn}.ctors = ${helper.objectStringToAsIs(ctors, annotationProps)};`);
            // as native web component
            if (asNative) {
                const attributes = JSON.stringify(Object.keys(ctor.props).reduce((accum, key) => (accum[helper.kebabCase(key)] = [helper.removeSingleQuote(ctor.props[key].type || '-'), key], accum), {}));
                definition.annotations.push(`\n//register webcomponent\n\tcustomElements.define('${asNative.selector || ctor.selector}', core.createCustomElement(${definition.fn}, ${attributes}));`);
            }

            helper.quoteFix(annotationProps, ctor);
        }

        /**
         * this method compiles and parses html/styles defined in a Element definition 
         */
        async function generateElementAst() {
            let template = ctor.template;
            let styleUrl = ctor.styleUrl;
            const style = ctor.style;
            if (styleUrl) {
                styleUrl = loader.joinFilePath(filePath, '..', styleUrl);
                compilerObject.output.styles[styleUrl] = filePath;
            }

            // style parser
            if (style || styleUrl) {
                await pushStyle({
                    name: definition.fn,
                    selector: ctor.selector,
                    style,
                    styleUrl,
                    elementFilePath: filePath
                }, null, compilerObject.buildOptions.assetURL);
            }

            if (ctor.templateUrl) {
                // this is used when having multiple templates defined for a one element
                // usefull when template file is growing large
                let templatePath = null;
                if (Array.isArray(ctor.templateUrl)) {
                    template = ctor.templateUrl.map(tPath => {
                        tPath = loader.joinFilePath(filePath, '..', tPath);
                        compilerObject.output.templates[tPath] = filePath;
                        return loader.templateContentLoader(tPath)
                    }).join('\n');
                } else {
                    templatePath = loader.joinFilePath(filePath, '..', ctor.templateUrl)
                    compilerObject.output.templates[templatePath] = filePath;
                    template = loader.templateContentLoader(templatePath)
                }
            }

            if (template) {
                const parsedHtml = htmlParser(template, ctor, componentsResolver, definition.fn, !!changes, compilerObject.buildOptions.assetURL);
                if (parsedHtml.errorLogs.length) {
                    helper.console.header(`\nTemplateCompilerError -> Element<${definition.fn}> : ${filePath}`);
                    parsedHtml.errorLogs.forEach(helper.console.error);
                    if(!changes){
                        helper.abort('Fix errors and try again');
                    }
                }

                if (!parsedHtml.pendingDependencies) {
                    pushView(definition, filePath, parsedHtml);
                } else {
                    definition.pending = parsedHtml;
                }
            } else if (ctor.asNative) {
                viewSelectorProvider(filePath, { createCustomElement: "@jeli/core" });
            }

            // remove unsed mapping from the ctors
            [
                ckeyWords.TEMPLATE,
                ckeyWords.TEMPLATEURL,
                ckeyWords.STYLEURL,
                ckeyWords.STYLE,
                ckeyWords.VIEWCHILD,
                ckeyWords.CONTENTCHILD,
                ckeyWords.CONTENTCHILDREN
            ].forEach(key => (delete ctor[key]));
        }
    }

    /**
     * 
     * @param {*} definition 
     * @param {*} filePath 
     * @param {*} parsedHtml 
     */
    function pushView(definition, filePath, parsedHtml) {
        const templateKeys = Object.keys(parsedHtml.templatesMapHolder);
        let output = '';
        if (compilerObject.buildOptions.AOT) {
            output = aotCompiler(parsedHtml);
        } else {
            output = jitCompiler(parsedHtml);
        }

        viewSelectorProvider(filePath, parsedHtml.providers, viewProvider => {
            output = output.replace(new RegExp(`"%${viewProvider.providerName}%"`, 'g'), !viewProvider.outputName ? `${viewProvider.providerName}` : `${viewProvider.outputName}.${viewProvider.providerName}`);
        });

        definition.annotations.push(`${definition.fn}.view = /** jeli template **/ ${output}/** template loader **/`);
    }


    function generateScript(definition) {
        return `/** compiled ${definition.fn} **/\nvar ${definition.fn} = function(){\n"use strict";\n\n${definition.annotations.join('\n\n')}\nreturn ${definition.fn};\n}();\n`;
    }

    async function compileModules() {
        const pendingCompilation = [];
        for (const filePath in compilerObject.output.modules) {
            await scriptGeneratorParser(filePath);
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
        async function scriptGeneratorParser(filePath) {
            if (changes && changes.filePath && !helper.is(changes.filePath, filePath))
                return;

            const implementation = compilerObject.output.modules[filePath];
            if (implementation && implementation.annotations) {
                for (const annotation of implementation.annotations) {
                    await annotationViewCompiler(annotation, filePath);
                    if (!annotation.pending) {
                        implementation.source.push(generateScript(annotation));
                    } else {
                        pendingCompilation.push({ filePath, annotation })
                    }
                }
            }
        }
    }

    await compileModules();

    /**
     * save files
     */
    helper.writeline('');
    if (compilerObject.isLib) {
        await outputLibraryFiles(compilerObject, entry);
    } else {
        await outputApplicationFiles(compilerObject, changes);
    }
}

exports.generateApp = async function (componentsResolver, name, changes) {
    try {
        if (changes && changes.isStyles) {
            styleChanges(componentsResolver.compilerObject, changes);
        } else {
            await CoreGenerator(componentsResolver, name, changes);
        }
    } catch (e) {
        // throw new Error('Core: Failed to compile application')
        console.error(e)
    }
};

exports.updatesAppAssets = copyAndUpdateAssetsFile;
