 /**
  * html core parser
  */
 const parser = require('html-dom-parser');
 const { parseAst, parseAstJSON } = require('./ast.generator');
 const interpolation = require('./interpolation');
 const helper = require('@jeli/cli-utils');
 const restrictedCombination = ['j-template', 'j-place', 'case', 'default'];
 const formInputs = ['select', 'input', 'textarea'];
 const standardAttributes = 'id|class|style|title|dir|lang';
 const isComponent = tagName => helper.isContain('-', tagName);
 const oneWayBinding = /\{(.*?)\}/;
 const twoWayBinding = /\@\{(.*?)\}/;
 const selectorTypes = {
     '.': 'class',
     '#': 'id',
     '[': 'attr'
 };
 const resolvedFilters = {};

 module.exports = function(htmlContent, viewChild, selector, resolvers, component) {
     const templatesMapHolder = {};
     const templateOutletHolder = {};
     const providers = {
         ViewParser: "@jeli/core"
     };
     const errorLogs = [];

     /**
      * 
      * @param {*} item 
      * @param {*} parent 
      */
     function contentParser(item, parent) {
         if (helper.is(item.type, 'text') && item.data.trim()) {
             return createTextNode(item.data);
         } else if (helper.is(item.type, 'tag')) {
             return parseElement.apply(null, arguments);
         } else {
             return null;
         }
     }

     /**
      * 
      * @param {*} item 
      * @param {*} parent 
      */
     function parseElement(item, idx, parent) {
         var newItem = {
             type: "element",
             name: item.name,
             index: idx
         };

         if (["j-fragment", "j-template", "j-place"].includes(item.name)) {
             newItem.name = "#fragment";
         }

         /**
          * attach isComponent property
          */
         newItem.isc = isComponent(newItem.name);
         /**
          * compile attributes
          */
         if (item.attribs) {
             Object.keys(item.attribs).forEach(node => attributeParser(node, item.attribs[node], newItem));
             /**
              * remove unmapped props
              */
             if (newItem.props) {
                 Object.keys(newItem.props).forEach(prop => {
                     if (helper.is(newItem.props[prop], '@!')) {
                         delete newItem.props[prop];
                     }
                 });
             }
         }

         /**
          * throw Error when Element calls itself
          */
         if (newItem.isc) {
             _validateCustomElementAndThrowError(newItem);
         }

         compileViewChild(newItem);
         compileChildren(item, newItem);
         /**
          * extract component
          * get directives
          */
         if (newItem.structuralDirective) {
             /**
              * remove the directives prop
              */
             return buildStructuralDirectiveTemplates(newItem, parent);
         }

         switch (item.name) {
             case ('j-template'):
                 return templateCompiler(newItem, parent);
             case ('j-place'):
                 newItem.type = 'place';
                 if (newItem.attr && newItem.attr.selector) {
                     var firstChar = newItem.attr.selector.charAt(0);
                     var selector = selectorTypes[firstChar] || null;
                     newItem.selector = [selector, newItem.attr.selector.replace(/[\[\].#]/g, '')];
                     delete newItem.attr;
                 }
                 break;
         }

         return newItem;
     }

     function compileViewChild(item) {
         if (viewChild && viewChild.length) {
             const option = viewChild.find(view => {
                 const castedValue = view.value.replace(/\'/g, '');
                 return (helper.is(item.refId, castedValue)) || (helper.is(item.name, castedValue) || (view.isdir && item.directives && item.directives.hasOwnProperty(castedValue)));
             });

             if (option) {
                 item.vc = [option, selector];
             }
         }
     }

     /**
      * 
      * @param {*} item 
      * @param {*} parent 
      * @param {*} parentIdx 
      */
     function compileChildren(item, parent) {
         if (item.children && item.children.length) {
             const formControl = parent.props && parent.props['formControl'];
             if (formControl) {
                 // attachFormControl(item.children, formControl);
             }
             /**
              * build FormControl
              */
             parent.children = [];
             item.children
                 .filter(child => (child.name || child.data && child.data.trim()))
                 .forEach((child, idx) => {
                     var content = contentParser(child, idx, parent);
                     if (content) {
                         if (parent.isc) {
                             parent.templates = parent.templates || {
                                 place: []
                             };
                             parent.templates.place.push(content);
                         } else {
                             parent.children.push(content);
                         }
                     }
                 });

         }
     }

     /**
      * 
      * @param {*} compiledItem 
      * @param {*} parent 
      */
     function buildStructuralDirectiveTemplates(compiledItem, parent) {
         const definition = compiledItem.structuralDirective;
         delete compiledItem.structuralDirective;
         switch (definition.dirName) {
             case ('outlet'):
                 return outletCompiler(definition.props.outlet.prop, compiledItem.context);
             case ('if'):
                 return jIfCompiler(definition, compiledItem);
             default:
                 return createDefaultTemplate(definition, compiledItem);
         }
     }

     /**
      * conditional template generator
      * @param {*} definition 
      */
     function jIfCompiler(definition, compiledItem) {
         const item = createDefaultTemplate(definition, compiledItem);
         if (item.props) {
             for (var templateId in item.props) {
                 if (typeof item.props[templateId] !== 'object' && !item.templates[templateId]) {
                     item.templates[templateId] = ({
                         refId: item.props[templateId]
                     });
                     templateCompiler(item.templates[templateId], null);
                 }
             }
         }

         return item;
     }

     /**
      * create AbstractTemplate Object
      * @param {*} definition 
      */
     function createDefaultTemplate(definition, compiledItem) {
         var item = {
             type: "comment",
             name: "#comment",
             text: definition.dirName,
             templates: {}
         };

         if (definition.props) {
             item.props = definition.props;
         }

         item.templates[definition.dirName] = compiledItem;
         _attachProviders(definition.registeredDir, item);
         return item;
     }

     /**
      * 
      * @param {*} item 
      * @param {*} parent 
      */
     function templateCompiler(item, parent) {
         if (parent && parent.name && parent.isc) {
             /**
              * attach template
              */
             parent.templates = parent.templates || {};
             parent.templates[item.refId] = item;
         } else if (templateOutletHolder[item.refId]) {
             templateOutletHolder[item.refId].template = item;
             if (templateOutletHolder[item.refId].context) {
                 generateOutletContext(templateOutletHolder[item.refId]);
             }
             delete templateOutletHolder[item.refId];
         } else if (templatesMapHolder[item.refId]) {
             Object.assign((parent ? templatesMapHolder[item.refId] : item), (parent ? item : templatesMapHolder[item.refId]));
             delete templatesMapHolder[item.refId];
         } else {
             templatesMapHolder[item.refId] = item;
         }

         return null;
     }


     /**
      * contextMapping for outlet
      * @param {*} templateId 
      * @param {*} context 
      */
     function outletCompiler(templateId, context) {
         var outlet = {
             type: 'outlet'
         };
         if (templateId) {
             if (templatesMapHolder[templateId]) {
                 outlet = templatesMapHolder[templateId];
                 generateOutletContext(outlet);
                 delete templatesMapHolder[templateId];
             } else {
                 templateOutletHolder[templateId] = outlet;
                 if (context) {
                     outlet.context = context;
                 }
             }
         }

         return outlet;
     }

     /**
      * 
      * @param {*} outlet 
      * @param {*} contextMap 
      */
     function generateOutletContext(outlet) {
         if (outlet.context && outlet.template.data) {
             if (outlet.context === '*') {
                 outlet.context = outlet.template.data;
             } else {
                 if (/\{(.*)\}/.test(outlet.context.context)) {
                     const parsed = helper.espree.parse(`(${outlet.context.context})`);
                     const context = helper.generateProperties(parsed.body[0].expression.properties);
                     outlet.context = Object.keys(context)
                         .reduce((accum, propName) => {
                             accum[propName] = outlet.template.data[context[propName]] || context[propName];
                             return accum;
                         }, context);
                 }
             }

             delete outlet.template.data;
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

         if (!resolvedFilters.hasOwnProperty(pipeName)) {
             const deps = resolvers.getPipe(pipeName);
             if (deps) {
                 resolvedFilters[pipeName] = deps;
                 filterModel.fns.push(`%${deps.fn}%`);
                 providers[`${deps.fn}`] = deps.module;
             } else {
                 errorLogs.push(`Unable to resolve pipe <${helper.colors.yellow(pipeName)}>. Please include pipe and recompile application.`)
             }
         } else {
             filterModel.fns.push(`%${resolvedFilters[pipeName].fn}%`);
             providers[`${resolvedFilters[pipeName].fn}`] = resolvedFilters[pipeName].module;
         }
     }

     /**
      * 
      * @param {*} data 
      * @param {*} isAttr 
      */
     function createTextNode(data, isAttr) {
         const ast = interpolation.parser(data, pipesProvider);
         if (ast.templates) {
             /**
              * pasrse ast
              */
             ast.templates.forEach(item => item[1].prop = expressionAst(item[1].prop))
         }
         return isAttr ? ast : {
             type: 'text',
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
             if (helper.is('{', expression.charAt(0)))
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
      * @param {*} elementRefInstance 
      */
     function attributeParser(node, value, elementRefInstance) {
         var firstCharMatcher = node.charAt(0);
         if (helper.isContain(firstCharMatcher, [':', '*', '#', '@', '{', '('])) {
             parseFirstCharMatcher(firstCharMatcher, node, value);
         } else if (helper.isContain('attr-', node)) {
             setAttributeBinder(node, value, true);
         }
         /**
          * remove DataMatchers
          */
         else if (helper.isContain('data-', node)) {
             var propName = helper.camelCase(node.replace('data-', ''));
             setObjectType(elementRefInstance, 'data', propName, value || propName);
         } else if (interpolation.hasTemplateBinding(value)) {
             setObjectType(elementRefInstance, 'attrObservers', node, createTextNode(value, true));
         } else {
             setObjectType(elementRefInstance, 'attr', node, helper.simpleArgumentParser(value));
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
             setObjectType(elementRefInstance, 'attrObservers', propName, filter);
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
             /**
              * mock props for querySelector
              */
             const props = {
                 name: elementRefInstance.name,
                 attr: Object.assign({}, elementRefInstance.attr)
             };
             props.attr[dirName] = true;
             const registeredDir = resolvers.getDirectives(dirName, props, component);
             if (!registeredDir.length) {
                 errorLogs.push(`Element <${elementRefInstance.name}> does not support this attribute [${dirName}]. if [${dirName}] is a customAttribute please create and register it.`);
                 return;
             }
             if (isDetachedElem) {
                 parseStructuralDirective(dirName, value, elementRefInstance, registeredDir);
             } else {
                 setObjectType(elementRefInstance, 'props', dirName, value, hasBinding, hasBinding);
                 _attachProviders(registeredDir, elementRefInstance, true);
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
                     elementRefInstance.refId = node.substring(1, node.length);
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
             setArrayType(elementRefInstance, 'events', {
                 name: `${prop}Change`,
                 value: parseAst(`${value}=$event`),
                 custom: true
             });
         }

         /**
          * Event Binding
          * e.g @click="listener()" @on-custom-event="someCustomListener"
          * @param {*} dir 
          */
         function _parseEventBinding(dir) {
             try {
                 const item = {
                     name: dir.replace(/[@]/g, ''),
                     value: parseAst(value)
                 };

                 if (helper.isContain('-', dir)) {
                     item.custom = true;
                 }

                 // set the item
                 setArrayType(elementRefInstance, 'events', item);
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
                 else if (elementRefInstance.isc)
                     return setObjectType(elementRefInstance, 'props', extName[1], value || extName[1], true, true);
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
      * @param {*} elementRefInstance 
      * @param {*} registeredDir 
      */
     function parseStructuralDirective(dirName, value, elementRefInstance, registeredDir) {
         /**
          * validate the structuralElement
          * make sure no combination of two structural elements
          */
         var invalidIdx = restrictedCombination.indexOf(dirName);
         if (invalidIdx > -1) {
             errorLogs.push(`${dirName} cannot be used with ${restrictedCombination[invalidIdx]}`);
             return;
         }

         if (elementRefInstance.structuralDirective) {
             errorLogs.push(`${elementRefInstance.structuralDirective.dirName} directive cannot be used with ${dirName} directive`);
             return;
         }

         let props = null;
         helper.splitAndTrim(value, ';').forEach(_parseProps);
         elementRefInstance.structuralDirective = {
             registeredDir,
             dirName,
             props
         };

         function _parseProps(key, idx) {
             if (idx && helper.isContain('=', key)) {
                 const propSplt = helper.splitAndTrim(key, "=");
                 elementRefInstance.context = elementRefInstance.context || {};
                 elementRefInstance.context[propSplt[0]] = expressionAst(propSplt[1]);
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
                 elementRefInstance.context = elementRefInstance.context || {};
                 elementRefInstance.context[checkerSplt[0]] = '$context';
             } else {
                 ast.prop = expressionAst(ast.prop);
                 props[dirName] = ast;
             }
         }
     }

     /**
      * 
      * @param {*} elementRefInstance 
      * @param {*} prop 
      * @param {*} name 
      * @param {*} value 
      * @param {*} binding 
      * @param {*} parse 
      */
     function setObjectType(elementRefInstance, prop, name, value, binding, parse) {
         if (elementRefInstance.props && helper.is(elementRefInstance.props[name], '@!')) {
             prop = 'props';
         }

         /**
          * check if an observer was already registered
          * and the observer is not registered to attribute prop
          */
         if (elementRefInstance.attrObservers && elementRefInstance.attrObservers.hasOwnProperty(name) && !helper.is(prop, 'attr')) {
             value = elementRefInstance.attrObservers[name];
             delete elementRefInstance.attrObservers[name];
         }

         if (!elementRefInstance[prop]) {
             elementRefInstance[prop] = {};
         }

         if (parse) {
             value = interpolation.removeFilters(value, pipesProvider);
             /**
              * Adding the props Observer instead of adding a checker
              */
             value.prop = expressionAst(value.prop);
             value = binding ? value : value.prop;
         }
         elementRefInstance[prop][name] = value;
     }

     /**
      * 
      * @param {*} name 
      * @param {*} item 
      */
     function setArrayType(elementRefInstance, name, item) {
         if (!elementRefInstance[name]) {
             elementRefInstance[name] = [];
         }
         elementRefInstance[name].push(item);
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
      * @param {*} element 
      */
     function _validateCustomElementAndThrowError(element) {
         if (helper.isContain(element.name, selector)) {
             errorLogs.push(`Element <${element.name}> cannot call itself, this will result to circular referencing`);
         }

         const definition = resolvers.getElement(element.name, component);
         if (!definition.length) {
             errorLogs.push(`Cannot find Element <${element.name}>, if this is a custom Element please register it`);
             return;
         }

         // validate the props
         const props = Object.keys(element.attr || {}).concat(Object.keys(element.props || {}));
         if (props.length) {
             props.forEach(prop => {
                 if (!helper.isContain(prop, standardAttributes) && (!definition[0].obj.props ||
                         !isPropertyValueMap(prop, definition[0].obj.props) && !_isDirective(prop))) {
                     errorLogs.push(`Element <${helper.colors.yellow(element.name)}> does not support this property {${helper.colors.yellow(prop)}}`);
                 }
             });
         }

         /**
          * 
          * attachProvider
          */
         _attachProviders(definition, element);
         /**
          * 
          * @param {*} prop 
          */
         function _isDirective(prop) {
             return (element.directives || []).some(dir => helper.is(dir.name, prop));
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
     }).map(contentParser).filter(content => content);

     return {
         errorLogs,
         parsedContent,
         templatesMapHolder,
         providers
     };
 }