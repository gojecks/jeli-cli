/**
 * html core parser
 */
const parser = require('html-dom-parser');
const { parseAst, parseAstJSON } = require('./ast.generator');
const interpolation = require('./interpolation');
const helper = require('@jeli/cli/lib/utils');
const { matchViewQueryFromAstNode } = require('./query_selector');
const restrictedCombination = ['j-template', 'j-place', 'case', 'default'];
const isFragmentElement = tagName => ["j-fragment", "j-template", "j-place", 'template'].includes(tagName);
const formInputs = ['select', 'input', 'textarea'];
const standardAttributes = 'id|class|style|title|dir|lang|aria';
const isComponent = tagName => helper.isContain('-', tagName) && !isFragmentElement(tagName);
const oneWayBinding = /\{(.*?)\}/;
const twoWayBinding = /\@\{(.*?)\}/;
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

/**
 * 
 * @param {*} htmlContent 
 * @param {*} ctor 
 * @param {*} resolvers 
 * @param {*} componentClassName 
 * @param {*} fileChanges 
 * @returns 
 */
module.exports = function (htmlContent, ctor, resolvers, componentClassName, fileChanges) {
    // removed resolved elements from cache if exists
    if (resolvedElements[ctor.selector] && fileChanges) {
        delete resolvedElements[ctor.selector];
    }

    const templatesMapHolder = {};
    const templateOptionsMapper = [];
    let pendingDependencies = false;
    const providers = {
        ViewParser: "@jeli/core"
    };
    const errorLogs = [];
    /**
     * parse ast node received
     * @param {*} item 
     * return astNode|null
     */
    function astParser(item) {
        if (helper.is(item.type, 'text') && item.data.trim()) {
            return astTextParser(item.data);
        } else if (helper.is(item.type, 'tag')) {
            return astElementParser.apply(null, arguments);
        }
        return null;
    }

    /**
     * parse ast receive and convert into jeli ast object
     * @param {*} ast 
     * @param {*} idx 
     * @param {*} parent 
     * @returns astNode|null
     */
    function astElementParser(ast, idx, parent) {
        var newAstNode = {
            type: 1,
            name: isFragmentElement(ast.name) ? "#" : ast.name,
            index: idx,
            // attach isComponent property
            isc: isComponent(ast.name)
        };

        // compile attributes
        if (ast.attribs) {
            for (const prop in ast.attribs) {
                attributeParser(prop, ast.attribs[prop], newAstNode);
            }

            // remove unmapped props
            removeUnmappedProps(newAstNode);
        }

        // throw Error when Element calls itsel
        if (newAstNode.isc) {
            _validateCustomElementAndThrowError(newAstNode);
        }

        attachViewChildToAst(newAstNode);
        compileChildren(ast, newAstNode);
        /**
         * extract component
         * get directives
         */
        if (newAstNode.structuralDirective) {
            /**
             * remove the directives prop
             */
            if (helper.is(ast.name, 'j-place')) {
                jPlaceCompiler(newAstNode, parent);
            }
            return buildStructuralDirectiveTemplates(newAstNode, parent);
        }

        return checkAndBuildTemplateElement(newAstNode, ast.name, parent);
    }


    /**
     * 
     * @param {*} astNode 
     * @param {*} elementName 
     * @param {*} parentAst 
     * @returns 
     */
    function checkAndBuildTemplateElement(astNode, elementName, parentAst) {
        switch (elementName) {
            case ('j-template'):
                return templateCompiler(astNode, parentAst);
            case ('j-place'):
                return jPlaceCompiler(astNode, parentAst);
            case ('j-fragment'):
                return jFragmentParser(astNode, elementName);
        }

        return astNode;
    }

    /**
     * 
     * @param {*} newItem 
     */
    function removeUnmappedProps(newItem) {
        if (newItem.props) {
            Object.keys(newItem.props).forEach(prop => {
                if (helper.is(newItem.props[prop], '@!')) {
                    delete newItem.props[prop];
                }
            });
        }
    }




    /**
     * attach conntentChildren to template
     * @param {*} parentAstNode 
     * @param {*} childAst 
     */
    function attachContentChildren(parentAstNode, childAst) {
        if(!resolvedElements[parentAstNode.name]) return;
        const query = resolvedElements[parentAstNode.name].query;
        const isStructural = helper.is(childAst.type, 8);
        const matched = matchViewQueryFromAstNode(query.child, isStructural ? childAst.templates[childAst.text] : childAst);
        if (matched) {
            if (isStructural) {
                errorLogs.push(`ContentChild(ren) query does not currently support structural directive "${childAst.text}" -> ${matched.name}=${matched.value}`);
                return;
            }

            // args to be pushed to contentChildren method
            const qlAstNode = [matched.type || 'TemplateRef', matched.ql];
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
                if (!pendingElements[parentAstNode.name][ctor.selector])
                    pendingElements[parentAstNode.name][ctor.selector] = [parentAstNode, []]
                // push the childlist
                pendingElements[parentAstNode.name][ctor.selector][1].push(childAst);
                pendingDependencies = true;
                return;
            }

            attachContentChildPlace(parentAstNode, childAst, query);
        }
    }

    /**
     * 
     * @param {*} parentAstNode 
     * @param {*} childAst 
     * @param {*} query 
     * @returns 
     */
    function attachContentChildPlace(parentAstNode, childAst, query) {
        if(!query || !query.place) return;
        const pushToPlace = id => {
            if (!parentAstNode.templates) {
                parentAstNode.templates = { place: {} };
            }

            if (!parentAstNode.templates.place[id]) {
                parentAstNode.templates.place[id] = []
            }

            // push all children if childAst is a fragment
            if (helper.is(childAst.name, '#') && childAst.children) {
                parentAstNode.templates.place[id].push.apply(parentAstNode.templates.place[id], childAst.children);
            } else {
                parentAstNode.templates.place[id].push(childAst);
            }
        };

        const refs = Object.keys(query.place);
        if (refs.length === 1 && refs[0] === '@') {
            pushToPlace('@');
        } else if (childAst.refId && query.place[childAst.refId]) {
            pushToPlace(childAst.refId);
        } else if (query.place[childAst.name]) {
            pushToPlace(childAst.name)
        } else if (childAst.attr) {
            // [id, class, attr]
            for (const ref in query.place) {
                const prop = (childAst.attr[query.place[ref]] || '').split(/\s/g);
                if ((childAst.attr.hasOwnProperty(ref) && query.place[ref] === 'attr') || (prop.includes(ref))) {
                    pushToPlace(ref);
                    return;
                }
            }
        }
    }

    /**
     * attach viewChild attribute to the element
     * @param {*} astNode 
     */
    function attachViewChildToAst(astNode) {
        if (ctor.viewChild && ctor.viewChild.length) {
            const option = matchViewQueryFromAstNode(ctor.viewChild, astNode);
            if (option) {
                astNode.vc = [option, ctor.selector];
            }
        }
    }

    function checkTemplateCircularRef(isTemplate, refId, child) {
        if (isTemplate && refId) {
            if (child.name && child.attribs && child.attribs.hasOwnProperty('template') && child.attribs.template === refId) {
                child.isCircularRef = true;
            }

            if (child.children && child.children.length) {
                child.children.forEach(cchild => checkTemplateCircularRef(true, refId, cchild));
            }
        }
    }

    /**
     * compile template children
     * @param {*} astNode
     * @param {*} compiledAstNode 
     */
    function compileChildren(astNode, compiledAstNode) {
        if (astNode.children && astNode.children.length) {
            compiledAstNode.children = [];
            astNode.children
                .forEach((child, idx) => {
                    if (!(child.name || (child.data && child.data.trim()))) return;
                    var childAstNode = astParser(child, idx, compiledAstNode);
                    if (childAstNode) {
                        if (compiledAstNode.isc) {
                            attachContentChildren(compiledAstNode, childAstNode);
                        } else {
                            compiledAstNode.children.push(childAstNode);
                        }
                    }
                });

        }
    }

    /**
     * 
     * @param {*} astNode 
     * @param {*} parent 
     */
    function buildStructuralDirectiveTemplates(astNode) {
        const definition = astNode.structuralDirective;
        delete astNode.structuralDirective;
        switch (definition.dirName) {
            case ('if'):
                return jIfCompiler(definition, astNode);
            default:
                return createDefaultTemplate(definition, astNode);
        }
    }

    /**
     * conditional template generator
     * @param {*} definition
     * @param {*} astNode
     */
    function jIfCompiler(definition, astNode) {
        const newAstNode = createDefaultTemplate(definition, astNode);
        if (newAstNode.props) {
            for (var templateId in newAstNode.props) {
                if (typeof newAstNode.props[templateId] !== 'object' && !newAstNode.templates[templateId]) {
                    newAstNode.templates[templateId] = TEMPLATE_KEY(newAstNode.props[templateId]);
                }
            }
        }

        return newAstNode;
    }

    /**
     * create AbstractTemplate Object
     * @param {*} definition 
     */
    function createDefaultTemplate(definition, ast) {
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
        astNode.templates[definition.dirName] = jFragmentParser(ast);
        _attachProviders(definition.registeredDir, astNode);
        return astNode;
    }

    /**
     * 
     * @param {*} astNode 
     * @param {*} parentAst 
     * @returns 
     */
    function templateCompiler(astNode, parentAst) {
        // set element to singleNode if single child 
        const len = (astNode && astNode.children) ? astNode.children.length : 0;
        const refId = astNode.refId;
        const hasUseAttr = astNode.attr && astNode.attr.use;
        if (hasUseAttr && len === 1) {
            errorLogs.push(`<j-template> element does not support child elements with 'use' attribute. <j-template #${refId} use="${astNode.attr.use}"/ >`);
            return null;
        }

        if (len === 1) {
            astNode = astNode.children[0];
            if (typeof astNode == 'object') {
                astNode.refId = refId;
            }
        } else if (hasUseAttr) {
            astNode = TEMPLATE_KEY(hasUseAttr);
        } else if (!len) {
            return null;
        }

        //  if (outletElement.context) {
        //     generateOutletContext(outletElement);
        // }

        if (parentAst && parentAst.name && parentAst.isc) {
            attachContentChildren(parentAst, hasUseAttr ? { refId: hasUseAttr, name: '#', children: [astNode] } : astNode);
        } else {
            templatesMapHolder[refId] = astNode;
        }

        return null;
    }

    /**
     * 
     * @param {*} astNode 
     * @param {*} parent 
     * @returns 
     */
    function jPlaceCompiler(astNode, parent) {
        if (parent.isc) {
            errorLogs.push(`<${parent.name}><j-place></j-place></${parent.name}> usage not allowed, please look at documentation for more info`);
            return null;
        }

        // check for child content
        if (astNode.children) {
            errorLogs.push(`<j-place/> element does not support child elements`);
            return null;
        }

        if (astNode.refId && astNode.attr && astNode.attr.selector) {
            errorLogs.push(`<j-place/> element does not support [selector] and [#REFID], please use [selector="#REFID"] instead`);
            return null;
        }

        const attachPlaceToCtor = (key, value) => {
            if (!ctor.place) {
                ctor.place = {};
                if (pendingElements[ctor.selector]) {
                    resolvedElements[ctor.selector].query.place = ctor.place;
                }
            }
            ctor.place[key] = value;
            // attach query selector to astNode
            astNode.refId = key;
        };

        astNode.type = 11;
        if (astNode.attr) {
            if (astNode.attr.selector) {
                var firstChar = astNode.attr.selector.charAt(0);
                attachPlaceToCtor(astNode.attr.selector.replace(/[\[\].#]/g, ''), selectorTypes[firstChar] || 'name');
            } else if (astNode.attr.template) {
                attachPlaceToCtor(astNode.attr.template, '#');
            }

            // remove the element
            delete astNode.attr;
        } else {
            attachPlaceToCtor('@', '@')
        }

        return astNode;
    }

    /**
     * 
     * @param {*} astNode 
     * @returns 
     */
    function jFragmentParser(astNode) {
        let templateId = (astNode.attr && astNode.attr['template']) || (astNode.attr$ && astNode.attr$['template']);
        if (astNode.children && astNode.children.length && templateId) {
            templateId = helper.typeOf(templateId, 'object') ? templateId.prop.join('.') : templateId;
            errorLogs.push(`<j-fragment template="${templateId}"/> does not support child elements and template linking.`);
            return;
        }

        if (templateId) {
            // it's possible to have a conditional template
            // we check for templateBinding and static reference
            if (astNode.attr) {
                let propsMapper = `|${templateOptionsMapper.length}`;
                const obj = {};
                if (astNode.props && astNode.providers) {
                    obj.props =  astNode.props;
                    obj.providers = astNode.providers;
                }
                // generate context
                obj.ctx$ = generateContext(astNode.attr);
                templateOptionsMapper.push(obj);
                return TEMPLATE_KEY(templateId + propsMapper);
            } else if (astNode.attr$) { // templateBinding found
                return {
                    type: 13,
                    $templateId: templateId,
                    context: astNode.context,
                    _GT: TEMPLATE_KEY('GT')
                }
            }
        }

        return astNode;
    }

    /**
     * 
     * @param {*} astAttr 
     */
    function generateContext(astAttr) {
        if(astAttr.context) {
            if (astAttr.context === '*') {
                return astAttr.data || null;
            } else if (/\{(.*)\}/.test(astAttr.context)) {
                return parseAstJSON(`(${astAttr.context})`).expr;
            } 
        }
    }

    /**
     * 
     * @param {*} filter 
     * @param {*} filterModel 
     */
    function pipesProvider(filter, filterModel) {
        let pipeName = filter;
        const separatorIndex = filter.indexOf(':');
        if (separatorIndex > -1) {
            pipeName = filter.substr(0, separatorIndex);
            filterModel.args.push(filter.substr(separatorIndex + 1, filter.length).split(';').map(expressionAst));
        }
        /**
         * Push the resolved filter to the model
         * @param {*} deps 
         */
        const _pushFilters = (deps) => {
            filterModel.fns.push(`%${deps.fn}%`);
            providers[`${deps.fn}`] = deps.module;
        };

        if (!resolvedFilters.hasOwnProperty(pipeName)) {
            const deps = resolvers.getPipe(pipeName);
            if (deps) {
                resolvedFilters[pipeName] = deps;
                _pushFilters(deps);
            } else {
                errorLogs.push(`Unable to resolve pipe <${helper.colors.yellow(pipeName)}>. Please include pipe and recompile application.`)
            }
        } else {
            _pushFilters(resolvedFilters[pipeName]);
        }
    }

    /**
     * 
     * @param {*} data 
     * @param {*} isAttr 
     */
    function astTextParser(data, isAttr) {
        const ast = interpolation.parser(data, pipesProvider);
        if (ast.length > 1) {
            /**
             * pasrse ast
             */
            ast[1].forEach(item => item[1].prop = expressionAst(item[1].prop))
        }
        return isAttr ? ast : {
            type: 3,
            ast
        };
    }

    /**
     * 
     * @param {*} expression
     */
    function expressionAst(expression) {
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
            errorLogs.push(helper.colors.white(`${e.message} -> ${expression}`))
        }

        return ast;
    }


    /**
     * 
     * @param {*} dir 
     * @param {*} restrictA 
     * @param {*} restrictB 
     */
    function checkDetachAbleElement(dir, restrictA, restrictB) {
        if (dir.indexOf(restrictA) > -1 && dir.indexOf(restrictB) > -1) {
            errorLogs.push(restrictA + ' directive cannot be used with ' + restrictB + ' directive');
        }
    }

    /**
     * 
     * @param {*} node 
     * @param {*} value 
     * @param {*} astNode 
     */
    function attributeParser(node, value, astNode) {
        var firstCharMatcher = node.charAt(0);
        if (helper.isContain(firstCharMatcher, charMatchers)) {
            parseFirstCharMatcher(firstCharMatcher, node, value);
        } else if (helper.isContain('attr-', node)) {
            setAttributeBinder(node, value, true);
        }
        /**
         * remove DataMatchers
         */
        else if (helper.isContain('data-', node)) {
            var propName = helper.camelCase(node.replace('data-', ''));
            setObjectType(astNode, 'data', propName, value || propName);
        } else if (interpolation.hasTemplateBinding(value)) {
            setObjectType(astNode, 'attr$', node, astTextParser(value, true));
        } else {
            setObjectType(astNode, 'attr', node, helper.simpleArgumentParser(value));
        }

        /**
         * 
         * @param {*} attrName 
         * @param {*} attrValue 
         * @param {*} objType 
         */
        function setAttributeBinder(attrName, attrValue, once = false) {
            if (interpolation.hasTemplateBinding(attrValue)) {
                return errorLogs.push(`templating not allowed in binding segment ${attrName}=${attrValue}`);
            }

            const props = helper.splitAndTrim(attrName.replace('attr-', ''), '.');
            const propName = props.shift();
            const filter = interpolation.removeFilters(attrValue, pipesProvider);
            if (props.length) {
                filter.type = props.shift();
                filter.suffix = props.pop();
            }
            filter.once = once;
            if (helper.typeOf(filter.prop, 'string')) {
                filter.prop = expressionAst(filter.prop);
            }
            setObjectType(astNode, 'attr$', propName, filter);
        }


        /**
         * 
         * @param {*} name 
         * @param {*} value 
         * @param {*} fChar 
         * @param {*} hasBinding 
         */
        function addDirectives(name, value, fChar, hasBinding = false) {
            var isDetachedElem = helper.is(fChar, '*');
            name = name.substr(1, name.length);
            const dirName = name;
            // mock props for querySelector
            const props = {
                name: astNode.name,
                attr: Object.assign({}, astNode.attr)
            };
            props.attr[dirName] = true;
            const registeredDir = resolvers.getDirectives(dirName, props, componentClassName);
            if (!registeredDir.length) {
                errorLogs.push(`Element <${astNode.name}> does not support this attribute [${dirName}]. if [${dirName}] is a customAttribute please create and register it.`);
                return;
            }

            if (isDetachedElem) {
                parseStructuralDirective(dirName, value, astNode, registeredDir);
            } else {
                setObjectType(astNode, 'props', dirName, value, hasBinding, hasBinding);
                _attachProviders(registeredDir, astNode, true);
            }
        }

        /**
         * 
         * @param {*} fChar 
         * @param {*} node 
         * @param {*} value 
         */
        function parseFirstCharMatcher(fChar, node, value) {
            switch (fChar) {
                /**
                 * Directive Node
                 */
                case (':'):
                case ('*'):
                    if (value && value.match(interpolation.getDelimeter())) {
                        errorLogs.push(
                            `[${node}] templating not allowed in directive binding.\n To add binding to a directive use the curly braces {${node}}`
                        );
                    }

                    addDirectives(node, value, fChar);
                    break;
                /**
                 * template Node
                 */
                case ('#'):
                    astNode.refId = node.substring(1, node.length);
                    break;
                /**
                 * Event Node
                 */
                case ('@'):
                    if (twoWayBinding.test(node)) {
                        _pasrseTwoWayBinding(node);
                    } else {
                        _parseEventBinding(node);
                    }
                    break;
                case ('{'):
                    _parseOneWayBinding(node);
                    break;
            }
        }

        /**
         * @{:model}="twoWayBinding"
         * @param {*} binding 
         */
        function _pasrseTwoWayBinding(binding) {
            let prop = binding.match(twoWayBinding)[1];
            if (helper.isContain(':', prop.charAt(0))) {
                addDirectives(prop, value, ':', true);
                prop = prop.substr(1, prop.length);
            }
            setArrayType(astNode, 'events', {
                name: `${prop}Change`,
                value: parseAst(`${value}=$event`),
                custom: true
            });
        }

        /**
         * Event Binding
         * e.g @click="listener()" 
         * @onCustomEvent="someCustomListener"
         * @click-delegate:elementName
         * @param {*} dir 
         */
        function _parseEventBinding(dir) {
            try {
                dir = dir.split(/[@:]/g).splice(1);
                const delegateOrNorm = dir.shift().split('-');
                const item = {
                    name: delegateOrNorm.shift(),
                    value: parseAst(value)
                };

                if (dir.length && delegateOrNorm.length) {
                    item.target = dir.pop().split(',');
                }

                // set the item
                setArrayType(astNode, 'events', item);
            } catch (e) {
                errorLogs.push(helper.colors.white(`${e.message} -> ${value}`));
            }
        }

        /**
         * parseOneWayBinding
         */
        function _parseOneWayBinding(dir) {
            /**
             * set the component
             */
            var extName = oneWayBinding.exec(dir);
            if (!helper.isContain('attr-', extName[1])) {
                if (helper.isContain(extName[1].charAt(0), [':', '*']))
                    return addDirectives(extName[1], value, extName[1].charAt(0), true);
                else if (astNode.isc)
                    return setObjectType(astNode, 'props', extName[1], value || extName[1], true, true);
            }

            /**
             * attach attribute binder only if value is defined
             */
            if (value) {
                setAttributeBinder(extName[1], value);
            }
        }
    }

    /**
     * 
     * @param {*} dirName 
     * @param {*} value 
     * @param {*} astNode 
     * @param {*} registeredDir 
     */
    function parseStructuralDirective(dirName, value, astNode, registeredDir) {
        /**
         * validate the structuralElement
         * make sure no combination of two structural elements
         */
        var invalidIdx = restrictedCombination.indexOf(dirName);
        if (invalidIdx > -1) {
            errorLogs.push(`${dirName} cannot be used with ${restrictedCombination[invalidIdx]}`);
            return;
        }

        if (astNode.structuralDirective) {
            errorLogs.push(`${astNode.structuralDirective.dirName} directive cannot be used with ${dirName} directive`);
            return;
        }

        let props = null;
        helper.splitAndTrim(value, ';').forEach(_parseProps);
        astNode.structuralDirective = {
            registeredDir,
            dirName,
            props
        };

        function _parseProps(key, idx) {
            if (idx && helper.isContain('=', key)) {
                const propSplt = helper.splitAndTrim(key, "=");
                astNode.context = astNode.context || {};
                astNode.context[propSplt[0]] = expressionAst(propSplt[1]);
            } else if (idx && helper.isContain(' as ', key)) {
                const propSplt = helper.splitAndTrim(key, ' as ');
                props = (props || {});
                props[helper.camelCase(`${dirName}-${propSplt[0]}`)] = expressionAst(propSplt[1]);
            } else {
                const ast = interpolation.removeFilters(key, pipesProvider);
                props = (props || {});
                if (helper.typeOf(ast.prop, 'string')) {
                    astStringParser(ast, props);
                } else {
                    props[dirName] = ast;
                }
            }
        }

        /**
         * concat syntax to form a variable
         * e.g for in value = forIn
         * @param {*} ast 
         * @param {*} props 
         */
        function astStringParser(ast, props) {
            const regExp = /\s+\w+\s/;
            if (regExp.test(ast.prop)) {
                const matched = ast.prop.match(regExp);
                const checkerSplt = helper.splitAndTrim(ast.prop, matched[0]);
                ast.prop = expressionAst(checkerSplt[1]);
                props[helper.camelCase(`${dirName}-${matched[0].trim()}`)] = ast;
                astNode.context = astNode.context || {};
                astNode.context[checkerSplt[0]] = '$context';
            } else {
                ast.prop = expressionAst(ast.prop);
                props[dirName] = ast;
            }
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
     */
    function setObjectType(astNode, prop, name, value, binding, parse) {
        if (astNode.props && helper.is(astNode.props[name], '@!')) {
            prop = 'props';
        }

        /**
         * check if an observer was already registered
         * and the observer is not registered to attribute prop
         */
        if (astNode.attr$ && astNode.attr$.hasOwnProperty(name) && !helper.is(prop, 'attr')) {
            value = astNode.attr$[name];
            delete astNode.attr$[name];
        }

        if (!astNode[prop]) {
            astNode[prop] = {};
        }

        if (parse) {
            value = interpolation.removeFilters(value, pipesProvider);
            /**
             * Adding the props Observer instead of adding a checker
             */
            value.prop = expressionAst(value.prop);
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
    function setArrayType(astNode, name, item) {
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
     */
    function _attachProviders(definition, element, attachProps) {
        element.providers = element.providers || [];
        definition.forEach(def => {
            providers[`${def.fn}`] = def.obj.module;
            element.providers.push(`%${def.fn}%`);
            if (attachProps) {
                for (const prop in def.obj.props) {
                    if (!element.props.hasOwnProperty(def.obj.props[prop].value || prop)) {
                        setObjectType(element, 'props', prop, '@!');
                    }
                };
            }
        });
    }

    /**
     * 
     * @param {*} elementAstNode 
     */
    function _validateCustomElementAndThrowError(elementAstNode) {
        if (helper.isContain(elementAstNode.name, ctor.selector || '')) {
            errorLogs.push(`Element <${elementAstNode.name}> cannot call itself, this will result to circular referencing`);
        }

        // check for cached elements
        const cached = resolvedElements[elementAstNode.name];
        const definition = (cached ? cached.definition : resolvers.getElement(elementAstNode.name, componentClassName));
        if (!definition.length) {
            errorLogs.push(`Cannot find Element <${elementAstNode.name}>, if this is a custom Element please register it`);
            return;
        }

        // validate the props
        const props = Object.keys(elementAstNode.attr || {}).concat(Object.keys(elementAstNode.props || {}));
        if (props.length) {
            props.forEach(prop => {
                if (!helper.isContain(prop.split('-')[0], standardAttributes) && (!definition[0].obj.props ||
                    !isPropertyValueMap(prop, definition[0].obj.props) && !_isDirective(prop))) {
                    errorLogs.push(`Element <${helper.colors.yellow(elementAstNode.name)}> does not support this property {${helper.colors.yellow(prop)}}`);
                }
            });
        }

        // attachProvider
        _attachProviders(definition, elementAstNode);
        // attach child query to elementAstNode
        if (!cached) {
            resolvedElements[elementAstNode.name] = {
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
            return (elementAstNode.directives || []).some(dir => helper.is(dir.name, prop));
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

    EventHandlerTypes = {
        change: ['checkbox', 'radio', 'select-one', 'select-multiple', 'select'],
        input: ['text', 'password', 'textarea', 'email', 'url', 'week', 'time', 'search', 'tel', 'range', 'number', 'month', 'datetime-local', 'date', 'color']
    };

    function getEventType(el) {
        var type = "input";
        if (inarray(el.type, EventHandlerTypes.input)) {
            type = 'input';
        } else if (inarray(el.type, EventHandlerTypes.change)) {
            type = 'change';
        }

        return type;
    }

    function canSetValue(element) {
        isequal('input', EventHandler.getEventType(this.nativeElement));
    }



    var parsedContent = parser(htmlContent, {
        normalizeWhitespace: true,
        lowerCaseAttributeNames: false,
        decodeEntities: true
    }).map(astParser).filter(element => element);

    // check for unresolved Element childContent
    if (pendingElements[ctor.selector]) {
        const query = resolvedElements[ctor.selector].query;
        for (const n in pendingElements[ctor.selector]) {
            while (pendingElements[ctor.selector][n][1].length) {
                const ast = pendingElements[ctor.selector][n][1].shift();
                console.log(componentClassName)
                attachContentChildPlace(pendingElements[ctor.selector][n][0], ast, query);
            }
        }
        // remove from pending elements
        delete pendingElements[ctor.selector];
    }

    return {
        errorLogs,
        parsedContent,
        templateOptionsMapper,
        templatesMapHolder,
        providers,
        pendingDependencies
    };
}