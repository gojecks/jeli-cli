module.exports = {
    UMD: "(function (global, factory) {\n (typeof define === 'function' && define.amd) ? define(<%=moduleName%>,[<%=importsAMD%>], factory) : (typeof exports === 'object' && module !== 'undefined') ? factory(exports<%=importsCJS%>): (global = global || self, factory((<%=globalName%> = <%=globalName%> || {}<%=globalNameSpace%>)<%=globalArgs%>)); \n\
}(this, function (exports<%=args%>) {\n\
'use strict'; \n\
<%=scriptBody%> \n\
<%=footer%> \n\
Object.defineProperty(exports, '__esModule', {value: true}); \n\
}));",
    MODULE: "<%=header%> \n <%=scriptBody%> \n <%=footer%>",
    DEFAULT: "!function(factory){\n'use strict';\nvar /** JELI DEPENDECY HUB **/__JELI__DEPENDENCY__HUB__ = <%=modules%>; var __resolved__ = {}; \nfunction __required(deps){  if(__resolved__[deps]){ return __resolved__[deps]; } /** create a new ref **/ __resolved__[deps] = {}; __JELI__DEPENDENCY__HUB__[deps](__resolved__[deps]); return __resolved__[deps];};\n /** trigged factory **/\nfactory(__required);\n}(function(__required){\n<%=deps%>\n<%=scriptBody%>\n});",
    CSS: '(function(){ "use strict"; var head = document.getElementsByTagName("head")[0]; [<%=cssFileHolder%>].forEach(writeCssToDOM); function writeCssToDOM(css){ var element = document.createElement("style"); element.setAttribute("type", "text/css"); element.appendChild(document.createTextNode(css)); head.appendChild(element); }})();'
};