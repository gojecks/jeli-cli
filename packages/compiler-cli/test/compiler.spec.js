const chai = require('chai')
const expect = chai.expect;
const compiler = require('../lib')
const projectSchema = {
    type: "library",
    sourceRoot: `${__dirname}/components`,
    "output": {
        "generateMeta": true,
        "patterns": ["MODULE"],
        "folder": "__TEST__",
        "files": {
            "test": "./public.api.js",
        }
    }
};

describe('Compile', function () {
    it('should compile with provided project schema', async () => {
       const done =  await compiler.builder(projectSchema);
       expect(done).true;
    });
});