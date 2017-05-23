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

        // return nothing undefined if error
        if (!parsed) return;

        let result = { id: parseInt(parsed[1]) };

        // could be undefined, so don't parse (it would result to NaN)
        let revision = parsed[2] && parseInt(parsed[2]);
        if (revision) {
            result.revision = revision;
        }

        return result;
    },

    toIdentifier: function(ref) {
        let revision = ref.revision ? `-${ref.revision}` : '';
        return `${ref.id}${revision}`;
    },

};
