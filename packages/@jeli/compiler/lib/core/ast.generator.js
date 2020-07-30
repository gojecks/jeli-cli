const esprima = require('esprima');
const helper = require('@jeli/cli-utils');
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
    THIS: "ThisExpression"
};

const ASTIdentifier = 'Identifier';
const ASTDefaultSpecifier = "ImportDefaultSpecifier";

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

    for (var i = 0; i < ast.body.length; i++) {
        const expression = ast.body[i];
        switch (expression.type) {
            case (ASTDeclarations.IMPORT):
                currentProcess.imports.push(getValueFromAst(expression));
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
                            break;
                        case (ASTDeclarations.FUNCTION):
                            currentProcess.exports.push({
                                local: (expression.declaration.id || { name: 'default' }).name,
                                exported: (expression.declaration.id || { name: 'default' }).name
                            });
                            sourceOutlet.scripts.push(expression.declaration);
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
                        source: expression.source.value
                    });
                }
                break;
            case (ASTExpression.STATEMENT):
                if (isAnnotationStatement(expression)) {
                    // found Annotations
                    const impl = getFunctionImpl(ast.body, i, currentProcess.exports);
                    sourceOutlet.annotations.push({
                        impl,
                        type: expression.expression.callee.name,
                        definitions: generateProperties(expression.expression.arguments[0].properties, true)
                    });
                    i = i + impl.length;
                } else {
                    sourceOutlet.scripts.push(expression);
                }
                break;
            default:
                sourceOutlet.scripts.push(expression);
                break;
        }
    }

    return sourceOutlet;
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
 */
function getValueFromAst(expression, addQuote, scriptMode) {
    switch (expression.type) {
        case (ASTExpression.ARRAY):
            return expression.elements.map(item => getValueFromAst(item, addQuote, scriptMode));
        case (ASTExpression.OBJECT):
            const expr = generateProperties(expression.properties, scriptMode, addQuote);
            return scriptMode ? expr : ({
                type: 'obj',
                expr
            });
        case (ASTIdentifier):
            return addQuote ? `'${expression.name}'` : expression.name;
        case (ASTExpression.MEMBER):
            return getNameSpaceFromAst(expression, [], addQuote);
        case (ASTExpression.CONDITIONAL):
            return {
                type: "ite",
                test: getValueFromAst(expression.test),
                cons: getValueFromAst(expression.consequent, true),
                alt: getValueFromAst(expression.alternate, true)
            };
        case (ASTExpression.ASSIGNMENT):
            return {
                type: "asg",
                left: getValueFromAst(expression.left),
                right: getValueFromAst(expression.right)
            };
            break;
        case (ASTExpression.BINARY):
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
                args: getArguments(expression.arguments, addQuote),
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
                args: getArguments(expression.arguments, addQuote)
            };
        case (ASTDeclarations.IMPORT):
            return ({
                specifiers: (expression.specifiers || []).map(specifier => {
                    return {
                        local: specifier.local.name,
                        imported: specifier.imported ? specifier.imported.name : specifier.local.name
                    };
                }),
                default: expression.specifiers && expression.specifiers.length && helper.is(expression.specifiers[0].type, ASTDefaultSpecifier),
                source: expression.source.value
            });
        default:
            if (addQuote && expression.raw != expression.value)
                return {
                    type: 'raw',
                    value: expression.value
                };
            else
                return expression.value;
    }
}

/**
 * 
 * @param {*} args 
 * @param {*} addQuote 
 */
function getArguments(args, addQuote) {
    return args.map(item => getValueFromAst(item, addQuote))
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
        list.push(ast.name);
    }

    if (ast.property) {
        list.push(ast.property.name);
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
 */
function generateProperties(properties, scriptMode, addQuote = false) {
    return properties.reduce((accum, prop) => {
        accum[prop.key.name || prop.key.value] = getValueFromAst(prop.value, addQuote, scriptMode);
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
}