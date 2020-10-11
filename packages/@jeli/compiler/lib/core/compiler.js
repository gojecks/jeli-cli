 /**
  * core required Modules
  */
 const helper = require('@jeli/cli-utils');
 const { escogen, generateAstSource } = require('./ast.generator');
 const path = require('path');
 const annotationParser = require('./annotation');
 const { resolveMetaData, getMetaData } = require('./compilerobject');
 const loader = require('./loader');

 /**
  * 
  * @param {*} currentInstance 
  * @param {*} loader 
  */
 async function CoreCompiler(currentInstance) {
     const filePath = path.join(currentInstance.options.sourceRoot, currentInstance.entryFile);
     await processFile(currentInstance, filePath, null, false, null, true);
 }

 /**
  * 
  * @param {*} currentInstance 
  * @param {*} filePath 
  * @param {*} parentPath 
  * @param {*} isExternalModule 
  * @param {*} importedItem 
  * @param {*} isEntry 
  */
 async function processFile(currentInstance, filePath, parentPath, isExternalModule, importedItem, isEntry) {
     if (currentInstance.files.hasOwnProperty(filePath)) {
         return await validateImports(importedItem, currentInstance.files[filePath].exports, filePath, parentPath);
     };

     loader.spinner.changeText(`compiling file ->${filePath}`);
     /**
      * add the resolved filePath to currentInstance for reference
      */
     const fileImpExt = {
         imports: [],
         exports: [],
         declarations: {
             fns: [],
             vars: []
         }
     };
     const output = {
         type: 'source',
         source: [],
         annotations: []
     };

     let source;

     // Read file source.
     try {
         source = generateAstSource(
             extractRequired(currentInstance, loader.readFile(filePath, parentPath), filePath),
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
             await importFile(currentInstance, impItem, filePath);
         }

         const otherScripts = escogen(source.scripts);
         if (!isEntry)
             output.source.push(otherScripts);
         else
             currentInstance.output.global.push(otherScripts);

         for (const ast of source.annotations) {
             await annotationParser(ast, filePath, output, currentInstance);
         }

         currentInstance.files[filePath] = fileImpExt;
         if (!isEntry) {
             _pushToDependency(currentInstance, filePath, output);
         }
     } catch (err) {
         loader.spinner.fail('');
         helper.console.error(`\nError while compiling ${helper.colors.yellow(filePath)} ${parentPath ? ' imported in '+helper.colors.yellow(parentPath) : '' }`);
         helper.console.warn(`\nReasons: ${err.message}`);
         helper.console.log('\nFix errors and try again.\n');
     }
 }

 /**
  * 
  * @param {*} importItem 
  * @param {*} parentPath 
  * @param {*} isExternalModule 
  */
 async function importFile(currentInstance, importItem, parentPath, isExternalModule) {
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
             await processFile(currentInstance, importFilePath, parentPath, isExternalModule, importItem, false);
             addAbsolutePath(importItem, importFilePath, isLib);
         }
     } else {
         if (resolvedDep) resolveMetaData(resolvedDep, importItem);
         else {
             loader.spinner.fail(`unable to resolve dependency ${importItem.source} -> ${parentPath}`);
             helper.console.error('compilation stopped');
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
             await processFile(currentInstance, resolvedDep.source, parentPath, true, importItem, false);
         } else {
             await validateImports(importItem, getMetaData(importItem.source).exports, importItem.source, parentPath);
         }

         addAbsolutePath(importItem, resolvedDep.source, isLib);
     }
 }

 function addAbsolutePath(importItem, absolutePath, isLib) {
     if (!isLib) {
         importItem.absolutePath = absolutePath;
     }
 }

 /**
  * 
  * @param {*} source 
  * @param {*} filePath 
  */
 function extractRequired(currentInstance, source, filePath) {
     return source.replace(/require\((.*)\)/g, (_, value) => {
         value = path.join(filePath, '..', helper.removeSingleQuote(value));
         _pushToDependency(currentInstance, value, {
             type: 'required',
             path: value,
             source: [loader.readFile(value)]
         });
         return `__required('${value}', 'exports')`;
     });
 }

 /**
  * 
  * @param {*} filePath 
  * @param {*} parentPath 
  */
 function _pushToDependency(currentInstance, filePath, value) {
     if (!currentInstance.output.modules.hasOwnProperty(filePath)) {
         currentInstance.output.modules[filePath] = value;
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
     }
 }


 /**
  * 
  * @param {*} importItem 
  * @param {*} exportedItem 
  */
 function hasInvalidImport(importItem, exportedItem) {
     if (!importItem || importItem.default || importItem.nameSpace || !importItem.specifiers.length) return false;
     return importItem.specifiers.filter(item => !exportedItem.includes(item.imported));
 }

 exports.compiler = async function(compilerObject) {
     for (const name in compilerObject) {
         await CoreCompiler(compilerObject[name]);
     }
 };

 exports.singleCompiler = async(compilerObject, changes) => {
     let moduleName = '';
     const moduleAssignable = ['Directive', 'Element', 'Pipe'];
     if (compilerObject.files.hasOwnProperty(changes.filePath)) {
         const obj = compilerObject.output.modules[changes.filePath];
         if (obj.annotations) {
             obj.annotations.forEach(annot => {
                 if (moduleAssignable.includes(annot.type)) {
                     moduleName = compilerObject[annot.type][annot.fn].module;
                 }
                 delete compilerObject[annot.type][annot.fn];
             });
         }

         delete compilerObject.files[changes.filePath];
         delete compilerObject.output.modules[changes.filePath];
     }
     await processFile(compilerObject, changes.filePath);
     const newObject = compilerObject.output.modules[changes.filePath];
     if (newObject.annotations && moduleName && compilerObject.jModule.hasOwnProperty(moduleName)) {
         newObject.annotations.forEach(annot => {
             if (moduleAssignable.includes(annot.type))
                 compilerObject[annot.type][annot.fn].module = moduleName;
         });
     }
 }