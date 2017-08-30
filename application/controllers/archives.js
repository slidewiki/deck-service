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

        archivesDB.get(deckId).then((archivedDeck) => {
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
        let deckId = request.params.id;
        let userId = request.auth.credentials.userid;

        deckDB.get(deckId).then((existingDeck) => {
            if (!existingDeck) {
                throw boom.notFound();
            }

            if (!authorizedForReview(request)) {
                throw boom.forbidden();
            }

            return deckDB.archiveDeckTree(deckId).then(() => {
                reply();
            });

        }).catch( (err) => {
            if (err.isBoom) return reply(err);

            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

};

// checks if a request has proper reviewer authorization
function authorizedForReview(request) {
    let secret = request.query && request.query.secret;
    let userIsReviewer = request.auth && request.auth.credentials.isReviewer;

    return (secret === process.env.SECRET_REVIEW_KEY && userIsReviewer && true) || false;
}
