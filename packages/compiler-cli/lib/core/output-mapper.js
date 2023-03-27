
let indexes = new Map();
let inc = 1000;
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
