const esprima = require('esprima');
const helper = require('@jeli/cli/lib/utils');
const escodegen = require('escodegen');
const comment = require('./comment');
const expressionList = 'Directive,Element,Service,Provider,Pipe,jModule'.split(',');
const ASTDeclarations = {
    IMPORT: "ImportDeclaration",
    EXPORT_NAMED: "ExportNamedDeclaration",
    EXPORT_ALL: "ExportAllDeclaration",
    EXPORT_DEFAULT: "ExportDefaultDeclaration",
    CLASS: "ClassDeclaration",
    VARIABLE: "VariableDeclaration",
    FUNCTION: "FunctionDeclaration"
};

const ASTExpression = {
    STATEMENT: 'ExpressionStatement',
    CALL: "CallExpression",
    ASSIGNMENT: "AssignmentExpression",
    ARRAY: 'ArrayExpression',
    OBJECT: 'ObjectExpression',
    MEMBER: "MemberExpression",
    BINARY: "BinaryExpression",
    CONDITIONAL: "ConditionalExpression",
    EMPTY: "EmptyStatement",
    UNARY: "UnaryExpression",
    NEW: "NewExpression",
    THIS: "ThisExpression",
    LOGICAL: "LogicalExpression",
    LITERAL: "LITERAL"
};

const ASTIdentifier = 'Identifier';
const ASTDefaultSpecifier = "ImportDefaultSpecifier";
const ASTNamespaceSpecifier = "ImportNamespaceSpecifier";
const ASTLiteralType = "Literal";

function deduceSourceType(source) {
    return ['export ', 'import '].some(expimp => helper.isContain(expimp, source)) ? 'module' : 'script';
}

/**
 * 
 * @param {*} source 
 * @param {*} currentProcess 
 * @param {*} stripBanner 
 */
exports.generateAstSource = (source, currentProcess, stripBanner) => {
    let ast = null;
    try {
        ast = esprima.parse(source, {
            attachComment: false,
            range: false,
            loc: false,
            sourceType: deduceSourceType(source)
        });
    } catch (e) {
        throw e.message;
    }

    const sourceOutlet = {
        annotations: [],
        scripts: [],
        type: ast.sourceType
    };

    var i = 0;
    for (; i < ast.body.length; i++) {
        const expression = ast.body[i];
        switch (expression.type) {
            case (ASTDeclarations.IMPORT):
                const importItem = getValueFromAst(expression);
                const existsource = currentProcess.imports.find(item => item.source === importItem.source);
                if (existsource) {
                    existsource.specifiers.push.apply(existsource.specifiers, importItem.specifiers);
                } else {
                    currentProcess.imports.push(importItem);
                }
                break;
            case (ASTDeclarations.EXPORT_NAMED):
            case (ASTDeclarations.EXPORT_ALL):
            case (ASTDeclarations.EXPORT_DEFAULT):
                if (expression.declaration) {
                    switch (expression.declaration.type) {
                        case (ASTDeclarations.CLASS):
                            throw new Error('Class exportation not yet supported');
                        case (ASTDeclarations.VARIABLE):
                            currentProcess.exports.push({
                                local: expression.declaration.declarations[0].id.name,
                                exported: expression.declaration.declarations[0].id.name
                            });
                            sourceOutlet.scripts.push(expression.declaration);
                            pushDeclarations(expression.declaration.declarations[0].id.name, 'vars');
                            break;
                        case (ASTDeclarations.FUNCTION):
                            var name = (expression.declaration.id || { name: 'default' }).name;
                            currentProcess.exports.push({
                                local: name,
                                exported: helper.is(expression.type, ASTDeclarations.EXPORT_DEFAULT) ? 'default' : name
                            });
                            sourceOutlet.scripts.push(expression.declaration);
                            if (name !== 'default') {
                                pushDeclarations(name, 'fns');
                            }
                            break;
                        case (ASTIdentifier):
                            currentProcess.exports.push({
                                local: expression.declaration.name,
                                exported: 'default'
                            });
                            break;
                    };
                } else if (expression.specifiers) {
                    currentProcess.exports.push.apply(currentProcess.exports,
                        expression.specifiers.map(item => {
                            return {
                                exported: item.exported.name,
                                local: item.local.name
                            }
                        }));
                } else if (expression.source) {
                    currentProcess.imports.push({
                        specifiers: [],
                        source: expression.source.value,
                        asModule: expression.source.value.includes('module')
                    });
                }
                break;
            case (ASTExpression.STATEMENT):
                if (isAnnotationStatement(expression)) {
                    // found Annotations
                    const impl = getFunctionImpl(ast.body, i, currentProcess.exports);
                    const properties = expression.expression.arguments[0];
                    const type = expression.expression.callee.name;
                    const isService = ['jmodule'].includes(type.toLowerCase());
                    sourceOutlet.annotations.push({
                        impl,
                        type,
                        definitions: properties ? generateProperties(properties.properties, true, false, isService) : {}
                    });
                    i = i + impl.length;
                } else {
                    sourceOutlet.scripts.push(expression);
                }
                break;
            default:
                sourceOutlet.scripts.push(expression);
                if (helper.is(ASTDeclarations.VARIABLE, expression.type)) {
                    expression.declarations.map(decl => pushDeclarations(decl.id.name, 'vars'));
                } else if (helper.is(ASTDeclarations.FUNCTION, expression.type)) {
                    pushDeclarations(expression.id.name, 'fns')
                }
                break;
        }
    }

    return sourceOutlet;

    /**
     * 
     * @param {*} name 
     * @param {*} type 
     */
    function pushDeclarations(name, type) {
        if (currentProcess.declarations[type].includes(name)) {
            throw new Error(`${type}<${name}> already declared, cannot be re-declare`);
        }

        currentProcess.declarations[type].push(name);
    }
}

function isAnnotationStatement(expression) {
    return (expression.expression &&
        expression.expression.type == ASTExpression.CALL &&
        expressionList.includes(expression.expression.callee.name))
}

/**
 * 
 * @param {*} path 
 * @param {*} type 
 */
function validateSourcePath(path, type) {
    if (helper.isContain('*', path)) {
        helper.console.warn(`patterns not allowed in ${type} statement -> ${path}`);
        return false;
    }

    return true;
}

/**
 * 
 * @param {*} ast 
 * @param {*} idx 
 * @param {*} exports
 */
function getFunctionImpl(ast, idx, exports) {
    const entryAst = ast[idx + 1];
    if (helper.isContain(entryAst.type, [ASTDeclarations.EXPORT_NAMED, ASTDeclarations.EXPORT_DEFAULT]) &&
        helper.is(entryAst.declaration.type, ASTDeclarations.FUNCTION)) {
        exports.push({
            local: entryAst.declaration.id.name,
            exported: entryAst.declaration.id.name
        });
    } else if (!helper.is(entryAst.type, ASTDeclarations.FUNCTION)) {
        throw new Error(`Annotation should be followed by a Function Declaration`);
    }

    const fn = (entryAst.declaration || entryAst).id.name;
    const impl = [entryAst.declaration || entryAst];

    for (const expression of ast.slice(idx + 2)) {
        if (isAnnotationStatement(expression)) return impl;
        if (_matches(expression)) impl.push(expression);
    }

    function _matches(expression) {
        return helper.is(ASTExpression.EMPTY, expression.type) ||
            (helper.is(expression.type, ASTExpression.STATEMENT) &&
                helper.is(expression.expression.type, ASTExpression.ASSIGNMENT) &&
                helper.is(expression.expression.left.object.name || expression.expression.left.object.object.name, fn))
    }

    return impl;
}

/**
 * 
 * @param {*} declaration 
 */
function getClassDeclarationFromAst(declaration) {
    return {
        name: declaration.id.name,
        superClass: delcaration.superClass,
        body: declaration.body.body
    }
}

/**
 * 
 * @param {*} expression 
 * @param {*} addQuote 
 * @param {*} scriptMode 
 * @param {*} asIs 
 * @returns 
 */
function getValueFromAst(expression, addQuote, scriptMode, asIs) {
    switch (expression.type) {
        case (ASTExpression.ARRAY):
            return expression.elements.map(item => getValueFromAst(item, addQuote, scriptMode, asIs));
        case (ASTExpression.OBJECT):
            const expr = generateProperties(expression.properties, scriptMode, addQuote, asIs);
            return (scriptMode || asIs) ? expr : ({
                type: 'obj',
                expr
            });
        case (ASTIdentifier):
            return scriptMode && addQuote ? `'${expression.name}'` : expression.name;
        case (ASTExpression.MEMBER):
            const value = getNameSpaceFromAst(expression, [], addQuote);
            return asIs ? value.join('.') : value;
        case (ASTExpression.CONDITIONAL):
            return {
                type: "ite",
                test: getValueFromAst(expression.test),
                cons: getValueFromAst(expression.consequent),
                alt: getValueFromAst(expression.alternate)
            };
        case (ASTExpression.ASSIGNMENT):
            return {
                type: "asg",
                left: getValueFromAst(expression.left),
                right: getValueFromAst(expression.right)
            };
            break;
        case (ASTExpression.BINARY):
        case (ASTExpression.LOGICAL):
            return {
                type: "bin",
                left: getValueFromAst(expression.left),
                ops: expression.operator,
                right: getValueFromAst(expression.right)
            };
        case (ASTExpression.CALL):
            /**
             * MemberExpression
             * test.test.test(a,b)
             */
            const namespaces = getNameSpaceFromAst(expression.callee, [], addQuote);
            const item = {
                type: addQuote ? "'call'" : "call",
                args: getArguments(expression.arguments, false, asIs),
                fn: namespaces.pop()
            };

            if (namespaces.length) {
                item.namespaces = namespaces;
            }

            return item;
        case (ASTExpression.UNARY):
            return {
                type: "una",
                ops: expression.operator,
                args: getValueFromAst(expression.argument, addQuote)
            };
        case (ASTExpression.NEW):
            return {
                type: "new",
                fn: expression.callee.name,
                args: getArguments(expression.arguments, addQuote, asIs)
            };
        case (ASTDeclarations.IMPORT):
            const specifiers = (expression.specifiers || []);
            return ({
                specifiers: specifiers.map(specifier => {
                    return {
                        local: specifier.local.name,
                        imported: specifier.imported ? specifier.imported.name : specifier.local.name
                    };
                }),
                default: specifiers.length && helper.is(expression.specifiers[0].type, ASTDefaultSpecifier),
                nameSpace: specifiers.length && helper.is(expression.specifiers[0].type, ASTNamespaceSpecifier),
                source: expression.source.value
            });
        default:
            if (!scriptMode && expression.raw != expression.value && !asIs)
                return {
                    type: 'raw',
                    value: expression.value
                };
            else
                return expression[(asIs && expression.raw && helper.typeOf(expression.value, 'string')) ? 'raw' : 'value'];
    }
}

/**
 * 
 * @param {*} args 
 * @param {*} addQuote 
 * @param {*} raw 
 * @returns 
 */
function getArguments(args, addQuote, raw) {
    return args.map(item => {
        const arg = getValueFromAst(item, addQuote, false, raw);
        return (helper.is(ASTExpression.ARRAY, item.type) && !raw) ? { arg } : arg;
    });
}

/**
 * 
 * @param {*} ast 
 * @param {*} list 
 * @param {*} addQuote 
 */
function getNameSpaceFromAst(ast, list, addQuote) {
    if (ast.object) {
        /**
         * check for callExpression
         */
        if (helper.is(ast.object.type, ASTExpression.CALL)) {
            list.push(getValueFromAst(ast.object, addQuote));
        } else if (ast.object.object) {
            getNameSpaceFromAst(ast.object, list, addQuote);
        } else {
            list.push(helper.is(ast.object.type, ASTExpression.THIS) ? '$this' : ast.object.name);
        }
    } else {
        list.push(ast.name || ast.value);
    }

    if (ast.property) {
        if (ast.computed) {
            list.push(getNameSpaceFromAst(ast.property, [], addQuote))
        } else {
            list.push(ast.property.name || ast.property.value);
        }
    }

    if (addQuote) {
        return list.map(identifier => `'${identifier}'`);
    }

    return list;
}

/**
 * 
 * @param {*} properties 
 * @param {*} scriptMode 
 * @param {*} addQuote 
 * @param {*} asIs 
 * @returns 
 */
function generateProperties(properties, scriptMode, addQuote = false, asIs) {
    return properties.reduce((accum, prop) => {
        accum[prop.key.name || prop.key.value] = getValueFromAst(prop.value, addQuote, scriptMode, asIs);
        return accum;
    }, {});
}

/**
 * 
 * @param {*} expression 
 * @param {*} addQuote 
 */
exports.parseAst = (expression, addQuote) => {
    return esprima.parse(expression).body.map(statement => getValueFromAst(statement.expression, addQuote));
}

/**
 * 
 * @param {*} expression 
 */
exports.parseAstJSON = (expression, addQuote) => {
    const parsed = esprima.parse(`(${expression})`);
    return getValueFromAst(parsed.body[0].expression, addQuote);
}

/**
 * 
 * @param {*} syntax 
 */
exports.escogen = (syntax) => {
    return escodegen.generate({
        type: 'Program',
        body: syntax
    }, {
        comment: true,
        format: {
            indent: {
                style: "    "
            }
        }
    });
};

/**
 * 
 * @param {*} ast 
 */
exports.findDeclarations = function(ast) {
    var funcDecls = [];
    var globalVarDecls = [];
    var funcStack = [];

    function visitEachAstNode(root, enter, leave) {
        function visit(node) {
            function isSubNode(key) {
                var child = node[key];
                if (child === null) return false;
                var ty = typeof child;
                if (ty !== 'object') return false;
                if (child.constructor === Array) return (key !== 'range');
                if (key === 'loc') return false;
                if ('type' in child) {
                    if (child.type in esprima.Syntax) return true;
                    debugger;
                    throw new Error('unexpected');
                } else { return false; }
            }
            enter(node);
            var keys = Object.keys(node);
            var subNodeKeys = keys.filter(isSubNode);
            for (var i = 0; i < subNodeKeys.length; i++) {
                var key = subNodeKeys[i];
                visit(node[key]);
            }
            leave(node);
        }
        visit(root);
    }

    function myEnter(node) {
        if (node.type === 'FunctionDeclaration') {
            var current = {
                name: node.id.name,
                params: node.params.map(function(p) { return p.name; }),
                variables: []
            }
            funcDecls.push(current);
            funcStack.push(current);
        }
        if (node.type === 'VariableDeclaration') {
            var foundVarNames = node.declarations.map(function(d) { return d.id.name; });
            if (funcStack.length === 0) {
                globalVarDecls = globalVarDecls.concat(foundVarNames);
            } else {
                var onTopOfStack = funcStack[funcStack.length - 1];
                onTopOfStack.variables = onTopOfStack.variables.concat(foundVarNames);
            }
        }
    }

    function myLeave(node) {
        if (node.type === 'FunctionDeclaration') {
            funcStack.pop();
        }
    }
    visitEachAstNode(ast, myEnter, myLeave);
    return {
        vars: globalVarDecls,
        funcs: funcDecls
    };
}