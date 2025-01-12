const helper = require('@jeli/cli/lib/utils');
const cached = {};


exports.attachViewSelectorProviders = (compilerObject) => {
    const filePaths = Object.keys(compilerObject.files);
    const globalImports = Object.keys(compilerObject.globalImports);

    return (filePath, providers, callback) => {
        const imports = compilerObject.files[filePath].imports;
        Object.keys(providers).forEach(providerName => {
            const importRef = attachToImportMapping(providers[providerName], providerName, imports);
            if (callback){
                callback(importRef);
            }
        });
    };

    function getFilePathByModuleName(moduleName){
        return cached[moduleName] || filePaths.find(path => {
            const fileObj = compilerObject.files[path];
            return !!fileObj && fileObj.exports.some(exp => exp.exported === moduleName)
        });
    }

    /**
     * 
     * @param {*} moduleName 
     * @param {*} providerName 
     * @param {*} imports 
     * @returns 
     */
    function attachToImportMapping(moduleName, providerName, imports) {
        let outputName = (compilerObject.isLib ? `exports` : moduleName);
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
            outputName = compilerObject.globalImports[name]?.output?.arg;
        }

        return {
            outputName,
            providerName
        };
    }
}