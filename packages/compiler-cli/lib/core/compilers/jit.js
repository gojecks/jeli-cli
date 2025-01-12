
module.exports = (parsedHtml) => {
    /**
     * 
     * @param {*} template 
     * @param {*} attachWrapper 
     * @returns 
     */
    function replaceTemplateMappers(template, attachWrapper) {
        return JSON.stringify(template).replace(new RegExp(`"<%(.*?)%>"`, 'g'), (_, expr) => {
            if (expr.startsWith('compiler')) return expr;
            if (expr === 'GT') return `_GT`;
            const templateExpr = expr.split('|');
            const tmpscript = `_GT('${templateExpr[0]}', ${templateExpr[1] ? JSON.stringify(parsedHtml.templateOptionsMapper[templateExpr[1]]) : null})`;
            return `${attachWrapper ? '() => '+ tmpscript : tmpscript}`;
        });
    }

    return `(viewRef) => { 'use strict'; var _GT = (id, mtl) => core.ViewParser.compiler.$(${replaceTemplateMappers(parsedHtml.templatesMapHolder, true)}[id], mtl); return core.ViewParser.compiler.jit(viewRef, ${replaceTemplateMappers(parsedHtml.parsedContent)}, ${replaceTemplateMappers(parsedHtml.vt)}); };`;
}