'use strict';

const _ = require('lodash');

const boom = require('boom');
const deckDB = require('../database/deckDatabase');
const userService = require('../services/user');
const querystring = require('querystring');

let self = module.exports = {

    // TODO improve the response object
    listDecks: function(request, reply) {
        let options = _.pick(request.query, 'user', 'idOnly', 'rootsOnly', 'roles', 'sort', 'page', 'pageSize');

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
                    let query = '';

                    if(request.query.user && roles.includes('owner')){
                        conditions.push({
                            user: request.query.user
                        });
                        query = { $or: conditions };
                    }else{
                        query = {
                            $and: [
                                {
                                    user: {
                                        $not : { $eq: request.query.user }
                                    }
                                },
                                {
                                    $or: conditions
                                }
                            ]
                        };
                    }

                    return countAndList(query, options).then( (response) => {
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

        delete options.countOnly;
        let totalCount = (result.length === 0) ? 0 : result[0].totalCount;

        return deckDB.list(query, options).then((decks) => {

            // form links for previous and next results
            let links = {};
            let page = options.page;

            if(options.page > 1){
                options.page = page - 1;
                links.previous = `/decks?${querystring.stringify(options)}`;
            }

            if(options.page * options.pageSize < totalCount){
                options.page = page + 1;
                links.next = `/decks?${querystring.stringify(options)}`;
            }

            let items = decks.map((deck) => {
                return (options.idOnly) ? { _id: deck._id } : transform(deck);
            });

            if(options.idOnly){
                return items;
            }

            let response = {};
            response._meta = {
                page: page,
                pageSize: options.pageSize,
                totalCount: totalCount,
                sort: options.sort,
                links: links
            };
            response.items = items;
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
    metadata.allowMarkdown = revision.allowMarkdown;

    // get first slide
    metadata.firstSlide = deckDB.getFirstSlide(revision);

    return metadata;
}
