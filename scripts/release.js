const execa = require('execa')
const semver = require('semver')
const minimist = require('minimist')
const { updateDeps, prompt } = require('./bumpver');
const fs = require('fs');
const curVersion = fs.readFileSync('./version');

(async() => {
    console.log(`Current version: ${curVersion}`)
    const response = await prompt(curVersion);
    if (response.yes) {
        await updateDeps(response.version);
        // try {
        //     await execa('git', ['add', '-A'], { stdio: 'inherit' })
        //     await execa('git', ['commit', '-m', 'chore: pre release sync'], { stdio: 'inherit' })
        // } catch (e) {}
    }

    let distTag = 'latest';
    if (response.bump === 'prerelease' || semver.prerelease(response.version)) {
        distTag = 'next'
    }

    // publish all
})().catch(err => {
    console.error(err)
    process.exit(1)
})