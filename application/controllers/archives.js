'use strict';

const boom = require('boom');
const deckDB = require('../database/deckDatabase');
const archivesDB = require('../database/archivesDatabase');

let self = module.exports = {

    listArchivedDecks: function(request, reply) {
        archivesDB.index({ userId: request.query.user }).then((decks) => {
            reply(decks);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getArchivedDeck: function(request, reply) {
        let deckId = request.params.id;

        archivesDB.get(request.params.id).then((archivedDeck) => {
            if (!archivedDeck) {
                return reply(boom.notFound());
            }

            reply(archivedDeck);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    archiveDeckTree: function(request, reply) {
        deckDB.get(request.params.id).then( (deck) => {
            if (!deck) {
                return reply(boom.notFound());
            }

            return deckDB.archiveDeckTree(request.params.id).then(() => {
                reply();
            });

        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

};
