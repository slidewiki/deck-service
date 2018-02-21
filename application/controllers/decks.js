'use strict';

const _ = require('lodash');

const boom = require('boom');
const deckDB = require('../database/deckDatabase');
const userService = require('../services/user');
let self = module.exports = {

    // TODO improve the response object
    listDecks: function(request, reply) {
        let conditions = [];
        let query = {};

        if (request.query.owner) {
            query = {
                user: request.query.owner
            };
        }
        
        let options = _.pick(request.query, 'idOnly', 'rootsOnly', 'sortBy', 'page', 'rows');

        if(request.query.editor){

            if (!request.auth.credentials || request.auth.credentials.userid !== request.query.editor){
                return reply(boom.badData('JWT is required'));
            }

            let userId = request.query.editor;
            let authToken = request.auth.token;

            return userService.fetchGroupsForUser(userId, authToken).then( (usergroups) => {
                let conditions = [{
                    'editors.groups.id': { $in: usergroups }
                },
                {
                    'editors.users.id': userId
                }];
                if(request.query.owner){
                    conditions.push(query);
                }

                return deckDB.list({ $or: conditions }, options).then( (decks) => {
                    reply(decks.map((deck) => {
                        return (options.idOnly) ? { _id: deck._id } : transform(deck);
                    }));
                });
            }).catch( (err) => {
                if (err.isBoom) return reply(err);
                request.log('error', err);
                reply(boom.badImplementation());
            });
        }

        

        deckDB.list(query, options).then((decks) => {
            reply(decks.map((deck) => {
                return (options.idOnly) ? { _id: deck._id } : transform(deck);
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

function transform(deck){
    let metadata = {};
    metadata._id = deck._id;
    metadata.timestamp = deck.timestamp;
    metadata.description = deck.description;
    metadata.lastUpdate = deck.lastUpdate;
    metadata.tags = deck.tags;
    metadata.translation = deck.translation;
    metadata.countRevisions = deck.countRevisions;
    metadata.active = deck.active;

    // only active revision is returned
    let revision = deck.revisions;

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
}
