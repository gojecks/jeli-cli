const inquirer = require('inquirer');
const semver = require('semver');
const globby = require('globby');
const request = require('request-promise-native');
const path = require('path');
const readline = require('readline');
const chalk = require('chalk');

exports.updateDeps = async(version, skipPrompt) => {
    // update all package deps
    const updatedDeps = new Set()
    console.log('Syncing remote deps...');
    const packages = await globby(['packages/@jeli/*/package.json']);
    const resolvedPackages = (await Promise.all(packages.concat('package.json').map(async(filePath) => {
        const pkg = require(path.resolve(__dirname, '../', filePath))
        if (!pkg.dependencies) {
            return;
        }
        const deps = pkg.dependencies;
        const resolvedDeps = [];
        for (const dep in deps) {
            if (dep.match(/^@jeli/)) {
                continue
            }
            let localVersion = deps[dep]
            if (localVersion.charAt(0) !== '^') {
                continue
            }

            localVersion = localVersion.replace(/^\^/, '')
            readline.clearLine(process.stdout)
            readline.cursorTo(process.stdout, 0)
            process.stdout.write(dep)
            const remoteVersion = await getRemoteVersion(dep)
            resolvedDeps.push({
                dep,
                localVersion,
                remoteVersion
            })
        }
        return {
            pkg,
            filePath,
            resolvedDeps
        }
    }))).filter(_ => _)

    for (const { pkg, filePath, resolvedDeps }
        of resolvedPackages) {
        let isUpdated = false
        for (const { dep, localVersion, remoteVersion }
            of resolvedDeps) {
            const isSameVer = await checkUpdateAsync(dep, filePath, localVersion, remoteVersion);
            if (remoteVersion && isSameVer) {
                pkg.dependencies[dep] = `^${remoteVersion}`
                updatedDeps.add(dep)
                isUpdated = true
            }
        }
        if (isUpdated) {
            bufferWrite(filePath, JSON.stringify(pkg, null, 2) + '\n');
        }
    }

    if (skipPrompt) {
        flushWrite()
        return
    }

    const { yes } = await inquirer.prompt([{
        name: 'yes',
        type: 'confirm',
        message: 'Commit above updates?'
    }])

    if (yes) {
        flushWrite()
    }
}

exports.prompt = async(currentVersion) => {
    const bumps = ['patch', 'minor', 'major', 'prerelease']
    const versions = {}
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
    const { yes } = await inquirer.prompt([{
        name: 'yes',
        message: `Confirm releasing ${version}?`,
        type: 'confirm'
    }]);

    return {
        yes,
        version,
        bump
    }
}


/**
 * 
 * @param {*} pkg 
 */
const remoteCache = {};
const getRemoteVersion = async(pkg) => {
    if (remoteCache[pkg]) {
        return remoteCache[pkg]
    }
    let res
    try {
        res = await request(`http://registry.npmjs.org/${pkg}/latest`, { json: true })
    } catch (e) {
        return
    }
    remoteCache[pkg] = res.version
    return res.version;
}

const pendingUpdate = {};
const bufferWrite = (file, content) => {
    pendingUpdate[file] = content
}
const flushWrite = () => {
    for (const file in pendingUpdate) {
        fs.writeFileSync(file, pendingUpdate[file])
    }
}

/**
 * 
 * @param {*} pkg 
 * @param {*} filePath 
 * @param {*} local 
 * @param {*} remote 
 */
const checkUpdateAsync = async(pkg, filePath, local, remote) => {
    if (remote !== local) {
        const isNewer = semver.gt(remote, local)
        if (!isNewer) {
            return false
        }
        const maybeBreaking = !semver.intersects(`^${local}`, `^${remote}`)
        if (!maybeBreaking) {
            return true
        }
        const { shouldUpdate } = await inquirer.prompt([{
            name: 'shouldUpdate',
            type: 'confirm',
            message: genUpdateString(pkg, filePath, local, remote, maybeBreaking) + `\n` +
                `Update this dependency?`
        }])
        return shouldUpdate
    }
}

function genUpdateString(pkg, filePath, local, remote, maybeBreaking) {
    return `${chalk.cyan(pkg)}: ${local} => ${remote} ` +
        (maybeBreaking ? chalk.red.bold(`maybe breaking `) : ``) +
        chalk.gray(`(${path.relative(process.cwd(), filePath)})`)
}