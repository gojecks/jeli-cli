const { findTokenInGlobalImports, isExportedToken, getPipeProvider } = require('./compilerobject');
const { setIndex } = require('./output-mapper');
const { CoreQuerySelector } = require('./query_selector');

class ComponentsResolver  {
    constructor(compilerObject){
        this.compilerObject = compilerObject;
    }

    getFn(directiveConfiguration){
       return directiveConfiguration && directiveConfiguration.map(def => def.fn)
    }

    getElement(selector, component){
        return CoreQuerySelector(this.compilerObject, 'Element', selector, component);
    }

    getDirectives(selector, element, component, module){
        return CoreQuerySelector(this.compilerObject, 'Directive', selector, component, element);
    }
    
    getModule(moduleName) {
        return this.compilerObject.jModule[moduleName];
    }

    hasModule(moduleName) {
        return this.compilerObject.jModule.hasOwnProperty(moduleName);
    }

    getService(serviceName, filePath){
        if (this.compilerObject.Service.hasOwnProperty(serviceName)) {
            return this.compilerObject.Service[serviceName];
        }

        const inGlobalImports = findTokenInGlobalImports(serviceName, this.compilerObject, 'Service');
        if (inGlobalImports) {
            return inGlobalImports[serviceName] || {
                internal: true
            }
        }

        return isExportedToken(serviceName, this.compilerObject);
    }

    getPipe(pipeName){
        return getPipeProvider(pipeName, this.compilerObject)
    }
    /**
     * 
     * @param {*} requiredModule 
     * @param {*} compilerObject 
     */
    getExportedModule(requiredModule){
        if (this.compilerObject.jModule.hasOwnProperty(requiredModule)) {
            return this.compilerObject.jModule[requiredModule];
        }
        const libModules = findTokenInGlobalImports(requiredModule, this.compilerObject, 'jModule');
        return libModules && libModules[requiredModule];
    }
    
    getLocalService(name){
        return (typeof name === 'string' ? this.compilerObject.Service[name] : null)
    }
    
    getLocalSelector(name) {
        name = typeof name === 'object' ? name.useExisting : name;
        return (this.compilerObject.Directive[name] || this.compilerObject.Element[name]);
    }

    /**
     * Add a new entry to compiler object
     * @param {*} selector 
     * @param {*} className 
     * @param {*} instance 
     */
    addEntry(type, className, instance) {
        if  (!this.compilerObject[type].hasOwnProperty(className)) {
            this.compilerObject[type][className] = instance;
            return true;
        }
    }
    
    isExportedToken(name){
        return isExportedToken(name, this.compilerObject)
    }
    
    getFile(filePath){
        return this.compilerObject.files[filePath]
    }

    getOutputModule(filePath) {
        return this.compilerObject.output.modules[filePath];
    }

    pushToLazyLoads(filePath){
        if (!this.compilerObject.output.lazyLoads.includes(filePath)){
            setIndex(filePath);
            this.compilerObject.output.lazyLoads.push(filePath);
        }
    }

    isLazyLoadedModule(filePath) {
        return this.compilerObject.output.lazyLoads.includes(filePath);
    }

    pushToExports(exportDef){
        this.compilerObject.exports.push.apply(this.compilerObject.exports, exportDef);
    }

    pushGlobalOutPut(script){
        this.compilerObject.output.global.push(script);
    }

    pushGlobalImports(importItem, trimmedName, resolvedDep){
        if (!this.compilerObject.globalImports.hasOwnProperty(importItem.source)) {
            this.compilerObject.globalImports[importItem.source] = {
                output: trimmedName,
                specifiers: [],
                absolutePath: resolvedDep.source,
                version: resolvedDep.version,
                name: resolvedDep.name,
                default: importItem.default
            }

            if (resolvedDep.stylesPath) {
                if (!this.compilerObject.options.output.styles) {
                    this.compilerObject.options.output.styles = [];
                }

                this.compilerObject.options.output.styles.push(resolvedDep.stylesPath);
            }
        }

        importItem.specifiers.forEach(opt => {
            if (!this.compilerObject.globalImports[importItem.source].specifiers.includes(opt.imported)) {
                this.compilerObject.globalImports[importItem.source].specifiers.push(opt.imported)
            }
        });
    }

    /**
     * 
     * @param {*} filePath 
     * @param {*} parentPath 
     * @param {*} lazyLoadModulePath 
     * @param {*} isExternalModule 
     * @returns 
     */
    createFileEntry(filePath, parentPath, lazyLoadModulePath, isExternalModule){
        this.compilerObject.files[filePath] = ({
            imports: [],
            exports: [],
            asModule: false,
            declarations: {
                fns: [],
                vars: []
            },
            parentPath,
            lazyLoadModulePath,
            isExternalModule
        });
        
        return this.compilerObject.files[filePath];
    }

    addOutPutEntry(filePath, definition){
        if (!this.compilerObject.output.modules[filePath]) {
            setIndex(filePath);
            this.compilerObject.output.modules[filePath] = definition;
        }
        // delete mode
        if (!definition){
            this.compilerObject.output.modules[filePath] = null;
        }
    }

    addFileEntry(filePath, definition){
        this.compilerObject.files[filePath] = definition;
    }

    /**
     * 
     * @param {*} filePath 
     * @param {*} components 
     * @returns 
     */
    cleanFileEntry(filePath, components){
        let moduleName = '';
        let lazyLoadModulePath = null;
        const fileDefinition = this.getFile(filePath);
        if (fileDefinition) {
            const obj = this.getOutputModule(filePath);
            // remove all mapped annotations 
            if (obj && obj.annotations) {
                obj.annotations.forEach(annot => {
                    if (components.includes(annot.type)) {
                        moduleName = this.compilerObject[annot.type][annot.fn].module;
                    }
                    delete this.compilerObject[annot.type][annot.fn];
                });
            }
            // empty file cache for recompilation
            lazyLoadModulePath = fileDefinition.lazyLoadModulePath;
            this.addFileEntry(filePath, null);
            this.addOutPutEntry(filePath, null);
            if (lazyLoadModulePath){
                this.compilerObject.output.lazyLoads.push(lazyLoadModulePath);
            }
        }

        return {moduleName, lazyLoadModulePath};
    }

    /**
     * 
     * @param {*} filePath 
     * @param {*} moduleName 
     * @param {*} components 
     */
    updateAnnotation(filePath, moduleName, components){
        const newObject = this.getOutputModule(filePath);
        if (newObject && newObject.annotations && moduleName && this.hasModule(moduleName)) {
            newObject.annotations.forEach(annot => {
                if (components.includes(annot.type))
                    this.compilerObject[annot.type][annot.fn].module = moduleName;
            });
        }
    }
}   

module.exports = ComponentsResolver