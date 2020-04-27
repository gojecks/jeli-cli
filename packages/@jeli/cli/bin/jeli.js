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

// enter debug mode when creating test repo
// if (
//     slash(process.cwd()).indexOf('/packages/test') > 0 && (
//         fs.existsSync(path.resolve(process.cwd(), '../@jeli')) ||
//         fs.existsSync(path.resolve(process.cwd(), '../../@jeli'))
//     )
// ) {
//     process.env.jeli_CLI_DEBUG = true
// }

const program = require('commander');
const cliCommander = require('../lib/utils/commander');

program
    .version(`@jeli/cli ${require('../package').version}`)
    .usage('<command> [options]')

program
    .command('create <app-name>')
    .description('create a new project powered by jeli-cli')
    .option('--folder <folder>', 'specify folder name')
    .option('-f, --force', 'Overwrite target directory if it exists')
    .action((name, cmd) => {
        const options = jeliUtils.cleanArgs(cmd)
        if (minimist(process.argv.slice(3))._.length > 1) {
            jeliUtils.console.warn('\n Info: You provided more than one argument. The first one will be used as the app\'s name, the rest are ignored.')
        }

        const createAction = require('../lib/create');
        createAction(name, options);
    })

program
    .command('build [entry]')
    .description('name of project to build as specified in jeli.json configuration')
    .option('-f, --cwd <workspace>', 'Change current working directory')
    .option('-n, --name <name>', 'library name to build, defaults to all in config')
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
        const { cliInnfo } = require('../lib/info');
        jeliUtils.console.write(jeliUtils.chalk.bold('\nEnvironment Info:'));
        cliInnfo();
    })

// program
//     .command('add <plugin> [pluginOptions]')
//     .description('install a plugin and invoke its generator in an already created project')
//     .option('--registry <url>', 'Use specified npm registry when installing dependencies (only for npm)')
//     .allowUnknownOption()
//     .action((plugin) => {
//         require('../lib/add')(plugin, minimist(process.argv.slice(3)))
//     })

// program
//     .command('ui')
//     .description('start and open the jeli-cli ui')
//     .option('-H, --host <host>', 'Host used for the UI server (default: localhost)')
//     .option('-p, --port <port>', 'Port used for the UI server (by default search for available port)')
//     .option('-D, --dev', 'Run in dev mode')
//     .option('--quiet', `Don't output starting messages`)
//     .option('--headless', `Don't open browser on start and output port`)
//     .action((cmd) => {
//         checkNodeVersion('>=8.6', 'jeli ui')
//         require('../lib/ui')(cleanArgs(cmd))
//     })

// program
//     .command('init <template> <app-name>')
//     .description('generate a project from a remote template (legacy API, requires @jeli/cli-init)')
//     .option('-c, --clone', 'Use git clone when fetching remote template')
//     .option('--offline', 'Use cached template')
//     .action(() => {
//         loadCommand('init', '@jeli/cli-init')
//     })

// program
//     .command('config [value]')
//     .description('inspect and modify the config')
//     .option('-g, --get <path>', 'get value from option')
//     .option('-s, --set <path> <value>', 'set option value')
//     .option('-d, --delete <path>', 'delete option from config')
//     .option('-e, --edit', 'open config with default editor')
//     .option('--json', 'outputs JSON result only')
//     .action((value, cmd) => {
//         require('../lib/config')(value, cleanArgs(cmd))
//     })

// program
//     .command('outdated')
//     .description('(experimental) check for outdated jeli cli service / plugins')
//     .option('--next', 'Also check for alpha / beta / rc versions when upgrading')
//     .action((cmd) => {
//         require('../lib/outdated')(cleanArgs(cmd))
//     })

// program
//     .command('upgrade [plugin-name]')
//     .description('(experimental) upgrade jeli cli service / plugins')
//     .option('-t, --to <version>', 'Upgrade <package-name> to a version that is not latest')
//     .option('-f, --from <version>', 'Skip probing installed plugin, assuming it is upgraded from the designated version')
//     .option('-r, --registry <url>', 'Use specified npm registry when installing dependencies')
//     .option('--all', 'Upgrade all plugins')
//     .option('--next', 'Also check for alpha / beta / rc versions when upgrading')
//     .action((packageName, cmd) => {
//         require('../lib/upgrade')(packageName, cleanArgs(cmd))
//     })

// program
//     .command('migrate [plugin-name]')
//     .description('(experimental) run migrator for an already-installed cli plugin')
//     // TODO: use `requiredOption` after upgrading to commander 4.x
//     .option('-f, --from <version>', 'The base version for the migrator to migrate from')
//     .action((packageName, cmd) => {
//         require('../lib/migrate')(packageName, cleanArgs(cmd))
//     })



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

// enhance common error messages
// const enhanceErrorMessages = require('../lib/util/enhanceErrorMessages')

// enhanceErrorMessages('missingArgument', argName => {
//   return `Missing required argument ${chalk.yellow(`<${argName}>`)}.`
// })

// enhanceErrorMessages('unknownOption', optionName => {
//   return `Unknown option ${chalk.yellow(optionName)}.`
// })

// enhanceErrorMessages('optionMissingArgument', (option, flag) => {
//   return `Missing required argument for option ${chalk.yellow(option.flags)}` + (
//     flag ? `, got ${chalk.yellow(flag)}` : ``
//   )
// })

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