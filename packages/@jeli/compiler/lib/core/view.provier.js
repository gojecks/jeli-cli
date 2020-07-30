const helper = require('@jeli/cli-utils');
const { getPipeProvider } = require('./compilerobject');

exports.attachViewSelectorProviders = (providers, compilerObject, imports) => {
    return Object.keys(providers).map(providerName => {
        attachToImportMapping(providers[providerName], providerName, compilerObject, imports);
        return providerName;
    });
}

/**
 * Attach the providers to the importMapping
 */
function attachToImportMapping(moduleName, providerName, compilerObject, imports) {
    if (compilerObject.modules.hasOwnProperty(moduleName)) {
        Object.keys(compilerObject.files)
            .forEach(path => {
                if (compilerObject.files[path].exports.some(item => item.exported === moduleName)) {
                    compilerObject.files[path].imports.forEach(item => {
                        if (item.specifiers.some(specifier => helper.is(specifier.imported, providerName))) {
                            imports.push(item);
                        }
                    });
                }
            });

    } else {
        let name = "";
        if (compilerObject.globalImports.hasOwnProperty(moduleName)) {
            name = moduleName;
        } else {
            name = Object.keys(compilerObject.globalImports).
            find(name => compilerObject.globalImports[name].specifiers.includes(moduleName));
        }

        const exists = imports.find(item => (helper.is(item.source, name)));
        if (exists) {
            exists.specifiers.push({
                local: providerName,
                imported: providerName
            });
        } else {
            imports.push({
                source: name,
                specifiers: [{
                    local: providerName,
                    imported: providerName
                }]
            });
        }
    }
}