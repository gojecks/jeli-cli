const execaAsync = import('execa');
const envInfo = require('../info');
const jeliUtils = require('../utils');
const execCommand = async(cmd, args, cwd) => {
    const execa = await execaAsync;
    return execa.execa(cmd, args, { stdio: 'inherit', cwd });
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
    console.log(jeliUtils.colors.bold('📦  Installing dependencies...\n'));
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
    } catch (err) {
        jeliUtils.console.error(err.message);
        jeliUtils.console.error('\nError while installing dependencies\nPlease resolve error and run ' + jeliUtils.colors.yellow(`"${cmd} install"\n`))
        throw false;
    }
}