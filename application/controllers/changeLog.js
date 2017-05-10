'use strict';

const deckDB = require('../database/deckDatabase');
const boom = require('boom');
const _ = require('lodash');
const async = require('async');


let self = module.exports = {

    getDeckChangeLog: function(request, reply) {
        let deckId = request.params.id;

        // TODO change this
        // change logs are distributed in the deck tree,
        // so we need to get them for all subdeckids
        deckDB.getTreeChangeLog(deckId).then((changeLog) => {
            if (!changeLog) return boom.notFound();

            changeLog.forEach((rec) => {
                let path = rec.path || [];

                // format response for output
                if (rec.remove) {
                    rec.value = {
                        kind: rec.remove.kind,
                        path: formatPath(path.concat({
                            id: formatRef(rec.remove.ref),
                            index: rec.index,
                        })),
                    };
                    delete rec.remove;
                    delete rec.index;
                }

                if (rec.insert) {
                    rec.value = {
                        kind: rec.insert.kind,
                        path: formatPath(path.concat({
                            id: formatRef(rec.insert.ref),
                            index: rec.index,
                        })),
                    };
                    delete rec.insert;
                    delete rec.index;
                }

                delete rec.path;
            });

            // sort changeLog by timestamp before returning
            return _.reverse(_.sortBy(changeLog, 'timestamp'));

        }).then(reply).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

};

function formatPath(path) {
    return path.map((n) => `${n.id}:${n.index + 1}`).join(';');
}

function formatRef(ref) {
    return `${ref.id}-${ref.revision}`;
}
