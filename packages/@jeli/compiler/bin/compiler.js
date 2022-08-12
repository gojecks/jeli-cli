#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const minimist = require('minimist');
const args = minimist(process.argv);
const jeliUtils = require('@jeli/cli-utils');
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
    const jeliCompiler = require('../lib/index');
    if (args.all) {
        for (const name in config.projects) {
            await jeliCompiler.builder(config.projects[name], packageJSONParams, config.resolve);
        }
    } else {
        await jeliCompiler.builder(config.projects[args.entry || config.default], packageJSONParams, config.resolve);
    }
};

build();