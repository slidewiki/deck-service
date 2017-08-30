'use strict';

const helper = require('./helper');

let self = module.exports = {

    index: function(filter) {
        let query = {};

        if (filter.userId) query.user = filter.userId;
        if (filter.archivedBy) query['archiveInfo.archivedBy'] = filter.archivedBy;
        if (filter.reason) query['archiveInfo.reason'] = filter.reason;

        return helper.getCollection('decks_archived')
        .then((col) => col.find(query))
        .then((cursor) => cursor.toArray());
    },

    get: function(id) {
        return helper.getCollection('decks_archived')
        .then((col) => col.findOne({ _id: id }));
    },

};
