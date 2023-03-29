'use strict';
const { compiler, singleCompiler } = require('./core/compiler');
const generator = require('./core/generator');
const { CompilerObject, session } = require('./core/compilerobject');
const helper = require('@jeli/cli/lib/utils');
const loader = require('./core/loader');
const ComponentsResolver = require('./core/components.facade');
const getAssetItem = (filePath, list) => (list || []).find(item  => filePath.includes(item.src));

//start spinner
exports.builder = async function(projectSchema, buildOptions, resolveSchema) {
    if (!projectSchema){
        loader.spinner.stop();
        return helper.console.error(`Invalid or no configuration specified`);
    } 
    
    try {
        const compilerObject = await CompilerObject(projectSchema, buildOptions, resolveSchema);
        for (const name in compilerObject) {
            const componentsResolver = new ComponentsResolver(compilerObject[name]);
            await compiler(componentsResolver);
            await generator.generateApp(componentsResolver, name);
        }

        if (buildOptions.watch) {
            session.save(compilerObject);
        }
    } catch (e) {
        console.log(e);
        helper.abort(`\n${e.message}`);
    }

    return true;
};

/**
 * 
 * @param {*} filePath 
 * @param {*} eventType 
 */
exports.buildByFileChanges = async function(filePath, eventType) {
    const { saveApplicationView } = require('./core/output');
    const compilerObject = session.get();
    const indexObject = Object.values(compilerObject)[0];
    const componentsResolver = new ComponentsResolver(indexObject);
    const indexPath = (`${indexObject.options.sourceRoot}/${indexObject.options.output.view}`);
    const isAssetsChanges = getAssetItem(filePath, indexObject.options.output.copy);
    if (helper.is(eventType, 'change') && !isAssetsChanges) {
        helper.console.clear(`\nre-compiling ${helper.colors.green(filePath)}...\n`);
        // index.html file changes
        // dont require complete compilation
        if (helper.is(indexPath, filePath))
            await saveApplicationView(indexObject);
        else
            await compileFileChanges();
    } else if (isAssetsChanges) {
        helper.console.clear(`\ncopying file ${helper.colors.green(filePath)}...\n`);
        generator.updatesAppAssets(filePath, indexObject, isAssetsChanges);
    }

    /**
     * compile file changes
     */
    async function compileFileChanges() {
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
};