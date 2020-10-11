'use strict';
const { compiler, singleCompiler } = require('./core/compiler');
const generator = require('./core/generator');
const { CompilerObject, session } = require('./core/compilerobject');
const helper = require('@jeli/cli-utils');
const { getExt, spinner } = require('./core/loader');
const { option } = require('grunt');

const coreBuilder = async(config, options) => {
    if (!config) helper.console.error(`Invalid or no configuration specified`);
    const compilerObject = await CompilerObject(config, options);
    await compiler(compilerObject);
    spinner.stop();
    await generator(compilerObject);

    return compilerObject;
};

exports.builder = async function(jeliSchema, buildOptions) {
    const instance = await coreBuilder(jeliSchema, buildOptions);
    if (buildOptions.watch) {
        session.save(instance);
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
    helper.console.clear(`\nre-compiling ${helper.colors.green(filePath)}...\n`);
    const compilerObject = session.get();
    const indexObject = Object.values(compilerObject)[0];
    const indexPath = (`${indexObject.options.sourceRoot}/${indexObject.options.output.view}`);

    if (helper.is(eventType, 'change')) {
        // index.html file changes
        // dont require complete compilation
        if (helper.is(indexPath, filePath))
            await saveApplicationView(indexObject);
        else
            await compileFileChanges();
    } else {

    }

    /**
     * compile file changes
     */
    async function compileFileChanges() {
        const ext = getExt(filePath);
        const fileChanges = {
            filePath,
            ext,
            isStyles: helper.isContain(ext, ['.css', '.scss'])
        };

        helper.console.clear('');
        switch (ext) {
            case ('.html'):
            case ('.js'):
                if (indexObject.output.templates.hasOwnProperty(filePath)) {
                    fileChanges.filePath = indexObject.output.templates[filePath];
                }

                await singleCompiler(indexObject, fileChanges);
                await generator(compilerObject, fileChanges);
                break;
            case ('.css'):
            case ('.scss'):
                await generator(compilerObject, fileChanges);
                break;
        }

        return true;
    }

    return true;
};