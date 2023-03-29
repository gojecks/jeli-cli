const fs = require('fs-extra');
const path = require('path');
const minimist = require('minimist');
const args = minimist(process.argv);
const jeliUtils = require('@jeli/cli/lib/utils');
const jeliCompiler = require('../lib/index');
const packageJSONParams = ['version'].reduce((accum, prop) => { accum[prop] = args[prop]; return accum }, {});


if (args.f && fs.existsSync(path.resolve(args.f))) {
    process.chdir(args.f);
}

const configPath = path.resolve('./jeli.json');
if (!fs.existsSync(configPath)) {
    jeliUtils.abort('Configuration filePath is required');
}

async function build() {
    const config = fs.readJSONSync(configPath);
    if (args.all) {
        for (const name in config.projects) {
            await jeliCompiler.builder(config.projects[name], packageJSONParams, config.resolve);
        }
    } else {
        const projectSchema = config.projects[args.entry || config.default];
        if (!projectSchema) {
            const projectList = Object.keys(config.projects).map(n => jeliUtils.writeColor(n, 'yellow')).join('\n');
            jeliUtils.console.write(`List of available projets:\n ${projectList}`);
            jeliUtils.console.error(`\nProject ${jeliUtils.writeColor(args.entry, 'bold')} doesn't exists`);
        }
        await jeliCompiler.builder(projectSchema, packageJSONParams, config.resolve);
        
    }
};

build();