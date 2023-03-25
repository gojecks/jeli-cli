const inquirer = require('inquirer');
const semver = require('semver');
const request = require('request-promise-native');
const globby = import('globby');
const path = require('path');
const readline = require('readline');
const chalk = require('chalk');
const fs = require('fs');


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
 * @param {*} autoSyncChanges 
 * @returns 
 */
const checkUpdateAsync = async(pkg, filePath, local, remote, autoSyncChanges) => {
    if (remote !== local) {
        const isNewer = semver.gt(remote, local)
        if (!isNewer) {
            return false
        }
        const maybeBreaking = !semver.intersects(`^${local}`, `^${remote}`)
        if (!maybeBreaking || (maybeBreaking && autoSyncChanges)) {
            return true
        }
        const { shouldUpdate } = await inquirer.prompt([{
            name: 'shouldUpdate',
            type: 'confirm',
            message: genUpdateString(pkg, filePath, local, remote, maybeBreaking) + `\n` + `Update this dependency?`
        }])
        return shouldUpdate
    }
}

function genUpdateString(pkg, filePath, local, remote, maybeBreaking) {
    return `${chalk.cyan(pkg)}: ${local} => ${remote} ` +
        (maybeBreaking ? chalk.red.bold(`maybe breaking `) : ``) +
        chalk.gray(`(${path.relative(process.cwd(), filePath)})`)
}

exports.updateDeps = async(version, skipPrompt) => {
    // update all package deps
    const updatedDeps = new Set()
    console.log('Syncing remote deps...');
    const globbyInstance = await globby;
    const packages = globbyInstance.globbySync(['packages/@jeli/*/package.json']);
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

    const { autoSyncChanges } = await inquirer.prompt([{
        name: 'autoSyncChanges',
        message: `Auto sync all breaking change in dependency`,
        type: 'confirm'
    }]);

    for (const { pkg, filePath, resolvedDeps } of resolvedPackages) {
        let isUpdated = false
        for (const { dep, localVersion, remoteVersion } of resolvedDeps) {
            const isSameVer = await checkUpdateAsync(dep, filePath, localVersion, remoteVersion, autoSyncChanges);
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
