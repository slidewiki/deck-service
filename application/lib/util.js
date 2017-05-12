'use strict';

// updates the elements in original by assigning values from update using id property to match elements in arrays
let self = module.exports = {

    assignToAllById: function(original, update) {
        original.forEach((val) => {
            // if not found does nothing :)
            Object.assign(val, update.find((el) => el.id === val.id) );
        });
        return original;
    },

    // splits the string identifier to {id, revision}
    parseIdentifier: function(identifier) {
        let parsed = String(identifier).match(/^(\d+)(?:-(\d+))?$/);

        // return both undefined if error
        if (!parsed) {
            // regex failed, no fallback!
            return [undefined, undefined];
        }

        let id = parseInt(parsed[1]);
        // could be undefined, so don't parse (it would result to NaN)
        let revision = parsed[2] && parseInt(parsed[2]);

        return {id, revision};
    },

};
