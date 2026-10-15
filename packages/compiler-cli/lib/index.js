'use strict';
const { compiler, singleCompiler } = require('./core/compiler');
const generator = require('./core/generator');
const { CompilerObject, session } = require('./core/compilerobject');
const helper = require('@jeli/cli/lib/utils');
const loader = require('./core/loader');
const ComponentsResolver = require('./core/components.facade');
const getAssetItem = (filePath, list) => (list || []).find(item  => filePath.includes(item.src));

//start spinner
class CoreCompiler {
    /**
     * 
     * @param {*} projectSchema 
     * @param {*} buildOptions 
     * @param {*} resolveSchema 
     * @returns 
     */
    static async builder(projectSchema, buildOptions, resolveSchema) {
        if (!projectSchema){
            return helper.console.error(`Invalid or no configuration specified`);
        }
        
        loader.startSpinner();
        let passed = true;
        try {
            const compilerObject = await CompilerObject(projectSchema, buildOptions, resolveSchema);
            for (const name in compilerObject) {
                const componentsResolver = new ComponentsResolver(compilerObject[name]);
                await compiler(componentsResolver);
                await generator.generateApp(componentsResolver, name);
            }
    
            if (buildOptions && buildOptions.watch) {
                session.save(compilerObject);
            }
            loader.spinner.stop();
        } catch (e) {
            loader.spinner.stop();
            console.log(e);
            helper.abort(`\n${e.message}`);
            passed = false;
        }
    
        return passed;
    }

    /**
     * 
     * @param {*} filePath 
     * @param {*} eventType 
     * @param {*} isExternalModule 
     * @returns 
     */
    static async buildByFileChanges(filePath, eventType, isExternalModule) {
        const { saveApplicationView } = require('./core/output');
        const compilerObject = session.get();
        const indexObject = Object.values(compilerObject)[0];
        const componentsResolver = new ComponentsResolver(indexObject);
        const indexPath = (`${indexObject.options.sourceRoot}/${indexObject.options.output.view}`);
        const isAssetsChanges = getAssetItem(filePath, indexObject.options.output.copy);
        // 'add' is treated the same as 'change': a file new to the watcher is also
        // new to the componentsResolver registry, so compileFileChanges/singleCompiler
        // registers it for the first time (cleanFileEntry no-ops on an unseen filePath).
        const isCompilableChange = helper.is(eventType, 'change') || helper.is(eventType, 'add');
        if (isExternalModule || (isCompilableChange && !isAssetsChanges)) {
            helper.console.clear(`\nre-compiling ${helper.colors.green(filePath)}...\n`);
            // index.html file changes
            // dont require complete compilation
            if (helper.is(indexPath, filePath))
                await saveApplicationView(indexObject);
            else
                await compileFileChanges();
        } else if (isAssetsChanges) {
            helper.console.clear(`\ncopying file ${helper.colors.green(filePath)}...\n`);
            await generator.updatesAppAssets(filePath, indexObject, isAssetsChanges);
        } else if (helper.is(eventType, 'unlink')) {
            helper.console.clear(`\nremoving ${helper.colors.green(filePath)}...\n`);
            await removeFileChanges();
        }

        /**
         * a source file was deleted (or moved away): clear its Element/Directive/
         * Service/jModule registrations and file/output cache entries so a stale
         * class name doesn't collide with whatever gets registered in its place,
         * then regenerate output so the bundle drops it.
         */
        async function removeFileChanges() {
            const components = ['Directive', 'Element', 'Pipe', 'Service', 'jModule'];
            componentsResolver.cleanFileEntry(filePath, components);
            const ext = loader.getExt(filePath);
            await generator.generateApp(componentsResolver, null, {
                filePath,
                ext,
                isStyles: helper.isContain(ext, ['.css', '.scss'])
            });
            return true;
        }

        /**
         * compile file changes
         */
        async function compileFileChanges() {
            // recompile a fresh instance
            if (isExternalModule) {
                componentsResolver.resetCompileObject(filePath);
                await compiler(componentsResolver);
                await generator.generateApp(componentsResolver);
                return true;
            }
    
            const ext = loader.getExt(filePath);
            const fileChanges = {
                filePath,
                ext,
                isStyles: helper.isContain(ext, ['.css', '.scss'])
            };
    
            helper.console.clear('');
            const recompile  = ['.js','.gs','.html'].includes(ext);
            if (indexObject.output.templates.hasOwnProperty(filePath)) {
                fileChanges.filePath = indexObject.output.templates[filePath];
            }
            
            if (recompile) await singleCompiler(componentsResolver, fileChanges);
            await generator.generateApp(componentsResolver, null, fileChanges);
            return true;
        }
    
        return true;
    }
}

// exports the compiler
module.exports = CoreCompiler;