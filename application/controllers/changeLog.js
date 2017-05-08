'use strict';

const deckDB = require('../database/deckDatabase');
const boom = require('boom');
const _ = require('lodash');
const async = require('async');


let self = module.exports = {

    getDeckChangeLog: function(request, reply) {
        let deckId = request.params.id;

        // change logs are distrubuted in the deck tree,
        // so we need to get them for all subdeckids
        deckDB.getSubdeckIds(deckId).then((subDeckIds) => {
            if (!subDeckIds) return boom.notFound();

            return new Promise((resolve, reject) => {
                let changeLog = [];
                async.eachSeries(subDeckIds, (subDeckId, callback) => {
                    deckDB.get(subDeckId).then((subDeck) => {
                        let deckChangeLog = [];
                        if (subDeck.changeLog) deckChangeLog.push(subDeck.changeLog);
                        subDeck.revisions.forEach((rev) => {
                            if (rev.changeLog) {
                                deckChangeLog.push(...rev.changeLog);
                            };
                        });

                        // TODO add a path in the deck tree instead
                        let nodeInfo = { node: {
                            id: subDeck._id,
                            revision: subDeck.revisions.slice(-1)[0].id,
                        }};
                        changeLog.push(...deckChangeLog.map((record) => _.assign(record, nodeInfo)));

                        callback();
                    }).catch(callback);

                }, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(changeLog);
                    }
                });
            });

        }).then((changeLog) => {
            reply(changeLog);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

};
