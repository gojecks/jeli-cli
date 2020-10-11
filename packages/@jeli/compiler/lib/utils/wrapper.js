module.exports = {
    UMD: "(function (global, factory) {\n (typeof define === 'function' && define.amd) ? define(<%=moduleName%>,[<%=importsAMD%>], factory) : (typeof exports === 'object' && module !== 'undefined') ? factory(exports<%=importsCJS%>): (global = global || self, factory((<%=globalName%> = <%=globalName%> || {}<%=globalNameSpace%>)<%=globalArgs%>)); \n\
}(this, function (exports<%=args%>) {\n\
'use strict'; \n\
<%=scriptBody%> \n\
<%=footer%> \n\
Object.defineProperty(exports, '__esModule', {value: true}); \n\
}));",
    MODULE: "<%=header%> \n <%=scriptBody%> \n <%=footer%>",
    DEFAULT: "!function(factory, __required){\n'use strict'; \n /** trigged factory **/\nfactory(__required);\n}(function(__required){\n<%=deps%>\n<%=scriptBody%>\n}, (function(__JELI__DEPENDENCY__HUB__, __resolved__){ 'use strict';\nreturn function __required(deps, property){\n  if(__resolved__[deps]) return getProp();\n/** create a new ref **/__resolved__[deps] = {exports:true};\n__JELI__DEPENDENCY__HUB__[deps](__resolved__[deps], __resolved__[deps], __required); return getProp();\n function getProp(){ return property ? __resolved__[deps][property]: __resolved__[deps]; }\n};\n})(/** JELI DEPENDECY HUB **/<%=modules%>, {}));",
    CSS: '(function(){ "use strict"; var head = document.getElementsByTagName("head")[0]; [<%=styles%>].forEach(writeCssToDOM); function writeCssToDOM(css){ var element = document.createElement("style"); element.setAttribute("type", "text/css"); element.appendChild(document.createTextNode(css)); head.appendChild(element); }})();'
};