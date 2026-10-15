/**
 * html core parser
 */
const parser = require('html-dom-parser').default;
const { parseAst, parseAstJSON, compileTextBindingToFn, compileValueToJs, compileEventBodyToJs } = require('../ast.generator');
const interpolation = require('../interpolation');
const helper = require('@jeli/cli/lib/utils');
const { matchViewQueryFromAstNode } = require('../query_selector');
const rules = require('../rules');
const { ckeyWords } = require('../../utils/keywords');
const restrictedCombination = ['j-template', 'j-place', 'case', 'default'];
const standardAttributes = 'id|class|style|title|dir|lang|aria';
const oneWayBinding = /\{(.*?)\}/;
const twoWayBinding = /\@\{(.*?)\}/;
const isFnCallRegEx = /\w\((.*?)\)/;
const charMatchers = [':', '*', '#', '@', '{', '('];
const TEMPLATE_KEY = key => `<%${key}%>`;
const selectorTypes = {
    '.': 'class',
    '#': 'id',
    '[': 'attr'
};
const resolvedFilters = {};
const resolvedElements = {};
const pendingElements = {};

const EventHandlerTypes = {
    change: ['checkbox', 'radio', 'select-one', 'select-multiple', 'select'],
    input: ['text', 'password', 'textarea', 'email', 'url', 'week', 'time', 'search', 'tel', 'range', 'number', 'month', 'datetime-local', 'date', 'color']
};

const inBuildMethods = {
    range: (args) => {
        let [start, end, step, labels] = args.split(',').map(helper.simpleArgumentParser);
        const res = [];
        labels = (labels || '').split('-');
        for (let i = start; i <= end; i++) {
            if (step) {
                i = ((i + step) - 1);
                if (i > end) i = end;
            }
            res.push(labels && labels[i] || i);
        }

        return res;
    },
    object:(args) => {
        return args.split(',').reduce((accum, entry) => {
            const kv = entry.split('=');
            accum[kv[0].trim()] = helper.simpleArgumentParser(kv[1]);
            return accum;
        }, {});
    },
    array: (values) => values.map(helper.simpleArgumentParser)
};

class BaseViewParser {
    static componentResolver = null;
    static assetURL = null;
    static _annotations = new Map();
    static isComponent(tagName){
        return helper.isContain('-', tagName) && !this.isFragmentElement(tagName);
    }

    static execInbuilt(expr){
        const match = /\$(range|object|array)\((.*?)\)/.exec(expr);
        if (match){
            return {
                type: 'raw',
                value: inBuildMethods[match[1].toLowerCase()](match[2])
            };
        }
        
        return null;
    }

    static isFragmentElement(tagName){
        return ["j-fragment", "j-template", "j-place", 'template'].includes(tagName);
    }

    static init(componentResolver) {
        this.assetURL = componentResolver.compilerObject.buildOptions.assetURL;
        this.componentResolver = componentResolver;
    }

    static createOutputContext(componentClassName, ctor){
         return {
            componentClassName,
            ctor,
            errorLogs: [],
            parsedContent: null,
            templateOptionsMapper: [],
            templatesMapHolder: {},
            providers: {
                ViewParser: '@jeli/core'
            },
            pendingDependencies: false,
            vt: {}, // viewTemplates
            compiledFnSources: [] // compiledBindings codegen output, see astTextParser
        };
    }

    static getAst(htmlContent){
        return parser(htmlContent, {
            normalizeWhitespace: true,
            lowerCaseAttributeNames: false,
            decodeEntities: true
        })
    }

    /**
     * 
     * @param {*} parentAstNode 
     * @param {*} childAst 
     * @param {*} query 
     * @returns 
     */
    static attachContentChildPlace(parentAstNode, childAst, query) {
        if (!query || !query.place) return;
        const refs = Object.keys(query.place);
        let astName = childAst.name;
        let astRefId = childAst.refId;
        let attr = childAst.attr;
        // checker for structural directive
        if (helper.is(childAst.type, 8)) {
            astName = childAst.templates[childAst.text].name;
            astRefId = childAst.templates[childAst.text].refId;
            attr = childAst.templates[childAst.text].attr;
        }

        let placeId = null;
        if (refs.length === 1 && refs[0] === '@') {
            placeId = '@';
        } else if (astRefId && query.place[astRefId]) {
            placeId = astRefId;
        } else if (query.place[astName]) {
            placeId = astName;
        } else if (attr) {
            // [id, class, attr]
            for (const ref in query.place) {
                const prop = (attr[query.place[ref]] || '').split(/\s/g);
                if ((attr.hasOwnProperty(ref) && query.place[ref] === 'attr') || (prop.includes(ref))) {
                    placeId = ref;
                    break;
                }
            }
        }

        // push to place
        if (placeId) {
            if (!parentAstNode.templates) {
                parentAstNode.templates = { place: {} };
            }

            if (!parentAstNode.templates.place[placeId]) {
                parentAstNode.templates.place[placeId] = [];
            }

            // push all children if childAst is a fragment
            if (helper.is(childAst.name, '#') && childAst.children) {
                parentAstNode.templates.place[placeId].push.apply(parentAstNode.templates.place[placeId], childAst.children);
            } else {
                parentAstNode.templates.place[placeId].push(childAst);
            }
        }
    }

    /**
     * attach conntentChildren to template
     * @param {*} parentAstNode 
     * @param {*} childAst 
     * @param {*} output
     */
    static attachContentChildren(parentAstNode, childAst, output) {
        if (!resolvedElements[parentAstNode.name]) return;
        const query = resolvedElements[parentAstNode.name].query;
        const isStructural = helper.is(childAst.type, 8);
        const matched = matchViewQueryFromAstNode(query.child, isStructural ? childAst.templates[childAst.text] : childAst);
        if (matched) {
            if (isStructural) {
                output.errorLogs.push(`ContentChild(ren) query does not currently support structural directive "${childAst.text}" -> ${matched.name}=${matched.value}`);
                return;
            }

            // args to be pushed to contentChildren method
            const qlAstNode = [matched.type || (childAst.type == 1 ? ckeyWords.ELEMENTREF : ckeyWords.TEMPLATEREF), matched.ql];
            const name = matched.name || matched.value;
            // const id = !contentChildrenMapper[parentAstNode.name] ? 
            if (!parentAstNode.cq)
                parentAstNode.cq = {};
            // ContentChildren
            if (matched.ql) {
                if (!parentAstNode.cq[name]) {
                    qlAstNode.push([]);
                    parentAstNode.cq[name] = qlAstNode;
                }
                parentAstNode.cq[name][2].push(childAst);
            } else {
                qlAstNode.push(childAst);
                parentAstNode.cq[name] = qlAstNode;
            }
        } else {
            if (!query.place) {
                if (!pendingElements[parentAstNode.name])
                    pendingElements[parentAstNode.name] = {};
                if (!pendingElements[parentAstNode.name][output.ctor.selector])
                    pendingElements[parentAstNode.name][output.ctor.selector] = [parentAstNode, []]
                // push the childlist
                pendingElements[parentAstNode.name][output.ctor.selector][1].push(childAst);
                output.pendingDependencies = true;
                return;
            }
            // attach place element
            this.attachContentChildPlace(parentAstNode, childAst, query);
        }
    }

    /**
     * compile template children
     * @param {*} astNode
     * @param {*} compiledAstNode 
     * @param {*} ignoreChildCompilation
     * @param {*} output
     */
    static compileChildren(astNode, compiledAstNode, ignoreChildCompilation, output) {
        if (astNode.children && astNode.children.length) {
            compiledAstNode.children = [];
            astNode.children
                .forEach((child, idx) => {
                    if (!(child.name || (child.data && child.data.trim()))) return;
                    var childAstNode = this.astParser(output, child, idx, compiledAstNode, ignoreChildCompilation);
                    if (childAstNode) {
                        if (compiledAstNode.isc && !ignoreChildCompilation) {
                            this.attachContentChildren(compiledAstNode, childAstNode, output);
                        } else {
                            compiledAstNode.children.push(childAstNode);
                        }
                    }
                });
        }
    }

    /**
     * 
     * @param {*} data 
     * @param {*} isAttr 
     * @param {*} ignoreCompilation 
     * @param {*} output 
     * @returns 
     */
    static astTextParser(data, isAttr, ignoreCompilation, output) {
        let ast = [data];
        if (!ignoreCompilation) {
            ast = this.pipesProvider(data, output, true);
            if (ast.length > 1) {
                /**
                 * pasrse ast
                 */
                ast[1].forEach(item => item[1].prop = this.expressionAst(item[1].prop, output))

                /**
                 * compiledBindings: replace the interpreted [placeholder,
                 * filterModel] pair list with a real compiled function -
                 * text-node bindings (Phase 1) and, since Phase 2, plain
                 * attribute values with an embedded ${} placeholder (e.g.
                 * class="btn-${state}") - both produce this identical
                 * array shape via astTextParser. Falls back to the
                 * interpreted shape (untouched ast[1]) for anything
                 * compileTextBindingToFn declines (filters, unsupported
                 * expression constructs).
                 */
                if (this.componentResolver.compilerObject.buildOptions.compiledBindings) {
                    const fnSource = compileTextBindingToFn(ast[0], ast[1]);
                    if (fnSource !== null) {
                        const idx = output.compiledFnSources.push(fnSource) - 1;
                        ast[1] = `<%CFN:${idx}%>`;
                    }
                }
            }
        }

        return isAttr ? ast : {
            type: 3,
            ast
        };
    }

    /**
     * 
     * @param {*} expression 
     * @param {*} output 
     * @returns 
     */
    static expressionAst(expression, output) {
        if (!helper.typeOf(expression, 'string')) {
            return expression;
        }

        let ast;
        try {
            if (expression.startsWith('{'))
                ast = parseAstJSON(expression);
            else if (/^\[(.*)\]$/.test(expression)) {
                let parsed;
                try {
                    parsed = new Function(`return ${expression}`)();
                } catch (e) { console.log(e); }
                ast = {
                    type: "raw",
                    value: parsed
                }
            } else
                ast = parseAst(expression)[0];
        } catch (e) {
            // espree's SyntaxError carries lineNumber/column but its .message never includes them;
            // fold it back in so the log points at where in `expression` the bad token is.
            const loc = e.lineNumber != null ? ` (column ${e.column})` : '';
            output.errorLogs.push(helper.colors.white(`${e.message}${loc} -> ${expression}`))
        }

        return ast;
    }

    /**
     * 
     * @param {*} astAttr 
     */
    static generateContext(astAttr) {
        if (astAttr.context) {
            if (astAttr.context === '*') {
                return astAttr.data || null;
            } else if (/\{(.*)\}/.test(astAttr.context)) {
                return parseAstJSON(`(${astAttr.context})`).expr;
            } else if (astAttr.context == '$this')
                return true;
        }
    }

    /**
     * compiledBindings: compiles each key of a <j-place>/static
     * <j-fragment> `$ctx`/`ctx$` object (produced by `generateContext`'s
     * object-expression branch above - a plain object mapping each key to
     * an ordinary compact-AST node, identical in shape to everything
     * `compileValueToJs` already compiles). Skipped entirely for the two
     * non-object `generateContext` results (`context="$this"` -> `true`,
     * `context="*"` -> a raw string) - neither is a per-key object, there
     * is nothing to compile.
     * @param {*} ctxObj
     * @param {*} output
     */
    static compileContextObject(ctxObj, output) {
        if (!this.componentResolver.compilerObject.buildOptions.compiledBindings) return;
        if (!ctxObj || typeof ctxObj !== 'object') return;
        for (const key in ctxObj) {
            const compiled = compileValueToJs(ctxObj[key]);
            if (compiled === null) continue;
            const idx = output.compiledFnSources.push(`function($ctx, $cmp) { return ${compiled}; }`) - 1;
            ctxObj[key] = `<%CFN:${idx}%>`;
        }
    }

    /**
     * 
     * @param {*} node 
     * @param {*} output 
     * @param {*} isAst 
     * @returns 
     */
    static pipesProvider(node, output, isAst = false) {
        return interpolation[isAst ? 'parser' : 'removeFilters'](node, (filter, filterModel) => {
            let pipeName = filter;
            const separatorIndex = filter.indexOf(':');
            if (separatorIndex > -1) {
                pipeName = filter.substr(0, separatorIndex);
                filterModel.args.push(filter.substr(separatorIndex + 1, filter.length).split(';').map(expr => this.expressionAst(expr, output)));
            }
            /**
             * Push the resolved filter to the model
             * @param {*} deps 
             */
            const _pushFilters = (deps) => {
                filterModel.fns.push(`%${deps.fn}%`);
                output.providers[`${deps.fn}`] = deps.module;
            };

            if (!resolvedFilters.hasOwnProperty(pipeName)) {
                const deps = this.componentResolver?.getPipe(pipeName);
                if (deps) {
                    resolvedFilters[pipeName] = deps;
                    _pushFilters(deps);
                } else {
                    output.errorLogs.push(`Unable to resolve pipe <${helper.colors.yellow(pipeName)}>. Please include pipe and recompile application.`)
                }
            } else {
                _pushFilters(resolvedFilters[pipeName]);
            }
        });
    }

    /**
    * 
    * @param {*} dirName 
    * @param {*} expr 
    * @param {*} astNode 
    * @param {*} registeredDir 
    */
    static parseStructuralDirective(dirName, expr, astNode, registeredDir, output) {
        /**
         * validate the structuralElement
         * make sure no combination of two structural elements
         */
        const invalidIdx = restrictedCombination.indexOf(dirName);
        if (invalidIdx > -1) {
            output.errorLogs.push(`${dirName} cannot be used with ${restrictedCombination[invalidIdx]}`);
            return;
        }

        if (astNode.structuralDirective) {
            output.errorLogs.push(`${astNode.structuralDirective.dirName} directive cannot be used with ${dirName} directive`);
            return;
        }

        const _parseProps = (key, idx) => {
            if (idx && helper.isContain('=', key)) {
                const propSplt = helper.splitAndTrim(key, "=");
                astNode.context = astNode.context || {};
                astNode.context[propSplt[0]] = this.expressionAst(propSplt[1], output);
            } else if (idx && helper.isContain(' as ', key)) {
                const propSplt = helper.splitAndTrim(key, ' as ');
                props = (props || {});
                props[helper.camelCase(`${dirName}-${propSplt[0]}`)] = this.expressionAst(propSplt[1], output);
            } else {
                const ast = this.pipesProvider(key, output);
                props = (props || {});
                if (helper.typeOf(ast.prop, 'string')) {
                    astStringParser(ast, props);
                } else {
                    props[dirName] = ast;
                }
            }
        };

        /**
         * concat syntax to form a variable
         * e.g for in expr = forIn
         * @param {*} ast 
         * @param {*} props 
         */
        const astStringParser = (ast, props) => {
            const regExp = /\s+\w+\s/;
            // "word in/of items" split is only valid for *for's forIn/forOf syntax
            if (dirName === 'for' && regExp.test(ast.prop)) {
                const matched = ast.prop.match(regExp);
                const checkerSplt = helper.splitAndTrim(ast.prop, matched[0]);
                const inbuiltMatch = this.execInbuilt(checkerSplt[1])
                if (inbuiltMatch) {
                    ast.prop = inbuiltMatch;
                } else {
                    ast.prop = this.expressionAst(checkerSplt[1], output);
                }

                props[helper.camelCase(`${dirName}-${matched[0].trim()}`)] = ast;
                astNode.context = astNode.context || {};
                astNode.context[checkerSplt[0]] = '$context';
            } else {
                ast.prop = this.expressionAst(ast.prop, output);
                props[dirName] = ast;
            }
        };

        let props = null;
        helper.splitAndTrim(expr, ';').forEach(_parseProps);
        astNode.structuralDirective = {
            registeredDir,
            dirName,
            props
        };
    }
    /**
     * 
     * @param {*} node 
     * @param {*} value 
     * @param {*} astNode 
     */
    static defaultAttrParser(node, value, astNode){
        // check for inline attr that requires update of value e.g src, inline styling
        if (this.assetURL && ((node == 'src' && !value.includes('//')) || (node == 'style' && value.includes('url(')))) {
            if (node == 'src') {
                value = rules.rewriteUrl(value, this.assetURL);
            } else if (node == 'style') { // backgroundImage parser
                value = rules.rewriteBkgUrl(value, this.assetURL);
            }
        } else { // symbol for object extractor
           value = this.execInbuilt(value) || value;
        }

        this.setObjectType(astNode, 'attr', node, helper.simpleArgumentParser(value));
    }

    /**
     * 
     * @param {*} name 
     * @param {*} value 
     * @param {*} astNode  
     * @param {*} output 
     * @param {*} hasBinding
     * @returns 
     */
    static addDirectives(name, value, astNode, output, hasBinding = false) {
        const dirName = name.substr(1);
        // mock props for querySelector
        const props = {
            name: astNode.name,
            attr: Object.assign({[dirName]: true}, astNode.attr)
        };
        const registeredDir = this.componentResolver.getDirectives(dirName, props, output.componentClassName);
        if (!registeredDir.length) {
            output.errorLogs.push(`Element <${astNode.name}> does not support this attribute [${dirName}]. if [${dirName}] is a customAttribute please create and register it.`);
            return;
        }

        if (helper.is(name.charAt(0), '*')) {
            this.parseStructuralDirective(dirName, value, astNode, registeredDir, output);
        } else {
            this.setObjectType(astNode, 'props', dirName, value, hasBinding, hasBinding, output);
            this._attachProviders(registeredDir, astNode, true, output);
        }
    }

    /**
     * 
     * @param {*} node 
     * @param {*} value 
     * @param {*} astNode 
     * @param {*} output 
     * @returns 
     */
    static _determineEventBinding(node, value, astNode, output) {
        if (!value) return output.errorLogs.push(`[${node}] directive requires value, empty passed`);

        const isOneWay = node.startsWith('@:');
        if (twoWayBinding.test(node) || isOneWay) {
            /**
             * @{:model}="twoWayBinding"
             *  @:customDirective="outputHandler($event)"
             */
            let prop = isOneWay ? node.substring(1) : node.match(twoWayBinding)[1];
            if (helper.isContain(':', prop.charAt(0))) {
                this.addDirectives(prop, value, astNode, output, true);
                prop = prop.substr(1);
            }

            this.setArrayType(astNode, 'events', {
                name: `${prop}Change`,
                value: parseAst(isFnCallRegEx.test(value) ? value : `${value.split('|')[0]}=$event`),
                custom: true
            })
        } else {
            /**
             * Event Binding
             * e.g @click="listener()" 
             * @onCustomEvent="someCustomListener"
             * @click-delegate:elementName
             */
            try {
                const dir = node.split(/[@:]/g).splice(1);
                const delegateOrNorm = dir.shift().split('-');
                const item = {
                    name: delegateOrNorm.shift(),
                    value: parseAst(value)
                };

                if (dir.length && delegateOrNorm.length) {
                    item.target = dir.pop().split(',');
                }

                // set the item
                this.setArrayType(astNode, 'events', item);
            } catch (e) {
                const loc = e.lineNumber != null ? ` (column ${e.column})` : '';
                output.errorLogs.push(helper.colors.white(`${e.message}${loc} -> ${value}`));
            }
        }
    }

    /**
     * Collects every `*for`'s local-variable names up astNode's elementParent chain, tagged with exact scope depth. See catalogue [[jeli-cli]] "getScopeNames depth tracking".
     * @param {*} astNode
     * @returns {Map<string, number>}
     */
    static getScopeNames(astNode) {
        const scopeNames = new Map();
        let node = astNode;
        let depth = 0;
        while (node) {
            if (node.context) {
                for (const key in node.context) {
                    if (!scopeNames.has(key)) scopeNames.set(key, depth);
                }
                depth++;
            }
            // j-template content renders in its consumer's scope, unknown roots must resolve at runtime
            if (node.templateBoundary) {
                scopeNames.openScope = true;
                break;
            }
            node = node.elementParent;
        }

        return scopeNames;
    }

    /**
     * Compiles each assignment-shaped event on astNode.events into a .compiledFn, all-or-nothing per handler. See catalogue [[jeli-cli]] "Compiled event-handler assignments".
     * @param {*} astNode
     * @param {*} output
     */
    static compileEventAssignments(astNode, output) {
        if (!this.componentResolver.compilerObject.buildOptions.compiledBindings) return;
        if (!astNode.events || !astNode.events.length) return;

        let scopeNames = null;
        for (const event of astNode.events) {
            if (event.custom || event.target || event.handler) continue;
            if (!Array.isArray(event.value) || !event.value.length) continue;

            if (!scopeNames) scopeNames = this.getScopeNames(astNode);
            const compiled = compileEventBodyToJs(event.value, scopeNames);
            if (compiled === null) continue;

            const idx = output.compiledFnSources.push(`function($ctx, $cmp, $event) { ${compiled}; }`) - 1;
            event.compiledFn = `<%CFN:${idx}%>`;
            delete event.value;
        }
    }

    /**
     * Attaches a compiled fn alongside a filterModel's .once/.type/.suffix, deleting the now-redundant .prop. See catalogue [[jeli-cli]] "Compiled event-handler assignments".
     * @param {*} filterModel
     * @param {*} output
     */
    static attachCompiledFn(filterModel, output) {
        if (!this.componentResolver.compilerObject.buildOptions.compiledBindings) return;
        if (filterModel.fns && filterModel.fns.length) return;
        const compiled = compileValueToJs(filterModel.prop);
        if (compiled === null) return;
        const idx = output.compiledFnSources.push(`function($ctx, $cmp) { return ${compiled}; }`) - 1;
        filterModel.compiledFn = `<%CFN:${idx}%>`;
        delete filterModel.prop;
    }

    /**
     *
     * @param {*} attrName
     * @param {*} attrValue
     * @param {*} objType
     */
    static setAttributeBinder(attrName, attrValue, astNode, output, once = false) {
        if (interpolation.hasTemplateBinding(attrValue)) {
            return output.errorLogs.push(`templating not allowed in binding segment ${attrName}=${attrValue}`);
        }

        const props = helper.splitAndTrim(attrName.replace('attr-', ''), '.');
        const propName = props.shift();
        const filter = this.pipesProvider(attrValue, output);
        if (props.length) {
            filter.type = props.shift();
            filter.suffix = props.pop();
        }
        filter.once = once;
        if (helper.typeOf(filter.prop, 'string')) {
            filter.prop = this.expressionAst(filter.prop, output);
        }
        this.attachCompiledFn(filter, output);

        this.setObjectType(astNode, 'attr$', propName, filter);
    }

    /**
     * 
     * @param {*} node 
     * @param {*} value 
     * @param {*} astNode 
     * @param {*} output 
     * @returns 
     */
    static _parseOneWayBinding(node, value, astNode, output) {
        // set the component
        const extName = oneWayBinding.exec(node);
        if (!helper.isContain('attr-', extName[1])) {
            if (helper.isContain(extName[1].charAt(0), [':', '*']))
                return this.addDirectives(
                        extName[1], 
                        value, 
                        astNode,
                        output,
                        true
                );
            else if (astNode.isc)
                return this.setObjectType(
                    astNode, 
                    'props', 
                    extName[1], 
                    (value || extName[1]), 
                    true, 
                    true, 
                    output
                );
        }

        /**
         * attach attribute binder only if value is defined
         */
        if (value) {
            this.setAttributeBinder(extName[1], value, astNode, output);
        }
    }

    /**
     * 
     * @param {*} node 
     * @param {*} value 
     * @param {*} astNode 
     * @param {*} ignoreCompilation 
     * @param {*} output 
     * @returns 
     */
    static attributeParser(node, value, astNode, ignoreCompilation = false, output) {
        if (ignoreCompilation) return this.defaultAttrParser(node, value, astNode);;

        const symbol = node.charAt(0);
        const splitProp = node.split('-');
        if (helper.isContain(symbol, charMatchers)){
            switch (symbol) {
                // Directive Node
                case (':'):
                case ('*'):
                    if (value && value.match(interpolation.getDelimeter())) {
                        return output.errorLogs.push(
                            `[${node}] templating not allowed in directive binding.\n To add binding to a directive use the curly braces {${node}}`
                        );
                    }

                    this.addDirectives(node, value, astNode, output);
                    break;
                /**
                 * template Node refId
                 */
                case ('#'):
                    astNode.refId = node.substring(1, node.length);
                    break;
                /**
                 * Event Node
                 */
                case ('@'):
                    this._determineEventBinding(node, value, astNode, output);
                break;
                case ('{'):
                    this._parseOneWayBinding(node, value, astNode, output); 
                break;
            }
        } else if (helper.is('attr', splitProp[0])){
            this.setAttributeBinder(node, value, astNode, output, true);
        } else if (helper.isContain(splitProp[0], ['data', 'aria'])){
            this.setObjectType(astNode, splitProp.shift(), splitProp.join('-'), value || '');
        } else if (interpolation.hasTemplateBinding(value)){
            this.setObjectType(astNode, 'attr$', node, this.astTextParser(value, true, ignoreCompilation, output));
        } else {
            this.defaultAttrParser(node, value, astNode);
        }
    }

    /**
     * 
     * @param {*} astNode 
     * @param {*} prop 
     * @param {*} name 
     * @param {*} value 
     * @param {*} binding 
     * @param {*} parse 
     * @param {*} output 
     */
    static setObjectType(astNode, prop, name, value, binding, parse, output) {
        if (astNode.props && helper.is(astNode.props[name], '@!')) {
            prop = 'props';
        }

        /**
         * check if an observer was already registered
         * and the observer is not registered to attribute prop
         */
        if (astNode.attr$ && astNode.attr$.hasOwnProperty(name) && (prop != 'attr')) {
            // push styles into array if already registered
            if (name == 'style') {
                if (!Array.isArray(astNode.attr$[name])) {
                    value = [astNode.attr$[name], value];
                } else {
                    value = astNode.attr$[name].push(value);
                }
            } else {
                delete astNode.attr$[name];
            }
        }

        if (!astNode[prop]) astNode[prop] = {};

        if (parse) {
            value = this.pipesProvider(value, output);
            /**
             * Adding the props Observer instead of adding a checker
             */
            value.prop = this.expressionAst(value.prop, output);
            /**
             * compiledBindings: this is the second, independent producer
             * of the filterModel shape (component/directive property
             * bindings, e.g. `{prop}="expr"` on a custom element) - only
             * worth attaching when `binding` is true, since the
             * non-binding branch immediately collapses `value` down to
             * just `value.prop` right below, discarding anything else on
             * the object.
             */
            if (binding) this.attachCompiledFn(value, output);
            value = binding ? value : value.prop;
        }

        astNode[prop][name] = value;
    }

    /**
     * 
     * @param {*} astNode 
     * @param {*} name 
     * @param {*} item 
     */
    static setArrayType(astNode, name, item) {
        if (!astNode[name]) {
            astNode[name] = [];
        }
        astNode[name].push(item);
    }

    /**
     * 
     * @param {*} definition 
     * @param {*} element 
     * @param {*} attachProps 
     * @param {*} output 
     */
    static _attachProviders(definition, element, attachProps, output) {
        element.providers = element.providers || [];
        definition.forEach(def => {
            output.providers[`${def.fn}`] = def.obj.module;
            element.providers.push(`%${def.fn}%`);
            if (attachProps) {
                for (const prop in def.obj.props) {
                    if (!element.props.hasOwnProperty(def.obj.props[prop].value || prop)) {
                        this.setObjectType(element, 'props', prop, '@!');
                    }
                };
            }
        });
    }

    /**
     * 
     * @param {*} dir 
     * @param {*} restrictA 
     * @param {*} restrictB 
     */
    static checkDetachAbleElement(dir, restrictA, restrictB) {
        if (dir.indexOf(restrictA) > -1 && dir.indexOf(restrictB) > -1) {
            output.errorLogs.push(restrictA + ' directive cannot be used with ' + restrictB + ' directive');
        }
    }

    /**
     * 
     * @param {*} astNode 
     * @param {*} output 
     * @returns 
     */
    static _validateCustomElementAndThrowError(astNode, output) {
        if (helper.is(astNode.name, output.ctor.selector || '')) {
            output.errorLogs.push(`Element <${astNode.name}> cannot call itself, this will result to circular referencing`);
        }

        // check for cached elements
        const cached = resolvedElements[astNode.name];
        const definition = (cached ? cached.definition : this.componentResolver.getElement(astNode.name, output.componentClassName));
        if (!definition.length) {
            output.errorLogs.push(`Cannot find Element <${astNode.name}>, if this is a custom Element please register it`);
            return;
        }

        if (definition.length > 1) {
            output.errorLogs.push(`There are ${helper.colors.yellow(definition.length)} implentations found for element<${helper.colors.yellow(astNode.name)}> ${definition.map(def => helper.colors.yellow(def.obj.module + ':' + def.fn)).join(' | ')}, please resolve error and try again.`);
            return;
        }

        // validate the props
        const props = Object.keys(astNode.attr || {}).concat(Object.keys(astNode.props || {}));
        if (props.length) {
            props.forEach(prop => {
                if (prop.startsWith('_jeli-')) return;
                if (!helper.isContain(prop.split('-')[0], standardAttributes) && (!definition[0].obj.props ||
                    !isPropertyValueMap(prop, definition[0].obj.props) && !_isDirective(prop))) {
                    output.errorLogs.push(`Element <${helper.colors.yellow(astNode.name)}> does not support this property {${helper.colors.yellow(prop)}}`);
                }
            });
        }

        // attachProvider
        this._attachProviders(definition, astNode, null, output);
        // attach child query to astNode
        if (!cached) {
            resolvedElements[astNode.name] = {
                definition,
                query: {
                    child: (definition[0].obj.contentChildren || []).concat(definition[0].obj.contentChild || []),
                    place: definition[0].obj.place
                }
            };
        }

        /**
         * 
         * @param {*} prop 
         */
        function _isDirective(prop) {
            return (astNode.directives || []).some(dir => helper.is(dir.name, prop));
        }

        /**
         * 
         * @param {*} prop 
         * @param {*} obj 
         */
        function isPropertyValueMap(prop, obj) {
            if (obj.hasOwnProperty(prop)) {
                return true;
            }

            return Object.keys(obj).some(key => obj[key].value && obj[key].value === prop);
        }
    }

    static getEventType(el) {
        var type = "input";
        if (inarray(el.type, EventHandlerTypes.input)) {
            type = 'input';
        } else if (inarray(el.type, EventHandlerTypes.change)) {
            type = 'change';
        }

        return type;
    }

    static canSetValue(element) {
        isequal('input', EventHandler.getEventType(this.nativeElement));
    }


    /**
     * 
     * @param {*} astNode 
     * @param {*} elementName 
     * @param {*} parentAst 
     * @returns 
     */
    static checkAndBuildTemplateElement(astNode, elementName, parentAst, output) {
        return ({
            'j-template': () => this.templateCompiler(astNode, parentAst, output),
            'j-place': () => this.jPlaceCompiler(astNode, parentAst, output),
            'j-fragment': () => this.jFragmentParser(astNode, output)
        }[elementName] || (() => astNode))()
    }



    /**
     * attach viewChild attribute to the element
     * @param {*} astNode
     * @param {*} output
     */
    static attachViewChildToAst(astNode, output) {
        if (output.ctor.viewChild && output.ctor.viewChild.length) {
            const option = matchViewQueryFromAstNode(output.ctor.viewChild, astNode);
            if (!option) return;

            if (option.type !== ckeyWords.TEMPLATEREF)
                astNode.vc = [option, output.ctor.selector];
            else
                output.vt[option.name] = TEMPLATE_KEY(option.value || option.name);
        }
    }

    static checkTemplateCircularRef(isTemplate, refId, child) {
        if (isTemplate && refId) {
            if (child.name && child.attribs && child.attribs.hasOwnProperty('template') && child.attribs.template === refId) {
                child.isCircularRef = true;
            }

            if (child.children && child.children.length) {
                child.children.forEach(cchild => this.checkTemplateCircularRef(true, refId, cchild));
            }
        }
    }

    /**
     * 
     * @param {*} astNode 
     * @param {*} output
     */
    static buildStructuralDirectiveTemplates(astNode, output) {
        const dirName = astNode.structuralDirective.dirName;
        const newAstNode = this.createDefaultTemplate(astNode.structuralDirective, astNode, output);
        delete astNode.structuralDirective;
        if (dirName == 'if') {
            if (newAstNode.props) {
                for (var templateId in newAstNode.props) {
                    if (typeof newAstNode.props[templateId] !== 'object' && !newAstNode.templates[templateId]) {
                        newAstNode.templates[templateId] = TEMPLATE_KEY(newAstNode.props[templateId]);
                    }
                }
            }
        } else { }

        return newAstNode;
    }

    /**
     * create AbstractTemplate Object
     * @param {*} definition 
     */
    static createDefaultTemplate(definition, ast, output) {
        var astNode = {
            type: 8,
            name: "##",
            text: definition.dirName,
            templates: {}
        };

        if (definition.props) {
            astNode.props = definition.props;
        }

        /**
         * bind to templateFragments
         */
        astNode.templates[definition.dirName] = this.jFragmentParser(ast, output);
        this._attachProviders(definition.registeredDir, astNode, null, output);
        return astNode;
    }

    /**
     * 
     * @param {*} astNode 
     * @param {*} parentAst 
     * @param {*} output 
     * @returns 
     */
    static templateCompiler(astNode, parentAst, output) {
        // set element to singleNode if single child 
        const len = (astNode && astNode.children) ? astNode.children.length : 0;
        const refId = astNode.refId;
        const hasUseAttr = astNode.attr ? astNode.attr.use : null;
        if (hasUseAttr && len === 1) {
            output.errorLogs.push(`<j-template> element does not support child elements with 'use' attribute. <j-template #${refId} use="${astNode.attr.use}"/ >`);
            return null;
        }

        if (!len && !hasUseAttr) return null;

        if (len === 1) {
            astNode = astNode.children[0];
            if (typeof astNode == 'object' && !astNode.refId) {
                astNode.refId = refId;
            }
        } else if (hasUseAttr) {
            astNode = TEMPLATE_KEY(hasUseAttr);
        }

        if (parentAst && parentAst.name && parentAst.isc) {
            this.attachContentChildren(parentAst, hasUseAttr ? { refId: hasUseAttr, name: '#', children: [astNode] } : astNode, output);
        } else {
            output.templatesMapHolder[refId] = astNode;
        }

        return null;
    }

    /**
     * 
     * @param {*} astNode 
     * @param {*} parent
     * @param {*} output
     * @returns 
     */
    static jPlaceCompiler(astNode, parent, output) {
        if (parent?.isc) {
            output.errorLogs.push(`<${parent.name}><j-place></j-place></${parent.name}> usage not allowed, please look at documentation for more info`);
            return null;
        }

        // check for child content
        if (astNode.children) {
            output.errorLogs.push(`<j-place/> element does not support child elements`);
            return null;
        }

        if (astNode.refId && astNode.attr && astNode.attr.selector) {
            output.errorLogs.push(`<j-place/> element does not support [selector] and [#REFID], please use [selector="#REFID"] instead`);
            return null;
        }

        const attachPlaceToCtor = (key, value) => {
            if (!output.ctor.place) {
                output.ctor.place = {};
                if (pendingElements[output.ctor.selector]) {
                    resolvedElements[output.ctor.selector].query.place = output.ctor.place;
                }
            }

            output.ctor.place[key] = value;
            // attach query selector to astNode
            astNode.refId = key;
        };



        astNode.type = 11;
        if (astNode.attr) {
            if (astNode.attr.selector) {
                var firstChar = astNode.attr.selector.charAt(0);
                attachPlaceToCtor(astNode.attr.selector.replace(/[\[\].#]/g, ''), selectorTypes[firstChar] || 'name');
            } else if (astNode.attr.template || astNode.attr.refId) {
                attachPlaceToCtor(astNode.attr.template, '#');
            } else {
                // no [selector]/[template]/[#refId] given (e.g. bare
                // <j-place #foo fallback="..."> or <j-place fallback="...">) -
                // still register the default/named slot, same as the
                // no-attr branch below, so this place keeps receiving
                // projected content
                attachPlaceToCtor(astNode.refId || '@', astNode.refId ? '#' : '@');
            }

            // fallback references a local <j-template #refId> to render when
            // no content was projected for this place, resolved at runtime
            // via _GT (same mechanism as <j-fragment {template}="...">)
            if (astNode.attr.fallback) {
                astNode.fallback = astNode.attr.fallback;
                astNode._GT = TEMPLATE_KEY('GT');
            }

            // set the $ctx flag
            // $this refers to the child context instead of parent context
            astNode.$ctx = this.generateContext(astNode.attr);
            this.compileContextObject(astNode.$ctx, output);
            // remove the element
            delete astNode.attr;
        } else {
            attachPlaceToCtor(astNode.refId || '@', astNode.refId ? '#' : '@')
        }

        return astNode;
    }

    /**
     * 
     * @param {*} astNode
     * @param {*} output
     * @returns 
     */
    static jFragmentParser(astNode, output) {
        let templateId = (astNode.attr && astNode.attr['template']) || (astNode.attr$ && astNode.attr$['template']);
        if (astNode.children && astNode.children.length && templateId) {
            templateId = helper.typeOf(templateId, 'object') ? templateId.prop.join('.') : templateId;
            output.errorLogs.push(`<j-fragment template="${templateId}"/> does not support child elements and template linking.`);
            return;
        }

        if (templateId) {
            // it's possible to have a conditional template
            // we check for templateBinding and static reference
            if (astNode.attr) {
                let propsMapper = `|${output.templateOptionsMapper.length}`;
                const obj = {};
                if (astNode.props && astNode.providers) {
                    obj.props = astNode.props;
                    obj.providers = astNode.providers;
                }
                // generate context
                obj.ctx$ = this.generateContext(astNode.attr);
                this.compileContextObject(obj.ctx$, output);
                output.templateOptionsMapper.push(obj);
                return TEMPLATE_KEY(templateId + propsMapper);
            } else if (astNode.attr$) { // templateBinding found
                return ({
                    type: 13,
                    $templateId: templateId,
                    context: astNode.context,
                    _GT: TEMPLATE_KEY('GT')
                });
            }
        }

        return astNode;
    }

    static resolvePendingElements(selector){
        // check for unresolved Element childContent
        if (pendingElements[selector]) {
            if (resolvedElements[selector]) {
                const query = resolvedElements[selector].query;
                for (const n in pendingElements[selector]) {
                    while (pendingElements[selector][n][1].length) {
                        const ast = pendingElements[selector][n][1].shift();
                        this.attachContentChildPlace(pendingElements[selector][n][0], ast, query);
                    }
                }
            }

            // remove from pending elements
            delete pendingElements[selector];
        }
    }

    static cleanup(selector, fileChanges){
        if (resolvedElements[selector] && fileChanges) {
            delete resolvedElements[selector];
        }

    }
}

module.exports = BaseViewParser;