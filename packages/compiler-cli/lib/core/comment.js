'use strict';

exports.stripBanner = function(src, options) {
    if (!options) { options = {}; }
    var m = [];
    if (options.line) {
        // Strip // ... leading banners.
        m.push('(?:.*\\/\\/.*\\n)*\\s*');
    }
    if (options.block) {
        // Strips all /* ... */ block comment banners.
        m.push('\\/\\*[\\s\\S]*?\\*\\/');
    } else {
        // Strips only /* ... */ block comment banners, excluding /*! ... */.
        m.push('\\/\\*[^!][\\s\\S]*?\\*\\/');
    }
    var re = new RegExp('^\\s*(?:' + m.join('|') + ')\\s*', '');
    return src.replace(re, '');
};