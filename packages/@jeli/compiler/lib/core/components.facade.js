const { findTokenInGlobalImports, isExportedToken, getPipeProvider } = require('./compilerobject');
const { CoreQuerySelector } = require('./query_selector');

module.exports = compilerObject => {
    return {
        getFn: directiveConfiguration => directiveConfiguration && directiveConfiguration.map(def => def.fn),
        getElement: (selector, component, module) => {
            return CoreQuerySelector(compilerObject, 'Element', selector, component);
        },
        getDirectives: (selector, element, component, module) => {
            return CoreQuerySelector(compilerObject, 'Directive', selector, component, element);
        },
        getModule: moduleName => compilerObject.jModule[moduleName],
        getService: (serviceName, filePath) => {
            if (compilerObject.Service.hasOwnProperty(serviceName)) {
                return compilerObject.Service[serviceName];
            }

            const inGlobalImports = findTokenInGlobalImports(serviceName, compilerObject, 'Service');
            if (inGlobalImports) {
                return inGlobalImports[serviceName] || {
                    internal: true
                }
            }

            return isExportedToken(serviceName, compilerObject);
        },
        getPipe: pipeName => {
            return getPipeProvider(pipeName, compilerObject)
        }
    };
}