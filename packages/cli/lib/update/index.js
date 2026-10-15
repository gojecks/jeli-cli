const fs = require('fs-extra');
const path = require('path');
const semver = require('semver');
const jeliUtils = require('../utils');
const { getLatestVersion } = require('../utils/npmRegistry');

const DEP_FIELDS = ['dependencies', 'devDependencies'];

function collectTargets(pkgJson, packages, all) {
    const targets = [];
    for (const field of DEP_FIELDS) {
        const deps = pkgJson[field];
        if (!deps) continue;
        for (const dep in deps) {
            const range = deps[dep];
            // only caret ranges are safely auto-bumpable without a version bump decision
            if (range.charAt(0) !== '^') continue;
            if (packages && packages.length) {
                if (!packages.includes(dep)) continue;
            } else if (!all && !dep.startsWith('@jeli/')) {
                continue;
            }
            targets.push({ field, dep, current: range.slice(1) });
        }
    }
    return targets;
}

async function update(packages, options) {
    const cwd = process.cwd();
    const pkgJsonPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
        jeliUtils.abort('No package.json found in the current directory.');
    }

    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const targets = collectTargets(pkgJson, packages, options.all);
    if (!targets.length) {
        jeliUtils.console.write('Nothing to check - no matching dependencies found.');
        return;
    }

    jeliUtils.console.write(jeliUtils.colors.bold(`Checking ${targets.length} package(s) against the npm registry...`));
    const checked = [];
    for (const target of targets) {
        jeliUtils.writeline(`checking ${target.dep}...`);
        try {
            const latest = await getLatestVersion(target.dep);
            checked.push(Object.assign({ latest }, target));
        } catch (e) {
            jeliUtils.writeline('');
            jeliUtils.console.warn(`could not resolve ${target.dep}: ${e.message}`);
        }
    }
    jeliUtils.writeline('');

    const updatable = checked.filter(t => t.latest && semver.gt(t.latest, t.current));
    if (!updatable.length) {
        jeliUtils.console.success('Everything is already up to date.');
        return;
    }

    updatable.forEach(t => {
        const breaking = !semver.intersects(`^${t.current}`, `^${t.latest}`);
        jeliUtils.console.write(
            `${jeliUtils.colors.cyan(t.dep)}: ${t.current} -> ${jeliUtils.colors.green(t.latest)}` +
            (breaking ? jeliUtils.colors.red.bold(' (maybe breaking)') : '')
        );
    });

    if (options.dry) return;

    let confirmed = options.yes;
    if (!confirmed) {
        const inquirer = (await import('inquirer')).default;
        ({ confirmed } = await inquirer.prompt([{
            name: 'confirmed',
            type: 'confirm',
            message: `Update ${updatable.length} package(s) in package.json?`
        }]));
    }

    if (!confirmed) {
        jeliUtils.console.write('No changes made.');
        return;
    }

    updatable.forEach(({ field, dep, latest }) => {
        pkgJson[field][dep] = `^${latest}`;
    });
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
    jeliUtils.console.success(`\nUpdated ${updatable.length} package(s) in package.json. Run your package manager's install to apply.`);
}

module.exports = (packages, options) => update(packages, options).catch(err => {
    jeliUtils.console.error(err.message || err);
    jeliUtils.abort('Failed to check for updates.');
});
