'use strict';

const _ = require('lodash');

const boom = require('boom');
const deckDB = require('../database/deckDatabase');
const userService = require('../services/user');
let self = module.exports = {

    // TODO improve the response object
    listDecks: function(request, reply) {
        let options = _.pick(request.query, 'user', 'idOnly', 'rootsOnly', 'roles', 'sortBy', 'page', 'per_page');

        if(request.query.roles){

            let roles = request.query.roles.split(',');

            if(request.auth.credentials && roles.includes('editor') && 
                request.auth.credentials.userid === request.query.user){

                return userService.fetchGroupsForUser(request.query.user, request.auth.token).then( (usergroups) => {
                    let conditions = [{
                        'editors.groups.id': { $in: usergroups }
                    },
                    {
                        'editors.users.id': request.query.user
                    }];
                    if(request.query.user && roles.includes('owner')){
                        conditions.push({
                            user: request.query.user
                        });
                    }

                    return countAndList({ $or: conditions }, options).then( (response) => {
                        reply(response);
                    });
                    
                }).catch( (err) => {
                    if (err.isBoom) return reply(err);
                    request.log('error', err);
                    reply(boom.badImplementation());
                });
            }
        }

        let query = {};
        if(request.query.user){
            query = {
                user: request.query.user
            };
        }

        return countAndList(query, options).then( (response) => {
            reply(response);
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

function countAndList(query, options){
    options.countOnly = true;
    return deckDB.list(query, options).then( (result) => {

        options.countOnly = false;
        let total_count = (result.length === 0) ? 0 : result[0].total_count;

        return deckDB.list(query, options).then((decks) => {
            // form base url with the params given
            let baseLink = '/decks?';
            if (options.user) baseLink += `user=${options.user}`;
            if (options.rootsOnly) baseLink += `&rootsOnly=${options.rootsOnly}`;
            if (options.idOnly) baseLink += `&idOnly=${options.idOnly}`;
            if (options.roles) baseLink += `&roles=${options.roles}`;
            if (options.sortBy) baseLink += `&sortBy=${options.sortBy}`;

            // form links for previous and next results
            let links = {};

            if(options.page > 1){
                links.previous = baseLink + `&page=${options.page-1}&per_page=${options.per_page}`;
            }

            if(options.page * options.per_page < total_count){
                links.next = baseLink + `&page=${options.page+1}&per_page=${options.per_page}`;
            }

            let response = {};
            response.metadata = {
                page: options.page, 
                per_page: options.per_page,
                total_count: total_count,
                sortBy: options.sortBy,
                links: links
            };
            response.decks = decks.map((deck) => {
                return (options.idOnly) ? { _id: deck._id } : transform(deck);
            });
            return response;
        });
    });
}

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
