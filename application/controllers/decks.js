'use strict';

const _ = require('lodash');

const boom = require('boom');
const deckDB = require('../database/deckDatabase');

let self = module.exports = {

    // TODO improve the response object
    listDecks: function(request, reply) {
        let query = {};
        if (request.query.user) {
            query.user = request.query.user;
        }

        let options = _.pick(request.query, 'idOnly', 'rootsOnly');

        deckDB.list(query, options).then((decks) => {
            if (options.idOnly) {
                // object already only has ids
                return reply(decks);
            }

            reply(decks.map((deck) => {
                let metadata = {};
                metadata._id = deck._id;
                metadata.timestamp = deck.timestamp;
                metadata.description = deck.description;
                metadata.lastUpdate = deck.lastUpdate;
                metadata.tags = deck.tags;
                metadata.translation = deck.translation;
                metadata.countRevisions = deck.revisions.length;
                metadata.active = deck.active;

                //get revision
                let revision = {};
                for (let key in deck.revisions) {
                    if (deck.revisions[key].id === deck.active)
                        revision = deck.revisions[key];
                }

                metadata.title = revision.title;
                metadata.comment = revision.comment;
                metadata.abstract = revision.abstract;
                metadata.license = revision.license;
                metadata.priority = revision.priority;
                metadata.visibility = revision.visibility;
                if (revision.language){
                    metadata.language = revision.language.length === 2 ? revision.language : revision.language.substring(0, 2);
                }else{
                    metadata.language = 'en';
                }
                metadata.translation = revision.translation;
                metadata.tags = revision.tags;
                metadata.parent = revision.parent;
                metadata.theme = revision.theme;

                // get first slide
                metadata.firstSlide = deckDB.getFirstSlide(revision);

                return metadata;
            }));

        }).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getDeckOwners: function(request, reply) {
        let query = {};
        if (request.query.user) {
            query.user = { $in: request.query.user.split(',').map((u) => parseInt(u)) };
        }

        deckDB.getDeckOwners(query).then((users) => {
            reply(users);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

};
