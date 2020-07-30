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
 const symbol = "ϕ";

 /**
  * 
  * @param {*} htmlContent 
  * @param {*} componentDefinition 
  * @param {*} resolvers 
  * @param {*} component 
  */
 module.exports = function(htmlContent, componentDefinition, resolvers, component) {
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
                     var selector = firstChar === '.' ? 'class' : firstChar === '#' ? 'id' : null;
                     newItem.selector = [selector, selector ? newItem.attr.selector.split(/[#.]/)[1] : newItem.attr.selector];
                     delete newItem.attr;
                 }
                 break;
         }

         return newItem;
     }

     function compileViewChild(item) {
         if (componentDefinition && componentDefinition.viewChild) {
             let prop = null;
             Object.keys(componentDefinition.viewChild)
                 .forEach(name => {
                     const option = componentDefinition.viewChild[name];
                     if (helper.is(item.refId, option.value)) {
                         prop = name;
                     } else if (helper.is(item.name, option.value) || (option.isdir && item.directives && item.directives.hasOwnProperty(option.value))) {
                         prop = name;
                     }
                 });

             if (prop) {
                 item.vc = {
                     prop,
                     parent: componentDefinition.selector
                 }
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
                     templateCompiler(item.templates[templateId], {});
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
         if (parent.name && parent.isc) {
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
             Object.assign(templatesMapHolder[item.refId], item);
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

     function pipesProvider(pipeName, filterModel) {
         if (!providers.hasOwnProperty(pipeName)) {
             const deps = resolvers.getPipe(pipeName);
             if (deps) {
                 filterModel.push(`%${deps.fn}%`);
                 providers[`${deps.fn}`] = deps.module;
             } else {
                 errorLogs.push(`Unable to resolve pipe ${pipeName}. Please include pipe and recompile application.`)
             }
         }
     }

     /**
      * 
      * @param {*} data 
      */
     function createTextNode(data) {
         const ast = interpolation.parser(data, pipesProvider);
         if (ast.templates) {
             /**
              * pasrse ast
              */
             ast.templates.forEach(item => item[1].prop = expressionAst(item[1].prop))
         }

         return {
             type: 'text',
             ast
         };
     }

     /**
      * 
      * @param {*} expression
      */
     function expressionAst(expression) {
         const regex = /[&&||]/;
         if (helper.is('{', expression.charAt(0)))
             return parseAstJSON(expression, true);
         else if (helper.is('[', expression.charAt(0)) && /\[(.*)\]/.test(expression))
             return {
                 type: "raw",
                 value: parseAst(expression)[0]
             }
         else if (regex.test(expression))
             return helper.splitAndTrim(expression, regex).map(key => {
                 return parseAst(key)[0];
             });
         else
             return parseAst(expression)[0];
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
             setObjectType('data', propName, value || propName);
         } else {
             var hasValueBinding = interpolation.getTemplateKeys(value);
             if (hasValueBinding.exprs.length) {
                 setArrayType('attrObservers', {
                     name: node,
                     ast: interpolation.parser(hasValueBinding)
                 });
             } else {
                 setObjectType('attr', node, helper.simpleArgumentParser(value));
             }
         }

         /**
          * 
          * @param {*} attrName 
          * @param {*} attrValue 
          * @param {*} objType 
          */
         function setAttributeBinder(attrName, attrValue, once = false) {
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
             setObjectType('attrObservers', propName, filter);
         }

         /**
          * 
          * @param {*} prop 
          * @param {*} name 
          * @param {*} value 
          */
         function setObjectType(prop, name, value) {
             if (!elementRefInstance[prop]) {
                 elementRefInstance[prop] = {};
             }
             elementRefInstance[prop][name] = value;
         }

         /**
          * 
          * @param {*} name 
          * @param {*} item 
          */
         function setArrayType(name, item) {
             if (!elementRefInstance[name]) {
                 elementRefInstance[name] = [];
             }
             elementRefInstance[name].push(item);
         }

         /**
          * 
          * @param {*} name 
          * @param {*} value 
          * @param {*} fChar 
          * @param {*} hasBinding 
          */
         function addDirectives(name, value, fChar, hasBinding) {
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
                 const ast = interpolation.removeFilters(value, pipesProvider);
                 /**
                  * Adding the props Observer instead of adding a checker
                  */
                 ast.prop = expressionAst(ast.prop);
                 setObjectType('props', dirName, hasBinding ? ast : ast.prop);
                 _attachProviders(registeredDir, elementRefInstance);
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
             setArrayType('events', {
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
             const item = {
                 name: dir.replace(/[@]/g, ''),
                 value: parseAst(value)
             };

             if (helper.isContain('-', dir)) {
                 item.custom = true;
             }

             // set the item
             setArrayType('events', item);
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
                     return setObjectType('props', extName[1], value);
             }

             setAttributeBinder(extName[1], value);
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

         function _parseProps(key) {
             if (helper.isContain('=', key)) {
                 const propSplt = helper.splitAndTrim(key, "=");
                 elementRefInstance.context = elementRefInstance.context || {};
                 elementRefInstance.context[propSplt[0]] = expressionAst(propSplt[1]);
             } else if (helper.isContain(' as ', key)) {
                 const propSplt = helper.splitAndTrim(key, ' as ');
                 props = (props || {});
                 props[helper.camelCase(`${dirName}-${propSplt[0]}`)] = expressionAst(propSplt[1]);
             } else {
                 const ast = interpolation.removeFilters(key, pipesProvider);
                 props = (props || {});
                 if (typeof ast.prop === 'string') {
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
      * @param {*} providers 
      * @param {*} element 
      */
     function _attachProviders(definition, element) {
         element.providers = element.providers || [];
         definition.forEach(def => {
             providers[`${def.fn}`] = def.obj.module;
             element.providers.push(`%${def.fn}%`);
         });
     }

     /**
      * 
      * @param {*} element 
      */
     function _validateCustomElementAndThrowError(element) {
         if (helper.isContain(element.name, componentDefinition.selector)) {
             errorLogs.push(`Element <${element.name}> cannot call itself, this will result to circular referencing`);
         }

         const definition = resolvers.getElement(element.name, component);
         if (!definition.length) {
             errorLogs.push(`Cannot find Element <${element.name}>, if this is a custom Element please register it`);
             return;
         }

         // validate the props
         if (element.attr) {
             Object.keys(element.attr).forEach(prop => {
                 if (!helper.isContain(prop, standardAttributes) &&
                     (!definition[0].obj.props || !definition[0].obj.props.hasOwnProperty(prop)) &&
                     !_isDirective(prop)
                 ) {
                     errorLogs.push(`Element <${element.name}> does not support this property [${prop}]`);
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