const envInfo = require('envinfo');
exports.cliInfo = _ => {
    envInfo.run({
        System: ['OS', 'CPU'],
        Binaries: ['Node', 'Yarn', 'npm'],
        Browsers: ['Chrome', 'Edge', 'Firefox', 'Safari'],
        npmPackages: '/**/{jeli*,@jeli/*/}',
        npmGlobalPackages: ['@jeli/cli']
    }, {
        showNotFound: true,
        duplicates: true,
        fullTree: true
    }).then(console.log);
}

exports.asDefined = async(input, output) => {
    return await envInfo.run(input, output);
}