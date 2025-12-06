const ComponentsResolver = require('../lib/core/components.facade');
const { loadSource } = require('../lib/core/compiler');
const OutPutObject = require('../lib/core/compiler.output');
const compilerObject = new OutPutObject('testSuite');
const componentsResolver = new ComponentsResolver(compilerObject);
const getFilePath = fileName => `${__dirname}/components/${fileName}`;

describe('AST generator', () => {
    it('generates Element AST exported as Function', () => {
        const filePath = getFilePath('elements.js');
        const fileAst = componentsResolver.createFileEntry(filePath);
        const source =  loadSource(filePath, componentsResolver, fileAst, false);
        expect(fileAst.exports[0].local).toBe('TestSuiteElement');
        expect(source.annotations[0].type).toBe('Element')
    })

    it('generates Service AST exported as Function', () => {
        const filePath = getFilePath('service.js');
        const fileAst = componentsResolver.createFileEntry(filePath);
        const source =  loadSource(filePath, componentsResolver, fileAst, false);
        expect(fileAst.exports[0].local).toBe('TestBedService');
        expect(source.annotations[0].type).toBe('Service')
    })

    it('generates Pipe AST exported as Function', () => {
        const filePath = getFilePath('pipe.js');
        const fileAst = componentsResolver.createFileEntry(filePath);
        const source =  loadSource(filePath, componentsResolver, fileAst, false);
        expect(fileAst.exports[0].local).toBe('TestSuitePipe');
        expect(source.annotations[0].type).toBe('Pipe')
    })

    it('generates Module AST exported as Function', () => {
        const filePath = getFilePath('module.js');
        const fileAst = componentsResolver.createFileEntry(filePath);
        const source =  loadSource(filePath, componentsResolver, fileAst, false);
        expect(fileAst.exports[0].local).toBe('TestSuiteModule');
        expect(fileAst.imports.length).toBe(4);
        expect(source.annotations[0].type).toBe('jModule')
    })

    it('generates AST exported as Class', () => {
        const filePath = getFilePath('class.js');
        const fileAst = componentsResolver.createFileEntry(filePath);
        const source =  loadSource(filePath, componentsResolver, fileAst, false);
        expect(fileAst.exports[0].local).toBe('TestClass');
    })
})