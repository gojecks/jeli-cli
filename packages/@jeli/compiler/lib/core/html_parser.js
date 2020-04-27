 /**
  * html core parser
  */
 const parser = require('html-dom-parser');
 const { parseAst } = require('./ast.generator');
 const interpolation = require('./interpolation');
 const helper = require('@jeli/cli-utils');
 const restrictedCombination = ['j-template', 'j-place', 'case', 'default'];
 const formInputs = ['select', 'input', 'textarea'];
 const standardAttributes = 'id|class|style|title|dir|lang';
 const isComponent = tagName => helper.isContain('-', tagName);
 const hasDirectives = (item, dirName) => item.directives && item.directives.some(d => d.name === dirName);
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
     const providers = {};
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
         if (newItem.directives) {
             var allTransplaceable = newItem.directives.filter(item => item.transplace);
             if (allTransplaceable.length) {
                 var invalidIdx = restrictedCombination.indexOf(item.name);
                 if (invalidIdx > -1) {
                     errorLogs.push(allTransplaceable[0].name + ' cannot be used with ' + restrictedCombination[invalidIdx]);
                 }

                 if (allTransplaceable.length > 1) {
                     errorLogs.push(allTransplaceable[0].name + ' directive cannot be used with ' + allTransplaceable[1].name + ' directive');
                 }
             }

             if (allTransplaceable.length) {
                 newItem.directives.splice(0, 1);
                 /**
                  * remove the directives prop
                  */
                 if (!newItem.directives.length) {
                     delete newItem.directives;
                 }
                 return buildTransplaceAbleTemplates(allTransplaceable, newItem, parent);
             }
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
                     } else if (helper.is(item.name, option.value) || (option.isdir && hasDirectives(item, option.value))) {
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

         /**
          * 
          * @param {*} child 
          * @param {*} formControl 
          */
         function attachFormControl(children, formControl) {
             children.forEach(child => {
                 if (child.type == 'tag') {
                     if (formInputs.includes(child.name)) {
                         child.attribs = child.attribs || {};
                         child.attribs['jx-reflect-control-name'] = formControl;
                     } else if (child.children) {
                         attachFormControl(child.children, formControl);
                     }
                 }
             });
         }
     }

     /**
      * 
      * @param {*} directive 
      * @param {*} compiledItem 
      * @param {*} parent 
      */
     function buildTransplaceAbleTemplates(directive, compiledItem, parent) {
         delete directive[0].transplace;
         switch (directive[0].name) {
             case ('outlet'):
                 return outletCompiler(directive[0].props.outlet.prop, compiledItem.context);
             case ('if'):
                 return jIfCompiler();
             default:
                 return createDefaultTemplate(directive[0].name);
         }

         /**
          * Default Template
          */
         function createDefaultTemplate(name) {
             var item = {
                 type: "element",
                 name: "#comment",
                 text: name,
                 directives: directive,
                 templates: {}
             };

             if (directive[0].props) {
                 item.props = directive[0].props;
                 delete directive[0].props;
             }

             item.templates[name] = compiledItem;
             return item;
         }

         /**
          * jIf template compiler
          */
         function jIfCompiler() {
             const item = createDefaultTemplate(directive[0].name);
             if (item.props) {
                 for (var templateId in item.props) {
                     if (typeof item.props[templateId] !== 'object') {
                         item.templates[templateId] = ({
                             refId: item.props[templateId]
                         });
                         templateCompiler(item.templates[templateId], {});
                     }
                 }
             }

             return item;
         }
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


     /**
      * 
      * @param {*} data 
      */
     function createTextNode(data) {
         return {
             type: 'text',
             ast: interpolation.parser(data)
         };
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
         } else if (helper.isContain('jx-reflect-', node)) {
             setObjectType('attr', node.replace('jx-reflect-', '.'), value);
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
                 setObjectType('attr', helper.camelCase(node), helper.simpleArgumentParser(value));
             }
         }

         /**
          * 
          * @param {*} attrName 
          * @param {*} attrValue 
          * @param {*} objType 
          */
         function setAttributeBinder(attrName, attrValue, once) {
             const props = helper.splitAndTrim(attrName.replace('attr-', ''), '.');
             const propName = props.shift();
             const filter = interpolation.removeFilters(attrValue);
             if (props.length) {
                 filter.type = props.shift();
                 filter.suffix = props.pop();
             }
             filter.once = once;

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
             elementRefInstance.directives = elementRefInstance.directives || [];
             name = name.substr(1, name.length);
             let dir = {
                 name: helper.camelCase(name)
             };

             if (isDetachedElem) {
                 parseDetachDirective();
             } else {
                 const ast = interpolation.removeFilters(value);
                 /**
                  * Adding the props Observer instead of adding a checker
                  */
                 if (hasBinding) {
                     setObjectType('props', dir.name, helper.simpleArgumentParser(ast.prop || dir.name));
                 } else {
                     attachChecker(ast);
                 }
             }

             setObjectType('attr', dir.name, null);
             const registeredDir = resolvers.getDirectives(dir.name, elementRefInstance, component);
             if (!registeredDir.length) {
                 errorLogs.push(`Element <${elementRefInstance.name}> does not support this attribute [${dir.name}]. if [${dir.name}] is a customAttribute please create and register it.`);
             } else {
                 // register to providers
                 dir.providers = registeredDir.map(def => (providers[`'${def.fn}'`] = def.fn, def.fn));
             }

             elementRefInstance.directives[isDetachedElem ? 'unshift' : 'push'](dir);

             function attachChecker(ast) {
                 if (ast.fns) {
                     dir.checker = ast;
                 } else {
                     dir.checker = helper.simpleArgumentParser(ast.prop);
                 }
             }

             /**
              * 
              * @param {*} key 
              * @param {*} props 
              */
             function parseDetachDirective() {
                 let props = null;
                 helper.splitAndTrim(value, ';').forEach(key => {
                     if (key) {
                         _parseProps(key);
                     }
                 });
                 if (props) {
                     dir.props = props;
                 }

                 dir.transplace = isDetachedElem;

                 function _parseProps(key) {
                     if (helper.isContain('=', key)) {
                         const propSplt = helper.splitAndTrim(key, "=");
                         elementRefInstance.context = elementRefInstance.context || {};
                         elementRefInstance.context[helper.camelCase(propSplt[0])] = helper.simpleArgumentParser(propSplt[1]);
                     } else if (helper.isContain(' as ', key)) {
                         const propSplt = helper.splitAndTrim(key, ' as ');
                         props = (props || {});
                         props[helper.camelCase(`${name}-${propSplt[0]}`)] = helper.simpleArgumentParser(propSplt[1]);
                     } else {
                         const ast = interpolation.removeFilters(key);
                         props = (props || {});
                         const regExp = /\s+\w+\s/;
                         if (typeof ast.prop === 'string' && regExp.test(ast.prop)) {
                             const matched = ast.prop.match(regExp);
                             const checkerSplt = helper.splitAndTrim(ast.prop, matched[0]);
                             ast.prop = helper.simpleArgumentParser(checkerSplt[1]);
                             props[helper.camelCase(`${name}-${matched[0].trim()}`)] = ast.fns ? ast : ast.prop;
                             elementRefInstance.context = elementRefInstance.context || {};
                             elementRefInstance.context[checkerSplt[0]] = '$context';
                         } else {
                             props[dir.name] = ast;
                         }
                     }
                 }
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
                             `[${node}] templating not allowed in directive binding.\n To add binding to a directive use the curly braces {${node}}`);
                     }

                     addDirectives(node, value, fChar);
                     break;
                     /**
                      * template Node
                      */
                 case ('#'):
                     elementRefInstance.refId = helper.camelCase(node.substring(1, node.length));
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
             } else {

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
                 name: dir.replace(/[@-]/g, ''),
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
         function _parseOneWayBinding(dir, ) {
             /**
              * set the component
              */
             var extName = oneWayBinding.exec(dir);
             var name = helper.camelCase(extName[1]);
             const isAttrType = helper.isContain('attr-', extName[1]);
             if (!isAttrType && helper.isContain(name.charAt(0), [':', '*'])) {
                 addDirectives(name, value, name.charAt(0), true);
             } else if (elementRefInstance.isc && !isAttrType) {
                 setObjectType('props', name, value);
             } else {
                 setAttributeBinder(extName[1], value);
             }
         }
     }

     /**
      * 
      * @param {*} element 
      */
     function _validateCustomElementAndThrowError(element) {
         if (helper.isContain(element.name, componentDefinition.selector)) {
             errorLogs.push(`Element <${element.name}> cannot call itself, this will result to circular referencing`);
         }

         const definition = resolvers.getElement(element.name, component)[0];
         if (!definition) {
             errorLogs.push(`Cannot find Element <${element.name}>, if this is a custom Element please register it`);
             return;
         }

         // validate the props
         if (element.attr) {
             Object.keys(element.attr).forEach(prop => {
                 if (!helper.isContain(prop, standardAttributes) &&
                     (!definition.obj.props || !definition.obj.props.hasOwnProperty(prop)) &&
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
         providers[`'${element.name}'`] = definition.fn;

         /**
          * 
          * @param {*} prop 
          */
         function _isDirective(prop) {
             return (element.directives || []).some(dir => helper.is(dir.name, prop));
         }
     }


     var parsedContent = parser(htmlContent, {
         normalizeWhitespace: true
     }).map(contentParser).filter(content => content);

     return {
         errorLogs,
         parsedContent,
         templatesMapHolder,
         providers
     };
 }