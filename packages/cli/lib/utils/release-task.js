const semver = require('semver')
const fs = require('fs');
const path = require('path')
const argvs = require('minimist')(process.argv.slice(2))
const request = require('request-promise-native');
const readline = require('readline');
const jeliUtils = require('./');
const inquirerAsync = import('inquirer');
const logStep = msg => console.log(jeliUtils.writeColor('\n' + msg, 'cyan'))

module.exports = class ReleaseTaskRunner {
    remoteCache = {};
    pendingUpdate = {};
    constructor(dirPath = '', pkgManager = 'yarn', defaultPkg = 'jeli', cliVersion='') {
        this.pkgManager = pkgManager;
        this.dirPath = dirPath;
        this.defaultPkg = defaultPkg;
        this.cliVersion = cliVersion;
        this.currentVersion = require(path.resolve(dirPath, '../package.json')).version;
        this.packages = fs.readdirSync(dirPath)
            .filter(t => t !== '.DS_Store')
            .concat(defaultPkg)
        import('execa').then(value => this.execa = value);
    }

    getPkgRoot(pkg) {
        return (pkg === this.defaultPkg ? path.resolve(this.dirPath, '../') : `${this.dirPath}/${pkg}`);
    }

    getPkgJson(pkgRoot) {
        const pkgPath = path.resolve(pkgRoot, 'package.json')
        return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    }

    async gitCommitTask(message, tasks) {
        logStep(message);
        const { stdout } = await this.runCommander('git', ['diff'], { stdio: 'pipe' });
        if (stdout) {
            for (const task of tasks) {
                await this.runCommander('git', task);
            }
        } else {
            console.log('No changes to commit.')
        }
    }

    async gitPushTask(message, tasks){
        logStep(message);
        for (const task of tasks) {
            await this.runCommander('git', task);
        }
    }

    async runCommander(bin, args, opts = {}) {
        if (!argvs.dry) return this.execa.execa(bin, args, { stdio: 'inherit', ...opts })
        return (console.log(jeliUtils.colors.blue(`[dryRun] ${bin} ${args.join(' ')}`), opts), {})
    }

    async publishTask(message) {
        logStep(message);
        /**
         * 
         * @param {*} pkgName 
         * @returns 
         */
        const publishPackage = async (pkgName) => {
            const pkgRoot = this.getPkgRoot(pkgName)
            const pkg = this.getPkgJson(pkgRoot);
            const publishedName = pkg.name
            if (pkg.private) {
                return
            }

            let releaseTag = null
            if (argvs.tag) {
                releaseTag = argvs.tag
            } else if (this.targetVersion.includes('alpha')) {
                releaseTag = 'alpha'
            } else if (this.targetVersion.includes('beta')) {
                releaseTag = 'beta'
            } else if (this.targetVersion.includes('rc')) {
                releaseTag = 'rc'
            }

            logStep(`Publishing ${publishedName}...`)
            try {
                await this.runCommander(this.pkgManager,
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
                );
                console.log(jeliUtils.colors.green(`Successfully published ${publishedName}@${this.targetVersion}`))
            } catch (e) {
                if (e.stderr.match(/previously published/)) {
                    console.log(jeliUtils.colors.red(`Skipping already published: ${publishedName}`))
                } else {
                    throw e
                }
            }
        };

        for (const pkg of this.packages) {
            await publishPackage(pkg)
        }
    }

    async updatePackageVersionTask(message) {
        logStep(message);
        for (const pkg of this.packages) {
            if (argvs.dry) console.log(jeliUtils.colors.blue(`[dryRun] updating ${pkg} package version`), this.targetVersion)
            else {
                const pkgRoot = this.getPkgRoot(pkg);
                const pkgJson = this.getPkgJson(pkgRoot)
                pkgJson.version = this.targetVersion;
                fs.writeFileSync(path.resolve(pkgRoot, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n')
            }
        }
    }

    async versionPrompt() {
        console.log(`Current version: ${this.currentVersion}`)
        const bumps = ['patch', 'minor', 'major', 'prerelease']
        const versions = {};
        bumps.forEach(b => { versions[b] = semver.inc(this.currentVersion, b) });
        const choices = bumps.map(b => ({ name: `${b} (${versions[b]})`, value: b }))
        if (this.cliVersion){
            choices.push({name:`Same as cli (${this.cliVersion})`, value: 'cli'});
            versions['cli'] = this.cliVersion;
        }

        const { bump, customVersion } = await this.prompt([{
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
        
        this.targetVersion = customVersion || versions[bump]
        const { confirmRelease } = await this.prompt([{
            name: 'confirmRelease',
            message: `Confirm releasing ${this.targetVersion}?`,
            type: 'confirm'
        }]);

        return confirmRelease;
    }

    async updateLockFileTask() {
        logStep('Updating lockfile...');
        await this.runCommander(this.pkgManager, ['--pure-lockfile']);
    }

    async generateChangeLog() {

    }

    async buildTask(args) {
        logStep('Building all packages......');
        await this.runCommander(this.pkgManager, args ? args : ['build'])
    }

    async updateDeps(skipPrompt){
        // update all package deps
        const updatedDeps = new Set()
        logStep('Syncing remote deps...');
        const resolvedPackages = this.packages.map(async(pkgName) => {
            const pkgRoot = this.getPkgRoot(pkgName);
            const filePath = path.resolve(pkgRoot, 'package.json');
            const pkg = this.getPkgJson(pkgRoot)
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
                const remoteVersion = await this.getRemoteVersion(dep)
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
        }).filter(_ => _)
    
        const { autoSyncChanges } = await this.prompt([{
            name: 'autoSyncChanges',
            message: `Auto sync all breaking change in dependency`,
            type: 'confirm'
        }]);
    
        for (const { pkg, filePath, resolvedDeps } of resolvedPackages) {
            let isUpdated = false
            for (const { dep, localVersion, remoteVersion } of resolvedDeps) {
                const isSameVer = await this.checkUpdateAsync(dep, filePath, localVersion, remoteVersion, autoSyncChanges);
                if (remoteVersion && isSameVer) {
                    pkg.dependencies[dep] = `^${remoteVersion}`
                    updatedDeps.add(dep)
                    isUpdated = true
                }
            }
            if (isUpdated) {
                this.bufferWrite(filePath, JSON.stringify(pkg, null, 2) + '\n');
            }
        }
    
        if (skipPrompt) {
            this.flushWrite()
            return
        }
    
        const { yes } = await this.prompt([{
            name: 'yes',
            type: 'confirm',
            message: 'Commit above updates?'
        }])
    
        if (yes) {
            this.flushWrite()
        }
    }

    async getRemoteVersion(pkg){
        if (this.remoteCache[pkg]) {
            return this.remoteCache[pkg]
        }
        let res
        try {
            res = await request(`http://registry.npmjs.org/${pkg}/latest`, { json: true })
        } catch (e) {
            return
        }
        this.remoteCache[pkg] = res.version
        return res.version;
    }

    bufferWrite(file, content){
        this.pendingUpdate[file] = content
    }

    flushWrite(){
        if(argvs.dry) return;
        for (const file in this.pendingUpdate) {
            fs.writeFileSync(file, this.pendingUpdate[file])
        }
    }

    async checkUpdateAsync(pkg, filePath, local, remote, autoSyncChanges) {
        if (remote !== local) {
            const isNewer = semver.gt(remote, local)
            if (!isNewer) {
                return false
            }
            const maybeBreaking = !semver.intersects(`^${local}`, `^${remote}`)
            if (!maybeBreaking || (maybeBreaking && autoSyncChanges)) {
                return true
            }
            const { shouldUpdate } = await this.prompt([{
                name: 'shouldUpdate',
                type: 'confirm',
                message: this.genUpdateMessage(pkg, filePath, local, remote, maybeBreaking) + `\n` + `Update this dependency?`
            }])
            return shouldUpdate
        }
    }

    genUpdateMessage(pkg, filePath, local, remote, maybeBreaking) {
        return `${jeliUtils.colors.cyan(pkg)}: ${local} => ${remote} ` +
            (maybeBreaking ? jeliUtils.colors.red.bold(`maybe breaking `) : ``) +
            jeliUtils.colors.gray(`(${path.relative(process.cwd(), filePath)})`)
    }

    prompt = async questions => {
        const inquirer = await inquirerAsync;
        return await inquirer.default.prompt(questions);
    }
}
