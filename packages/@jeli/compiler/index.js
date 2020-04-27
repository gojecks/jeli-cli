'use strict';
const loader = require('./lib/core/loader');
const compiler = require('./lib/core/compiler');
const generator = require('./lib/core/generator');
const { CompilerObject, session } = require('./lib/core/compilerobject');
const helper = require('@jeli/cli-utils');

const coreBuilder = async(config) => {
    if (!config) helper.console.error(`Invalid or no configuration specified`);
    const compilerObject = await CompilerObject(config);
    await compiler(compilerObject, loader);
    await generator(compilerObject, loader);

    return compilerObject;
};

exports.builder = async function(jeliSchema, buildOptions) {
    const instance = await coreBuilder(jeliSchema);
    if (buildOptions.watch) {
        session.save(instance);
    }

    loader.spinner.stop();
    return true;
};

/**
 *  
 * @param {*} fileChanged 
 */
exports.buildByFileChanges = async function(fileChanged) {
    const { saveApplicationView } = require('./lib/core/output');
    helper.console.clear(`\nre-compiling ${helper.colors.green(fileChanged)}...\n`);
    const compilerObject = session.get();
    const indexObject = Object.values(compilerObject)[0];
    const indexPath = (`${indexObject.options.sourceRoot}/${indexObject.options.output.view}`);
    // index.html file changes
    // dont require complete compilation
    if (helper.is(indexPath, fileChanged)) {
        await saveApplicationView(indexObject);
    } else {
        await appBuild(compilerObject, loader);
        await appGenerator(compilerObject, loader);
    }

    return true;
};