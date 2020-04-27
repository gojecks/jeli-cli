 /**
  * core required Modules
  */
 const helper = require('@jeli/cli-utils');
 const { escogen, generateAstSource } = require('./ast.generator');
 const path = require('path');
 const annotationParser = require('./annotation');
 const { resolveMetaData } = require('./compilerobject');


 /**
  * 
  * @param {*} currentInstance 
  * @param {*} loader 
  */
 async function CoreCompiler(currentInstance, loader, options) {
     /**
      * 
      * @param {*} filePath 
      */
     function processFile(filePath) {
         if (currentInstance.files.hasOwnProperty(filePath)) return;
         loader.spinner.changeText(`compiling file ->${filePath}`);
         /**
          * add the resolved filePath to currentInstance for reference
          */
         const fileImpExt = {
             imports: [],
             exports: []
         };

         // Read file source.
         let source = generateAstSource(
             extractRequired(loader.readFile(filePath), filePath),
             fileImpExt,
             currentInstance.options.stripBanner
         );
         currentInstance.exports.push.apply(currentInstance.exports, fileImpExt.exports);
         /**
          * process importedFiles
          */
         fileImpExt.imports.forEach(impItem => importFile(impItem, filePath));
         const otherScripts = escogen(source.scripts);
         if (currentInstance.required.hasOwnProperty(filePath)) {
             currentInstance.required[filePath].push(otherScripts);
         } else {
             currentInstance.output.push(otherScripts);
         }
         source.annotations.forEach(ast => {
             annotationParser(ast, filePath, loader, currentInstance)
         });
         currentInstance.files[filePath] = fileImpExt;
     }

     /**
      * 
      * @param {*} importItem 
      * @param {*} parentPath 
      */
     function importFile(importItem, parentPath) {
         if (!loader.isGlobalImport(importItem.source)) {
             let importFilePath = importItem.source;
             const ext = path.extname(importFilePath);
             if (!ext || !helper.is(ext, '.js')) {
                 importFilePath += '.js';
             }

             /**
              * check for glob import
              */
             if (helper.isContain('*', importFilePath)) {
                 loader.spinner.warn(helper.colors.yellow(`glob patterns not allowed in statement: ${parentPath} -> ${importFilePath}`));
                 // loader.getGlobFiles(importFilePath);
             } else {
                 importFilePath = path.join(parentPath, '..', importFilePath);
                 createDefault(importItem, importFilePath);
                 processFile(importFilePath, importItem.source);
             }
         } else {
             /**
              * resolve the dependency
              */
             const resolvedDep = loader.resolveDependency(importItem.source);
             if (resolvedDep) resolveMetaData(resolvedDep.metadata, importItem.source);
             else {
                 loader.spinner.fail(`unable to resolve dependency ${importItem.source} -> ${parentPath}`);
                 helper.abort();
             }

             if (helper.is('library', currentInstance.options.type)) {
                 if (!currentInstance.globalImports.hasOwnProperty(importItem.source)) {
                     currentInstance.globalImports[importItem.source] = {
                         output: helper.trimPackageName(importItem.source),
                         specifiers: []
                     };
                 }

                 importItem.specifiers.forEach(opt => {
                     if (!currentInstance.globalImports[importItem.source].specifiers.includes(opt.imported)) {
                         currentInstance.globalImports[importItem.source].specifiers.push(opt.imported)
                     }
                 });
             } else {

                 processFile(resolvedDep.source, resolvedDep.source);
             }
         }
     }

     /**
      * 
      * @param {*} source 
      * @param {*} filePath 
      */
     function extractRequired(source, filePath) {
         return source.replace(/require\((.*)\)/g, (_, value) => {
             value = path.join(filePath, '..', helper.removeSingleQuote(value));
             if (!currentInstance.required.hasOwnProperty(value)) {
                 currentInstance.required[value] = value;
             }
             return `__required('${value}')`;
         });
     }

     /**
      * 
      * @param {*} importItem 
      * @param {*} filePath 
      */
     function createDefault(importItem, filePath) {
         if (importItem.default) {
             if (!currentInstance.required.hasOwnProperty(filePath)) {
                 currentInstance.output.push(`var ${importItem.specifiers[0].imported} = __importDefault(__required('${filePath}'));`);
                 currentInstance.required[filePath] = [];
             }
         }
     }

     processFile(path.join(currentInstance.options.sourceRoot, currentInstance.entryFile));
 }

 /**
  * 
  * @param {*} source 
  * @param {*} files 
  */
 function extractImport(source, files) {
     return source.replace(/import\s(\{(.*)\}\s|[*\s]|)+(from\s|)+(.*)+;/g, (key, variableKey, parsedVariables, from, filePath) => {
         if (!filePath) {
             throw new Error('Invalid Import statement');
         }
         filePath = filePath.trim();
         var ext = path.extname(filePath);
         if (!ext || !is(ext, 'js')) {
             filePath += '.js';
         }

         files.push({
             variableKey,
             parsedVariables,
             from: !from,
             filePath: removeSingleQuote(filePath)
         });
         return '';
     });
 }

 module.exports = async function(compilerObject, loader) {
     for (const name in compilerObject) {
         await CoreCompiler(compilerObject[name], loader);
     }
 };