'use strict';

const boom = require('boom');
const groupDB = require('../database/groupsDatabase');
const deckDB = require('../database/deckDatabase');
const util = require('../lib/util');

let self = module.exports = {

    get: function(request, reply) {
        groupDB.get(request.params.id).then((group) => {
            if (!group){
                return reply(boom.notFound());
            }
            
            return reply(group);
        }).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    // lists the deck groups of a deck
    getDeckGroups: function(request, reply){
        let identifier = util.parseIdentifier(request.params.id);
        if(!identifier) return reply(boom.badData());

        let deckId = identifier.id;

        deckDB.get(deckId).then( (deck) => {
            if(!deck)   return reply(boom.notFound());

            return groupDB.getDeckGroups(deckId).then( (groups) => {
                return reply(groups.map( (group) => {
                    // remove contained deck ids from deck groups found
                    delete group.decks;
                    return group;
                }));
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    insert: function(request, reply){
        let userId = request.auth.credentials.userid;

        request.payload.user = userId; 

        groupDB.insert(request.payload).then( (group) => {
            return reply(group);
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    }, 


    replace: function(request, reply){
        let groupId = request.params.id;
        let userId = request.auth.credentials.userid;

        authorizeUser(groupId, userId).then( (authError) => {
            if(authError) return authError;

            return groupDB.get(groupId).then( (existingGroup) => {
                if(!existingGroup) return boom.notFound();

                return groupDB.replace(existingGroup, request.payload).then( (group) => {
                    return group.value;
                });
            });
        }).then( (response) => {
            reply(response);
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    }, 

    delete: function(request, reply){
        let groupId = request.params.id; 
        let userId = request.auth.credentials.userid;

        authorizeUser(groupId, userId).then( (authError) => {
            if(authError) return authError;

            return groupDB.exists(groupId).then( (exists) => {
                if(!exists) return reply(boom.notFound());

                return groupDB.delete(groupId).then( () => {
                    return;
                });
            });
        }).then( (response) => {
            reply(response);
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    }, 

    list: function(request, reply){

        let query = (request.query.user) ? {user: request.query.user} : {};

        let pagination = {};
        pagination.page = request.query.page;
        pagination.per_page = request.query.per_page;

        groupDB.count(query).then( (total_count) => {
            return groupDB.list(query, pagination).then( (groups) => {
                // form links for previous and next results
                let links = {};

                if(pagination.page > 0){
                    links.previous = `/groups?page=${pagination.page-1}&per_page=${pagination.per_page}`;
                }

                if(pagination.page * pagination.per_page + pagination.per_page < total_count){
                    links.next = `/groups?page=${pagination.page+1}&per_page=${pagination.per_page}`;
                }

                // build repsonse body
                let response = {};
                response.metadata = {
                    page: pagination.page, 
                    per_page: pagination.per_page, 
                    total_count: total_count, 
                    links: links
                };
                response.documents = groups;
                reply(response);
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    }

};

function authorizeUser(groupId, userId){
    return groupDB.userPermissions(groupId, userId).then( (perms) => {
        
        console.log(perms);

        if(!perms) return boom.notFound();

        if(!perms.admin) return boom.forbidden();

        if(!perms.edit) return boom.forbidden();
    });
}