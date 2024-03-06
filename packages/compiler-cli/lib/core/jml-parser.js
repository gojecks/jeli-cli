module.exports = function(markupLanguage){
    var tokens = markupLanguage.split(/(@[\w]+\[.*?\])/g);
    var currentElem = null;
    var manyNested = [];
    var astNodes = [];
    for (var i = 0; i < tokens.length; i++) {
        var item = tokens[i].trim();
        if (!item || '({'.includes(item)) continue;
        if (item.startsWith('@')) {
            var match = item.match(/@(\w*)+\[(.*?)\]/);
            // check for badElement and skip if found
            if (badElements.includes(match[1])) continue;
            currentElem = [match[1].toLowerCase(), match[2], []];
            // push to astNodes
            if (!manyNested.length) {
                astNodes.push(currentElem);
            }
            // push element to children if manyNested have a element
            if (manyNested.length) {
                manyNested[manyNested.length - 1][2].push(currentElem)
            }
            if (tokens[i + 1].trim().startsWith('{')) {
                manyNested.push(currentElem)
            }

        } else {
            var isFnBrace = item.match(/\((.*?)\)$/);
            if (isFnBrace) {
                currentElem[2].push(isFnBrace[1])
            } else {
                var textContent = '';
                /**
                * check for possible nodes match
                * closing from a nested element or a text that contains (closing function)
                * eg `(this is an element) it works`
                */
                for (var x = 0; x < item.length; x++) {
                    var node = item[x];
                    if (node == '{') continue;
                    if (node == '(') {
                        if (textContent) {
                            manyNested[manyNested.length - 1][2].push(textContent);
                            textContent = '';
                        }

                        var closingTagIndex = item.lastIndexOf(')');
                        if (1 <= closingTagIndex) {
                            textContent += item.substr(x + 1, closingTagIndex - 1);
                            x = closingTagIndex;
                            // some element can define a empty ()
                            // if textContent is empty we don't set it
                            if (textContent)
                                currentElem[2].push(textContent);
                            else 
                                currentElem.splice(2, 1);
    
                            textContent = '';
                            // set currentElem to be the parent since the child element is closed
                            currentElem = manyNested[manyNested.length - 1];
                            continue
                        }
                    } else if (node == '}') {
                        // closing tag found and textContent
                        // push to parentElement
                        if (textContent) {
                            manyNested[manyNested.length - 1][2].push(textContent);
                            textContent = '';
                        }

                        if (manyNested.length)
                            manyNested.pop();
                        continue;
                    } else {
                        textContent += node
                    }
                }

                // attach text content to child if any found
                if (textContent) {
                    currentElem[2].push(textContent);
                }
            }

        }
    }

    return astNodes;
}