#!/usr/bin/env node

const semver = require('semver')
const requiredVersion = require('../package.json').engines.node
const leven = require('leven')
const jeliUtils = require('@jeli/cli-utils');

function checkNodeVersion(wanted, id) {
    if (!semver.satisfies(process.version, wanted)) {
        jeliUtils.abort(
            `You are using Node '${process.version}', but this version of ${id} requires Node ${wanted}.\nPlease upgrade your Node version.`
        );
    }
}

checkNodeVersion(requiredVersion, '@jeli/cli');
const minimist = require('minimist')
const program = require('commander');
const cliCommander = require('../lib/utils/commander');

program
    .version(`@jeli/cli ${require('../package').version}`)
    .usage('<command> [options]')

program
    .command('create <app-name>')
    .description('create a new project powered by jeli-cli')
    .option('--force', 'Overwrite target directory if it exists')
    .option('-x, --proxy', 'Use specified proxy when creating project.')
    .action((name, cmd) => {
        const options = jeliUtils.cleanArgs(cmd)
        if (minimist(process.argv.slice(3))._.length > 1) {
            jeliUtils.console.warn('\n Info: You provided more than one argument. The first one will be used as the app\'s name, the rest are ignored.')
        }

        require('../lib/create')(name, options);
    });

program
    .command('build [entry]')
    .description('name of project to build as specified in jeli.json configuration')
    .option('-f, --cwd <workspace>', 'Change current working directory')
    .option('-n, --name <name>', 'library name to build, defaults to all in config')
    .option('--prod', 'build application for production')
    .action((entry, cmd) => {
        cliCommander('build', '@jeli/cli-dev').build(entry, jeliUtils.cleanArgs(cmd))
    })

program
    .command('serve [entry]')
    .description('serve a .js or .jl file in development mode with zero config')
    .option('-f, --cwd <workspace>', 'Change current working directory')
    .option('-o, --open', 'Open browser')
    .option('-c, --copy', 'Copy local url to clipboard')
    .option('-h, --host <host>', 'Address to use [127.0.0.1]')
    .option('-p, --port <port>', 'Port used by the server (default: 4110)')
    .option('-g, --gzip', 'Serve gzip files when possible [false]')
    .option('-S, --ssl', 'Enable https.')
    .option('-C, --cert <cert>', 'Path to ssl cert file (default: cert.pem).')
    .option('-K, --key <key>', 'Path to ssl key file (default: key.pem).')
    .option('-P, --proxy', 'Fallback proxy if the request cannot be resolved. e.g.: http://someurl.com')
    .option('--username  <username>', 'Username for basic authentication [none] \n Can also be specified with the env variable NODE_HTTP_SERVER_USERNAME')
    .option('--password <password>', 'Password for basic authentication [none] \n Can also be specified with the env variable NODE_HTTP_SERVER_PASSWORD')
    .option('-t <timeout>', 'Connections timeout in seconds [120], e.g. -t60 for 1 minute. \n To disable timeout, use -t0')
    .action((entry, cmd) => {
        cliCommander('serve', '@jeli/cli-dev').serve(entry, jeliUtils.cleanArgs(cmd))
    })

program
    .command('info')
    .description('print debugging information about your environment')
    .action(_ => {
        const { cliInfo } = require('../lib/info');
        jeliUtils.console.write(jeliUtils.chalk.bold('\nEnvironment Info:'));
        cliInfo();
    })

program
    .command('remove <project-name>')
    .description('removes project from workspace')
    .action((entry, cmd) => {
        require('../lib/remove')(entry, jeliUtils.cleanArgs(cmd));
    })

program
    .command('new <type> <path-name>')
    .option('-p, --project', 'Specify project name if multiple exists in workspace. (default: defaultProject)')
    .description('generate a new (Element|Directive|Service|Module)')
    .action((type, pathName, cmd) => {
        require('../lib/generator')(type.toLowerCase(), pathName, jeliUtils.cleanArgs(cmd))
    })

// output help information on unknown commands
program
    .arguments('<command>')
    .action((cmd) => {
        program.outputHelp()
        jeliUtils.console.error(`  Unknown command ${jeliUtils.colors.yellow(cmd)}.\n`);
        suggestCommands(cmd)
    })

// add some useful info on help
program.on('--help', () => {
            jeliUtils.console.write(`\n  Run ${jeliUtils.colors.cyan(`jeli <command> --help`)} for detailed usage of given command.\n`)
})

program.commands.forEach(c => c.on('--help', () => jeliUtils.console.write()))
program.parse(process.argv)
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

function suggestCommands (unknownCommand) {
  const availableCommands = program.commands.map(cmd => cmd._name)

  let suggestion

  availableCommands.forEach(cmd => {
    const isBestMatch = leven(cmd, unknownCommand) < leven(suggestion || '', unknownCommand)
    if (leven(cmd, unknownCommand) < 3 && isBestMatch) {
      suggestion = cmd
    }
  })

  if (suggestion) {
    jeliUtils.console.error(`Did you mean ${jeliUtils.colors.yellow(suggestion)}?`);
  }
}