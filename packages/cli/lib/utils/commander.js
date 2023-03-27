const jeliUtils = require('../utils/index');
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
                    if (jeliUtils.isNotFoundError(importError)) {
                        jeliUtils.console.write(
                                `\n  Command ${jeliUtils.writeColor(`jeli ${commandName}`, 'cyan')} requires ${requiredModule} to be installed.\n` +
                        `  Please run ${jeliUtils.writeColor(`npm install ${requiredModule}`, 'cyan')} and try again. \n`
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