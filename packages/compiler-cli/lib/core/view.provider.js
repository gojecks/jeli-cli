const helper = require('@jeli/cli/lib/utils');
const cached = {};


exports.attachViewSelectorProviders = (compilerObject, isLib) => {
    const filePaths = Object.keys(compilerObject.files);
    const globalImports = Object.keys(compilerObject.globalImports);

    return (providers, imports) => {
        return Object.keys(providers).map(providerName => {
            return attachToImportMapping(providers[providerName], providerName, imports);
        });
    };

    function getFilePathByModuleName(moduleName){
        return cached[moduleName] || filePaths.find(path => compilerObject.files[path].exports.some(exp => exp.exported === moduleName));
    }

    /**
     * 
     * @param {*} moduleName 
     * @param {*} providerName 
     * @param {*} imports 
     * @returns 
     */
    function attachToImportMapping(moduleName, providerName, imports) {
        let outputName = (isLib ? `exports` : moduleName);
        if (compilerObject.jModule.hasOwnProperty(moduleName)) {
            const filePath = getFilePathByModuleName(providerName);
            if (filePath) {
                cached[providerName] = filePath;
                if (!compilerObject.files[filePath].lazyLoadModulePath) {
                    if (!imports.some(imp => imp.absolutePath === filePath)) {
                        imports.push({
                            absolutePath: filePath,
                            specifiers: [{
                                local: providerName
                            }]
                        });
                    }
                    
                }
                outputName = '';
            }
        } else {
            let name = "";
            if (compilerObject.globalImports.hasOwnProperty(moduleName)) {
                name = moduleName;
            } else {
                name = globalImports.find(name => compilerObject.globalImports[name].specifiers.includes(moduleName));
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
}