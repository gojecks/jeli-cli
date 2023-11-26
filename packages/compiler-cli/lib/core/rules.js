var rules = [
    {
        regExp: /url\((.*?)\)/,
        parser: () => {}
    }
];

exports.rewriteUrl = function(value, hostUrl) {
    return (value.includes('//') ? value : `${hostUrl}${value.startsWith('./') ? value.substring(2) : value}`);
}

/**
 * 
 * @param {*} content 
 * @param {*} baseHref 
 */
exports.rewriteBaseHref = function(content, baseHref){
    // rewrite rule for baseHref
    // if not defined set to default ./
    const baseHrefReg = /<base(.*?)>/;
    const baseHrefHtml = `<base href="${baseHref}">`;
    if (content.match(baseHrefReg)) {
        content = content.replace(baseHrefReg, baseHrefHtml);
    } else {
        content = content.replace(/<head>/, _ => `${_}\n\t${baseHrefHtml}`);
    }

    return content;
}

exports.rewriteSrcHref = function(content, hostUrl){
    return content.replace(/(href|src)=['"](.*?)['"]/g, (a, b, c) => {
        return `${b}="${exports.rewriteUrl(c, hostUrl)}"`;
    });
}

exports.rewriteBkgUrl = function(content, hostUrl) {
    return content.replace(/url\(['"](.*?)['"]\)/g, (a, b) => {
        return `url('${exports.rewriteUrl(b, hostUrl)}')`;
    });
}