class Rules {
    static _RULES = [
        {
            regExp: /url\((.*?)\)/,
            parser: () => {}
        }
    ];

    static rewriteUrl(value, hostUrl) {
        return (value.includes('//') ? value : `${hostUrl}${value.startsWith('./') ? value.substring(2) : value}`);
    }

    /**
     * 
     * @param {*} content 
     * @param {*} baseHref 
     */
    static rewriteBaseHref(content, baseHref){
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

    static rewriteSrcHref = function(content, hostUrl){
        return content.replace(/(href|src)=['"](.*?)['"]/g, (a, b, c) => `${b}="${this.rewriteUrl(c, hostUrl)}"`);
    }

    static rewriteBkgUrl = function(content, hostUrl) {
        return content.replace(/url\((['"])(.*?)\1\)/g, (match, quote, value) => {
            const rewritten = this.rewriteUrl(value, hostUrl);
            const outQuote = rewritten.includes("'") ? '"' : "'";
            return `url(${outQuote}${rewritten}${outQuote})`;
        });
    }
}

module.exports = Rules;
