 /**
  * core required Modules
  */
 const helper = require('@jeli/cli-utils');
 const { escogen, generateAstSource } = require('./ast.generator');
 const path = require('path');
 const annotationParser = require('./annotation');
 const { resolveMetaData, getMetaData } = require('./compilerobject');


 /**
  * 
  * @param {*} currentInstance 
  * @param {*} loader 
  */
 async function CoreCompiler(currentInstance, loader, options) {
     /**
      * 
      * @param {*} filePath 
      * @param {*} parentPath 
      * @param {*} isExternalModule 
      */
     async function processFile(filePath, parentPath, isExternalModule, importedItem) {
         if (currentInstance.files.hasOwnProperty(filePath)) {
             return await validateImports(importedItem, currentInstance.files[filePath].exports, filePath, parentPath);
         };

         loader.spinner.changeText(`compiling file ->${filePath}`);
         /**
          * add the resolved filePath to currentInstance for reference
          */
         const fileImpExt = {
             imports: [],
             exports: []
         };

         let source;

         // Read file source.
         try {
             source = generateAstSource(
                 extractRequired(loader.readFile(filePath, parentPath), filePath),
                 fileImpExt
             );

             if (!isExternalModule) {
                 currentInstance.exports.push.apply(currentInstance.exports, fileImpExt.exports);
             }

             await validateImports(importedItem, fileImpExt.exports, filePath, parentPath);

             /**
              * process importedFiles
              */
             for (const impItem of fileImpExt.imports) {
                 await importFile(impItem, filePath);
             }

             const otherScripts = escogen(source.scripts);
             if (currentInstance.output.modules.hasOwnProperty(filePath)) {
                 currentInstance.output.modules[filePath].push(otherScripts);
             } else {
                 currentInstance.output.global.push(otherScripts);
             }
             source.annotations.forEach(ast => {
                 annotationParser(ast, filePath, loader, currentInstance)
             });

             currentInstance.files[filePath] = fileImpExt;
         } catch (err) {
             loader.spinner.fail('');
             helper.console.error(`\nError while compiling ${helper.colors.yellow(filePath)} ${parentPath ? ' imported in '+helper.colors.yellow(parentPath) : '' }`);
             helper.console.warn(`\nReasons: ${err.message}`);
             helper.abort('\nFix errors and try again.\n');
         }
     }

     /**
      * 
      * @param {*} importItem 
      * @param {*} parentPath 
      * @param {*} isExternalModule 
      */
     async function importFile(importItem, parentPath, isExternalModule) {
         /**
          * resolve the dependency
          */
         const resolvedDep = loader.resolveDependency(importItem.source, parentPath, currentInstance.options.resolve);
         const isLib = helper.is('library', currentInstance.options.type);
         if (!resolvedDep) {
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
             } else {
                 importFilePath = path.join(parentPath, '..', importFilePath);
                 if (!isLib) {
                     _pushToDependency(importFilePath, parentPath);
                 }
                 await processFile(importFilePath, parentPath, isExternalModule, importItem);
             }
         } else {
             if (resolvedDep) resolveMetaData(resolvedDep, importItem);
             else {
                 loader.spinner.fail(`unable to resolve dependency ${importItem.source} -> ${parentPath}`);
                 helper.abort();
             }

             if (!currentInstance.globalImports.hasOwnProperty(importItem.source)) {
                 currentInstance.globalImports[importItem.source] = {
                     output: helper.trimPackageName(importItem.source),
                     specifiers: [],
                     fullPath: resolvedDep.source
                 };
             }

             importItem.specifiers.forEach(opt => {
                 if (!currentInstance.globalImports[importItem.source].specifiers.includes(opt.imported)) {
                     currentInstance.globalImports[importItem.source].specifiers.push(opt.imported)
                 }
             });

             if (!isLib) {
                 _pushToDependency(resolvedDep.source);
                 await processFile(resolvedDep.source, parentPath, true, importItem);
             } else {
                 await validateImports(importItem, getMetaData(importItem.source).exports, importItem.source, parentPath);
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
             if (!currentInstance.output.modules.hasOwnProperty(value)) {
                 currentInstance.output.modules[value] = value;
             }
             return `__required('${value}')`;
         });
     }

     /**
      * 
      * @param {*} filePath 
      * @param {*} parentPath 
      */
     function _pushToDependency(filePath, parentPath) {
         if (!currentInstance.output.modules.hasOwnProperty(filePath)) {
             currentInstance.output.modules[filePath] = [];
         }
     }

     /**
      * 
      * @param {*} importedItem 
      * @param {*} exported 
      */
     async function validateImports(importedItem, exported, filePath, parentPath) {
         exported = exported.map(item => item.exported);
         const invalidImport = hasInvalidImport(importedItem, exported);
         if (invalidImport && invalidImport.length) {
             loader.spinner.fail('');
             helper.console.error(`\n no exported name(s) ${helper.colors.yellow(invalidImport.map(item => item.imported).join(' , '))} in ${helper.colors.yellow(filePath)} imported in ${helper.colors.yellow(parentPath)}\n`);
             helper.abort()
         }
     }


     /**
      * 
      * @param {*} importItem 
      * @param {*} exportedItem 
      */
     function hasInvalidImport(importItem, exportedItem) {
         if (!importItem || importItem.default || !importItem.specifiers.length) return false;
         return importItem.specifiers.filter(item => !exportedItem.includes(item.imported));
     }

     await processFile(path.join(currentInstance.options.sourceRoot, currentInstance.entryFile));
 }

 module.exports = async function(compilerObject, loader) {
     for (const name in compilerObject) {
         await CoreCompiler(compilerObject[name], loader);
     }
 };