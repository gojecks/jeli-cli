const semver = require('semver')
const fs = require('fs');
const path = require('path')
const inquirer = require('inquirer');
const curVersion = fs.readFileSync('./version');
const chalk = require('chalk');
const args = require('minimist')(process.argv.slice(2))
const logStep = msg => console.log(chalk.cyan('\n' + msg))
const getPkgRoot = pkg => (pkg === 'jeli' ? path.resolve(__dirname, '../../') : path.resolve(__dirname, '../packages/@jeli/' + pkg));
const packages = fs.readdirSync(path.resolve(__dirname, '../packages/@jeli'))
    .filter(t => t !== '.DS_Store')
    .concat('jeli');

const runCommander = (function(){
    let execa = () => {};
    import('execa').then(value => execa = value);
    return (bin, args, opts = {}) => execa.execa(bin, args, { stdio: 'inherit', ...opts })
})()

async function gitTask(message, tasks) {
    const { stdout } = await runCommander('git', ['diff'], { stdio: 'pipe' });
    if (stdout) {
        logStep(message);
        for (const task of tasks) {
            await runCommander('git', task);
        }
    } else {
        console.log('No changes to commit.')
    }
}

async function publishTask(message) {
    logStep(message);
    for (const pkg of packages) {
        await publishPackage(pkg, targetVersion, runIfNotDry)
    }
    /**
     * 
     * @param {*} pkgName 
     * @param {*} version 
     * @param {*} runIfNotDry 
     * @returns 
     */
    async function publishPackage(pkgName, version, runIfNotDry) {
        const pkgRoot = getPkgRoot(pkgName)
        const pkgPath = path.resolve(pkgRoot, 'package.json')
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        const publishedName = pkg.name
        if (pkg.private) {
            return
        }

        let releaseTag = null
        if (args.tag) {
            releaseTag = args.tag
        } else if (version.includes('alpha')) {
            releaseTag = 'alpha'
        } else if (version.includes('beta')) {
            releaseTag = 'beta'
        } else if (version.includes('rc')) {
            releaseTag = 'rc'
        }

        // avoid overwriting tags for v3
        if (pkgName === 'vue' || pkgName === 'compiler-sfc') {
            if (releaseTag) {
                releaseTag = `v2-${releaseTag}`
            } else {
                releaseTag = 'v2-latest'
            }
        }

        logStep(`Publishing ${publishedName}...`)
        try {
            await runIfNotDry(
                'pnpm',
                [
                    'publish',
                    ...(releaseTag ? ['--tag', releaseTag] : []),
                    '--access',
                    'public'
                ],
                {
                    cwd: pkgRoot,
                    stdio: 'pipe'
                }
            )
            console.log(
                chalk.green(`Successfully published ${publishedName}@${version}`)
            )
        } catch (e) {
            if (e.stderr.match(/previously published/)) {
                console.log(chalk.red(`Skipping already published: ${publishedName}`))
            } else {
                throw e
            }
        }
    }
}

async function updatePackageVersionTask(message,version) {
    logStep(message);
    for (const pkg of packages) {
        const pkgPath = path.resolve(getPkgRoot(pkg), 'package.json')
        const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        pkgJson.version = version
        fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n')
    }
}

async function versionPrompt(currentVersion) {
    console.log(`Current version: ${curVersion}`)
    const bumps = ['patch', 'minor', 'major', 'prerelease']
    const versions = {};
    bumps.forEach(b => { versions[b] = semver.inc(currentVersion, b) });
    const choices = bumps.map(b => ({ name: `${b} (${versions[b]})`, value: b }))
    const { bump, customVersion } = await inquirer.prompt([{
        name: 'bump',
        message: 'Select release type:',
        type: 'list',
        choices: [
            ...choices,
            { name: 'custom', value: 'custom' }
        ]
    },
    {
        name: 'customVersion',
        message: 'Input version:',
        type: 'input',
        when: answers => answers.bump === 'custom'
    }
    ]);

    const version = customVersion || versions[bump]
    const { confirmRelease } = await inquirer.prompt([{
        name: 'confirmRelease',
        message: `Confirm releasing ${version}?`,
        type: 'confirm'
    }]);

    return {
        confirmRelease,
        version,
        bump
    }
}

module.exports = {
    versionPrompt,
    updatePackageVersionTask,
    publishTask,
    gitTask
}