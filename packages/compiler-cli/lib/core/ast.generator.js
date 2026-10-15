const esprima = require('espree');
const helper = require('@jeli/cli/lib/utils');
const escodegen = require('./escodegen-patch');
const comment = require('./comment');
const expressionList = 'Directive,Element,Service,Provider,Pipe,jModule'.split(',');
const bootStrapFnName = 'bootStrapApplication';
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
    LITERAL: "LITERAL",
    IF: "IfStatement"
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
 * @param {*} isEntry 
 * @param {*} buildOptions 
 * @returns 
 */
exports.generateAstSource = (source, currentProcess, isEntry, buildOptions = {ecmaVersion: 2024}) => {
    let ast = null;
    try {
        ast = esprima.parse(source, {
            attachComment: false,
            range: false,
            loc: false,
            sourceType: deduceSourceType(source),
            ecmaVersion: buildOptions.ecmaVersion
        });
    } catch (e) {
       // espree's SyntaxError carries lineNumber/column but its .message never includes
       // them - re-throwing just e.message (a plain string, not even an Error) discarded
       // that location entirely, so every parse failure surfaced with no way to find the
       // offending line. Fold it back into the message so it survives the err.message-only
       // logging further up the compiler's error-handling chain.
       const loc = e.lineNumber != null ? ` (line ${e.lineNumber}${e.column != null ? ', column ' + e.column : ''})` : '';
       throw new Error(`${e.message}${loc}`);
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
                        case (ASTDeclarations.VARIABLE):
                            currentProcess.exports.push({
                                local: expression.declaration.declarations[0].id.name,
                                exported: expression.declaration.declarations[0].id.name
                            });
                            sourceOutlet.scripts.push(expression.declaration);
                            pushDeclarations(expression.declaration.declarations[0].id.name, 'vars');
                            break;
                        case (ASTDeclarations.FUNCTION):
                        case (ASTDeclarations.CLASS):
                            var name = (expression.declaration.id || { name: 'default' }).name;
                            currentProcess.exports.push({
                                local: name,
                                exported: helper.is(expression.type, ASTDeclarations.EXPORT_DEFAULT) ? 'default' : name
                            });
                            sourceOutlet.scripts.push(expression.declaration);
                            if (name !== 'default')
                                pushDeclarations(name, 'fns');
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
                    const properties = expression.expression.arguments[0];
                    const type = expression.expression.callee.name;
                    currentProcess.isModule = type.includes('Module');
                    const impl = getFunctionImpl(ast.body, i, currentProcess.exports);
                    sourceOutlet.annotations.push({
                        impl,
                        type,
                        definitions: properties ? generateProperties(properties.properties, true, false, currentProcess.isModule) : {}
                    });
                    i = i + impl.length;
                } else {
                    sourceOutlet.scripts.push(expression);
                    if (isEntry && expression.expression.callee.object) {
                       checkForBootStrapModule(expression.expression.callee.object);
                    }
                }
                break;
            default:
                sourceOutlet.scripts.push(expression);
                if (helper.is(ASTDeclarations.VARIABLE, expression.type)) {
                    expression.declarations.map(decl => pushDeclarations(decl.id.name, 'vars'));
                } else if (helper.is(ASTDeclarations.FUNCTION, expression.type)) {
                    pushDeclarations(expression.id.name, 'fns');
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

    function checkForBootStrapModule(expression){
        const callerName = expression.callee.name;
        if (callerName == bootStrapFnName) {
            // get the first argument which should be the module name
            const arg = expression.arguments[0];
            if (!arg || arg.type !== ASTIdentifier) {
                throw new Error(`FN<${callerName}> requires a module in argument #0`);
            }

            // write the bootStrapModule
            console.log(`bootStrap moduleName ${arg.name}`);
            currentProcess.bootStrapModule = arg.name;
        }
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
    const isCallable = [ASTDeclarations.FUNCTION, ASTDeclarations.CLASS].includes(entryAst?.declaration.type);
    if ([ASTDeclarations.EXPORT_NAMED, ASTDeclarations.EXPORT_DEFAULT].includes(entryAst.type) && isCallable) {
        exports.push({
            local: entryAst.declaration.id.name,
            exported: entryAst.declaration.id.name
        });
    } else if (!isCallable) 
        throw new Error(`Annotation should be followed by a Function Declaration`);
        
    const impl = [entryAst.declaration || entryAst];
    const fn = impl[0].id.name;
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
        } else if (helper.is(ast.object.type, ASTIdentifier) || helper.is(ast.object.type, ASTExpression.THIS)) {
            list.push(helper.is(ast.object.type, ASTExpression.THIS) ? '$this' : ast.object.name);
        } else {
            /**
             * any other expression type (logical, binary, conditional, etc.)
             * as a namespace root - delegate to getValueFromAst the same way
             * the CallExpression case above already does, instead of
             * assuming a plain identifier and reading a nonexistent `.name`
             */
            list.push(getValueFromAst(ast.object, addQuote));
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
 * Compiles a compact-AST expression node into a JS source-text expression, mirroring the interpreter's dispatch.
 * Returns null for an intentionally-uncompiled construct (see catalogue [[jeli-cli]] "Compiled event-handler assignments").
 * `allowEvent` makes "$event" resolve to the real event param, recursively - deliberate divergence from the interpreter, see catalogue "$event in compileValueToJs".
 * @param {*} node
 * @param {boolean} [allowEvent]
 * @returns {string|null}
 */
exports.compileValueToJs = function compileValueToJs(node, allowEvent) {
    if (node === null || node === undefined) return 'null';

    const nodeType = typeof node;
    if (nodeType === 'boolean' || nodeType === 'number') return JSON.stringify(node);
    if (nodeType === 'string') {
        if (allowEvent && node === '$event') return '$event';
        // matches resolveValueFromContext's literal-color heuristic
        if (/(#|rgb)/.test(node)) return JSON.stringify(node);
        if (node === '$this') return '$cmp';
        return `core.resolveIdentifier(${JSON.stringify(node)}, $ctx, $cmp)`;
    }

    if (Array.isArray(node)) {
        if (!node.length) return 'null';
        const rootIsEvent = allowEvent && node[0] === '$event';
        let expr = rootIsEvent ? '$event' : compileValueToJs(node[0], allowEvent);
        if (expr === null) return null;
        for (let i = 1; i < node.length; i++) {
            const segment = node[i];
            if (Array.isArray(segment)) {
                // a computed segment (e.g. `[key]` in $event[key]) is just a key expression, never allowEvent itself
                const computed = compileValueToJs(segment);
                if (computed === null) return null;
                expr = `${expr}?.[${computed}]`;
            } else {
                expr = `${expr}?.[${JSON.stringify(segment)}]`;
            }
        }
        return expr;
    }

    if (nodeType !== 'object') return null;

    switch (node.type) {
        case 'raw':
            return JSON.stringify(node.value);
        case 'ite': {
            const test = compileValueToJs(node.test, allowEvent);
            const cons = compileValueToJs(node.cons, allowEvent);
            const alt = compileValueToJs(node.alt, allowEvent);
            if (test === null || cons === null || alt === null) return null;
            return `(${test} ? ${cons} : ${alt})`;
        }
        case 'bin': {
            const left = compileValueToJs(node.left, allowEvent);
            const right = compileValueToJs(node.right, allowEvent);
            if (left === null || right === null) return null;
            return `(${left} ${node.ops} ${right})`;
        }
        case 'una': {
            const arg = compileValueToJs(node.args, allowEvent);
            if (arg === null) return null;
            return `(${node.ops}${arg})`;
        }
        case 'obj': {
            const keys = Object.keys(node.expr);
            const parts = [];
            for (const key of keys) {
                const value = compileValueToJs(node.expr[key], allowEvent);
                if (value === null) return null;
                parts.push(`${JSON.stringify(key)}: ${value}`);
            }
            return `({${parts.join(', ')}})`;
        }
        case 'call': {
            const args = [];
            for (const argNode of (node.args || [])) {
                // a call's own args always get allowEvent, matching generateArguments applied uniformly to any call's args
                const compiled = compileValueToJs(argNode, true);
                if (compiled === null) return null;
                args.push(compiled);
            }
            if (node.namespaces && node.namespaces.length) {
                // a computed namespace segment (a[dynamicKey].fn()) is intentionally not compiled - resolveNamespacedCall needs plain strings
                if (node.namespaces.some(segment => typeof segment !== 'string')) return null;

                if (allowEvent && node.namespaces[0] === '$event') {
                    // $event.stopPropagation()-style call - resolves against the real event only, see catalogue [[jeli-cli]] "$event in compileValueToJs"
                    const remaining = JSON.stringify(node.namespaces.slice(1));
                    return `core.resolveEventNamespacedCall(${remaining}, ${JSON.stringify(node.fn)}, [${args.join(', ')}], $event)`;
                }

                return `core.resolveNamespacedCall(${JSON.stringify(node.namespaces)}, ${JSON.stringify(node.fn)}, [${args.join(', ')}], $ctx, $cmp)`;
            }

            return `core.resolveCall(${JSON.stringify(node.fn)}, [${args.join(', ')}], $ctx, $cmp)`;
        }
        default:
            return null;
    }
};

/**
 * Compiles an 'asg' node into a write to a statically-resolved target - $ctx with `scopeNames.get(root)` SCOPE_PARENT hops, or $cmp.
 * See catalogue [[jeli-cli]] "getScopeNames depth tracking" for why depth (not just membership) matters.
 * @param {*} node
 * @param {Map<string, number>} scopeNames
 * @returns {string|null}
 */
exports.compileAssignmentToJs = function compileAssignmentToJs(node, scopeNames) {
    if (!node || node.type !== 'asg') return null;

    const rightExpr = exports.compileValueToJs(node.right, true);
    if (rightExpr === null) return null;

    const pathSegments = Array.isArray(node.left) ? node.left : String(node.left).split('.');
    if (!pathSegments.length || pathSegments.some(segment => typeof segment !== 'string')) return null;

    const depth = scopeNames && scopeNames.get(pathSegments[0]);
    if (typeof depth !== 'number' && scopeNames && scopeNames.openScope) return null;
    const target = (typeof depth === 'number')
        ? '$ctx' + '[core.SCOPE_PARENT]'.repeat(depth)
        : '$cmp';
    const accessPath = pathSegments.map(segment => `[${JSON.stringify(segment)}]`).join('');
    return `(${target}${accessPath} = ${rightExpr})`;
};

/**
 * Compiles a full event handler body (one compact-AST node per top-level statement) into a single JS statement sequence, joined by "; ". All-or-nothing: any uncompilable statement returns null.
 * @param {Array} statements
 * @param {Map<string, number>} scopeNames
 * @returns {string|null}
 */
exports.compileEventBodyToJs = function compileEventBodyToJs(statements, scopeNames) {
    if (!Array.isArray(statements) || !statements.length) return null;

    const compiledStatements = [];
    for (const statement of statements) {
        const compiled = statement && statement.type === 'asg'
            ? exports.compileAssignmentToJs(statement, scopeNames)
            : exports.compileValueToJs(statement, true);
        if (compiled === null) return null;
        compiledStatements.push(compiled);
    }

    return compiledStatements.join('; ');
};

/**
 * Escapes template-literal-sensitive characters in a literal (non-binding)
 * text segment so it can be embedded inside a generated JS template
 * literal.
 * @param {string} segment
 */
function escapeTemplateLiteralSegment(segment) {
    return segment.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/**
 * Compiles a text-node interpolation binding - the `[dataStr, exprs,
 * onceFlag]` tuple `interpolation.js:parser` produces (`dataStr` contains
 * positional `${N}` placeholders, `exprs` is `[[placeholderToken,
 * filterModel], ...]`) - into the source text of a single JS function
 * `function($ctx, $cmp) { ... }` that returns the fully-interpolated
 * string directly, using a real JS template literal instead of the
 * interpreter's runtime `.replace()` loop.
 *
 * Returns `null` (fall back to the interpreted path for this specific
 * binding) when any expression uses a filter/pipe or a construct
 * `compileValueToJs` doesn't compile - both are deliberately out of scope
 * for this phase, not silent failures.
 * @param {string} dataStr
 * @param {Array} exprs
 * @returns {string|null}
 */
exports.compileTextBindingToFn = function compileTextBindingToFn(dataStr, exprs) {
    const compiledParts = [];
    for (const [token, filterModel] of exprs) {
        if (filterModel.fns && filterModel.fns.length) return null;
        const compiled = exports.compileValueToJs(filterModel.prop);
        if (compiled === null) return null;
        compiledParts.push({ token, expr: compiled });
    }

    let remaining = dataStr;
    const literalSegments = [];
    for (const part of compiledParts) {
        const idx = remaining.indexOf(part.token);
        if (idx === -1) return null;
        literalSegments.push(remaining.slice(0, idx));
        remaining = remaining.slice(idx + part.token.length);
    }
    literalSegments.push(remaining);

    let template = escapeTemplateLiteralSegment(literalSegments[0]);
    compiledParts.forEach((part, i) => {
        template += '${' + part.expr + '}' + escapeTemplateLiteralSegment(literalSegments[i + 1]);
    });

    // matches compileTemplate's [null, undefined, 'null'].includes(value) => ''
    // fallback for the case where the whole binding is a single expression
    // that resolved to null/undefined
    return `function($ctx, $cmp) { var $v = \`${template}\`; return ($v === 'null' || $v === 'undefined') ? '' : $v; }`;
};

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