'use strict';

const helper = require('./helper');

module.exports = function() {
    let decksIndexes = helper.getCollection('decks').then((decks) => {
        return decks.createIndexes([
            { key: {'revisions.contentItems.ref.id': 1} },
            { key: {'revisions.contentItems.ref.revision': 1} },
            { key: {'revisions.contentItems.kind': 1} },
            { key: {'origin.id': 1} },
        ]);
    });

    let groupsIndexes = helper.getCollection('groups').then((groups) => {
    	return groups.createIndexes([
            { key: {'user': 1} },
            { key: {'userGroup': 1} },
            { key: {'decks': 1} },
        ]);
    });

    return Promise.all([decksIndexes, groupsIndexes]);
};
