
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
            if (expr === 'GT') return `compiler._GT`;
            const templateExpr = expr.split('|');
            const tmpscript = `compiler._GT('${templateExpr[0]}', ${templateExpr[1] ? JSON.stringify(parsedHtml.templateOptionsMapper[templateExpr[1]]) : null})`;
            return `${attachWrapper ? 'function(){ return ' + tmpscript + ';}' : tmpscript}`;
        });
    }

    return `function(){ 'use strict'; var compiler = new core["ViewParser"].JSONCompiler( (id) => (${replaceTemplateMappers(parsedHtml.templatesMapHolder, true)}[id]) );  return function(viewRef){ return compiler.compile(${replaceTemplateMappers(parsedHtml.parsedContent)}, viewRef);}}()`;
}