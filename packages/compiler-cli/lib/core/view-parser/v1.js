
const BaseViewParser = require('./base.parser');
const helper = require('@jeli/cli/lib/utils');
class ViewParser extends BaseViewParser {
    /**
     * parse ast node received
     * @param {*} output 
     * @param {*} ast 
     * @param {*} idx 
     * @param {*} parent 
     * @param {*} ignoreCompilation 
     * @returns 
     */
    static astParser(output, ast, idx, parent, ignoreCompilation) {
        if (helper.is(ast.type, 'text') && ast.data.trim()) {
            return this.astTextParser(ast.data, false, ignoreCompilation, output);
        } else if (helper.is(ast.type, 'tag')) {
            let ignoreChildCompilation = ignoreCompilation || false;
            const newAstNode = {
                type: 1,
                name: this.isFragmentElement(ast.name) ? "#" : ast.name,
                index: idx,
                isc: this.isComponent(ast.name)
            };

            // compile attributes
            if (ast.attribs) {
                for (const prop in ast.attribs) {
                    if (prop == 'compiler-ignore-child') {
                        ignoreChildCompilation = true;
                        continue;
                    }

                    this.attributeParser(prop, ast.attribs[prop], newAstNode, ignoreCompilation, output);
                }

                // remove unmapped props
                if (newAstNode.props) {
                    Object.keys(newAstNode.props).forEach(prop => {
                        if (helper.is(newAstNode.props[prop], '@!')) {
                            delete newAstNode.props[prop];
                        }
                    });
                }
            }

            if (!ignoreCompilation) {
                // throw Error when Element calls itself
                if (newAstNode.isc) this._validateCustomElementAndThrowError(newAstNode, output);

                this.attachViewChildToAst(newAstNode, output);
                // use this to skip childern compilation
                this.compileChildren(ast, newAstNode, ignoreChildCompilation, output);

                /**
                 * extract component
                 * get directives
                 */
                if (newAstNode.structuralDirective) {
                    /**
                     * remove the directives prop
                     */
                    if (helper.is(ast.name, 'j-place')) {
                        this.jPlaceCompiler(newAstNode, parent, output);
                    }

                    return this.buildStructuralDirectiveTemplates(newAstNode, output);
                }

                return this.checkAndBuildTemplateElement(newAstNode, ast.name, parent, output);
            }

            this.compileChildren(ast, newAstNode, true, output);
            return newAstNode;
        }
        return null;
    }

    static parse(htmlContent, fileChanges, ctor, componentClassName) {
        // removed resolved elements from cache if exists
        this.cleanup(ctor.selector, fileChanges);
        const output = this.createOutputContext(componentClassName, ctor);
        output.parsedContent = this.getAst(htmlContent).map((ast, idx) => {
            try {
                return this.astParser(output, ast, idx);
            } catch (e) {
                output.errorLogs.push(`Error compiling element <${ast.name}/> on line ${idx}`);
            }
        }).filter(element => element);

        // check for unresolved Element childContent
        this.resolvePendingElements(ctor.selector);

        return output;
    }
}

// V1 implementation
module.exports = ViewParser;