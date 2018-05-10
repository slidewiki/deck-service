'use strict';

const helper = require('./helper');

module.exports = function() {
    return helper.getCollection('decks').then((decks) => {
        return decks.createIndexes([
            { key: {'revisions.contentItems.ref.id': 1} },
            { key: {'revisions.contentItems.ref.revision': 1} },
            { key: {'revisions.contentItems.kind': 1} },
        ]);
    });
};
