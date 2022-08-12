const helper = require('@jeli/cli-utils');
const cached = {};


exports.attachViewSelectorProviders = (providers, compilerObject, imports, isLib) => {
    return Object.keys(providers).map(providerName => {
        return attachToImportMapping(providers[providerName], providerName, compilerObject, imports, isLib);
    });
}

/**
 * Attach the providers to the importMapping
 */
function attachToImportMapping(moduleName, providerName, compilerObject, imports, isLib) {
    let outputName = isLib ? `exports` : moduleName;
    if (compilerObject.jModule.hasOwnProperty(moduleName)) {
        Object.keys(compilerObject.files)
            .forEach(path => {
                const moduleObj = compilerObject.files[path];
                const exportedItem = moduleObj.exports.map(item => item.exported);
                if (exportedItem.includes(moduleName)) {
                    if (!exportedItem.includes(providerName)) {
                        moduleObj.exports.push({
                            local: providerName,
                            exported: providerName
                        });
                    }
                    // push imported item
                    if (!imports.some(imp => imp.absolutePath === path)) {
                        imports.push({
                            absolutePath: path,
                            specifiers: [{
                                local: moduleName
                            }],
                            nameSpace: true,
                            noExports: true
                        });
                    }
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

        const exists = imports.some(item => (helper.is(item.source, name)));
        if (!exists) {
            imports.push({
                source: name,
                specifiers: []
            });
        }
        outputName = compilerObject.globalImports[name].output.arg;
    }

    return {
        outputName,
        providerName
    };
}