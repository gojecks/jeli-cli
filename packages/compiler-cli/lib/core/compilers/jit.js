
module.exports = (parsedHtml) => {
    /**
     * compiledBindings: swaps every quoted `<%CFN:N%>` marker (however it
     * got into this JSON text - directly, or nested inside a
     * `templateOptionsMapper` entry that gets its own separate
     * JSON.stringify call below) for the real, raw compiled function
     * source stashed on `parsedHtml.compiledFnSources[N]`. Pulled out as
     * its own pass because `String.prototype.replace` only scans the
     * *original* string once - a marker introduced into the *replacement*
     * text of `replaceTemplateMappers`'s own regex callback (exactly what
     * happens for `templateOptionsMapper`, see below) would never get a
     * matching pass of its own otherwise, leaking a literal `"<%CFN:N%>"`
     * string into the compiled output.
     * @param {*} jsonText
     */
    function substituteCompiledFnMarkers(jsonText) {
        return jsonText.replace(/"<%CFN:(\d+)%>"/g, (_, idx) => parsedHtml.compiledFnSources[Number(idx)]);
    }

    /**
     *
     * @param {*} template
     * @param {*} attachWrapper
     * @returns
     */
    function replaceTemplateMappers(template, attachWrapper) {
        return substituteCompiledFnMarkers(JSON.stringify(template)).replace(new RegExp(`"<%(.*?)%>"`, 'g'), (_, expr) => {
            if (expr.startsWith('compiler')) return expr;
            if (expr === 'GT') return `_GT`;
            const templateExpr = expr.split('|');
            const tmpscript = `_GT('${templateExpr[0]}', ${templateExpr[1] ? substituteCompiledFnMarkers(JSON.stringify(parsedHtml.templateOptionsMapper[templateExpr[1]])) : null})`;
            return `${attachWrapper ? '() => '+ tmpscript : tmpscript}`;
        });
    }

    return `(viewRef) => { 'use strict'; var _GT = (id, mtl) => core.ViewParser.$(${replaceTemplateMappers(parsedHtml.templatesMapHolder, true)}[id], mtl); return core.ViewParser.jit(viewRef, ${replaceTemplateMappers(parsedHtml.parsedContent)}, ${replaceTemplateMappers(parsedHtml.vt)}); };`;
}