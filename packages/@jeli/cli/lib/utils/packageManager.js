const execa = require('execa');
const envInfo = require('../info');
const jeliUtils = require('@jeli/cli-utils');
const ora = require('@jeli/cli-utils/spinner');

const execCommand = async(cmd, args, cwd) => {
    return await execa(cmd, args, {
        cwd,
        // stdio: ['inherit', 'inherit', 'inherit']
    });

}


exports.getPackageManagerList = async() => {
    const info = await envInfo.asDefined({
        Binaries: ['Yarn', 'npm', 'pnpm']
    }, {
        showNotFound: true,
        duplicates: true,
        fullTree: true,
        json: true
    });

    return JSON.parse(info);
};

exports.install = async(cmd, cwd) => {
    const spinner = ora.start(jeliUtils.colors.bold('📦  Installing dependencies...'));
    const options = {
        npm: {
            install: ['install', '--loglevel', 'error']
        },
        yarn: {
            install: []
        }
    };

    try {
        await execCommand(cmd, options[cmd].install, cwd);
        spinner.stop();
    } catch (err) {
        spinner.fail();
        jeliUtils.console.error(err.message);
        jeliUtils.console.error('\nError while installing dependencies\nPlease resolve error and run ' + jeliUtils.colors.yellow(`"${cmd} install"\n`))
        throw false;
    }
}