 /**
     * 
     * @param {*} t 
     * @param {*} prop 
     * @returns 
     */
 function tmplToScript(t, viewRef, childVar) {
    var s = ``;
    if (t) {
        var templates = null;
        var children = null;
        if (t.templates) {
            templates = constructTemplate(t.templates);
        }

        if (t.children) {
            children = `function(parentRef){${constructContents(t.children, 'parentRef')}.forEach(function(child,i){if(child){parentRef.children.add(child, i); parentRef.nativeElement.appendChild(child.nativeElement || child.nativeNode); } });}`;
        }

        if (t.type === 3) {
            s += `core["ViewParser"].builder.text(${JSON.stringify(t.ast || null)}, ${viewRef})`;
        } else {
            const definitions = ['name', 'text', 'index', 'vc', 'isc', 'attr', 'props', 'providers'].reduce((accum, key) => { if (t.hasOwnProperty(key)) { accum[key] = t[key]; } return accum; }, {});
            s += `core["ViewParser"].builder.${t.type}(${JSON.stringify(definitions)}, ${viewRef}, ${children}, ${templates})`;
        }
    }

    return `${s}`;
}

/**
 * 
 * @param {*} templates 
 * @returns 
 */
function constructTemplate(templates) {
    var ret = [];
    for (const tprop in templates) {
        const tid = `${tprop}_tmpl`;
        ret.push(`${tprop}: function(){ return ${tmplToScript(templates[tprop], tid)}}`);
    }
    return `{${ret.join(',')}}`;
}

/**
 * 
 * @param {*} templates 
 */
function constructContents(templates, viewRef) {
    const contents = templates.map((child, idx) => {
        return tmplToScript(child, viewRef, `${viewRef}_child_${idx}`);
    });

    return `[${contents.join(',')}]`;
}

module.exports = function(parsedHtml){
    return `var $tmpl=${constructTemplate(parsedHtml.templatesMapHolder)}; ${constructContents(parsedHtml.parsedContent, 'viewRef')};`;
}