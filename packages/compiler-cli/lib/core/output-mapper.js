const hasCode = function(code) {
    var hash = 0, i, chr, len;
    if (!code || code.length === 0) return hash;
    for (i = 0, len = code.length; i < len; i++) {
        chr = code.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }

    return hash;
};

let indexes = new Map();
let inc = 1000;
let templateCacheIndex = {};
exports.getIndex =  name => indexes.get(name);
exports.setIndex = name => {
    if (Array.isArray(name)){
        name.forEach(n => {
            if (!indexes.has(n)){
                indexes.set(n, inc++);
            }
        });
    } else if(!indexes.has(name)){
        indexes.set(name, inc++);
    }
}

exports.getTemplateIndex = (key, readOnly=false) => {
    if(!templateCacheIndex[key] && !readOnly){
        templateCacheIndex[key] = hasCode(key); 
    }

    return templateCacheIndex[key];
}
