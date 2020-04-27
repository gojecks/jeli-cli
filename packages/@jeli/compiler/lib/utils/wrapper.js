module.exports = {
    UMD: "(function (global, factory) {\n (typeof define === 'function' && define.amd) ? define(<%=moduleName%>,[<%=importsAMD%>], factory) : (typeof exports === 'object' && module !== 'undefined') ? factory(exports<%=importsCJS%>): (global = global || self, factory((<%=globalName%> = <%=globalName%> || {}<%=globalNameSpace%>)<%=globalArgs%>)); \n\
}(this, function (exports<%=args%>) {\n\
'use strict'; \n\
<%=scriptBody%> \n\
<%=footer%> \n\
Object.defineProperty(exports, '__esModule', {value: true}); \n\
}));",
    MODULE: "<%=header%> \n <%=scriptBody%> \n <%=footer%>",
    DEFAULT: "!function(){\n'use strict';\n<%=scriptBody%>\n}();"
};