const jeliUtils = require('@jeli/cli-utils');
/**
 * 
 * @param {*} commandName
 * @param {*} requiredModule 
 */
module.exports = function(commandName, requiredModule) {
        try {
            return require(requiredModule);
        } catch (requiredError) {
            if (jeliUtils.isNotFoundError(requiredError)) {
                try {
                    return require('import-global')(requiredModule)
                } catch (importError) {
                    if (isNotFoundError(importError)) {
                        jeliUtils.console.write(
                                `\n  Command ${jeliUtils.chalk.cyan(`jeli ${commandName}`)} requires ${requiredModule} to be installed.\n` +
                        `  Please run ${jeliUtils.chalk.cyan(`npm install ${requiredModule}`)} and try again. \n`
                    )
                    process.exit(1)
                } else {
                    throw importError;
                }
            }
        } else {
            throw requiredError;
        }
   }
}