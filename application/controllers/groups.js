'use strict';

const boom = require('boom');
const groupDB = require('../database/groupsDatabase');
const deckDB = require('../database/deckDatabase');
const util = require('../lib/util');
const async = require('async');

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

            return groupDB.getDeckGroups(deckId, request.query.user).then( (groups) => {
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
        request.payload.user = request.auth.credentials.userid; 

        // parse and filter given deck ids
        let deckIds = parseDeckIds(request.payload.decks);

        // if number of parsed deck ids is not equal
        // to deck ids given then return bad data
        if(deckIds.length !== request.payload.decks.length){
            return reply(boom.badData('Couldn\'t parse all deck ids given'));
        }

        request.payload.decks = deckIds;

        groupDB.insert(request.payload).then( (group) => {
            return reply(group);
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    }, 


    replaceMetadata: function(request, reply){
        let groupId = request.params.id;
        let userId = request.auth.credentials.userid;

        authorizeUser(groupId, userId).then( (authError) => {
            if(authError) return authError;

            return groupDB.get(groupId).then( (existingGroup) => {
                if(!existingGroup) return boom.notFound();

                return groupDB.replaceMetadata(existingGroup, request.payload).then( (group) => {
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

    replaceDecks: function(request, reply){
        let groupId = request.params.id;
        let userId = request.auth.credentials.userid;

        authorizeUser(groupId, userId).then( (authError) => {
            if(authError) return authError;

            return groupDB.get(groupId).then( (existingGroup) => {
                if(!existingGroup) return boom.notFound();

                let deckIds = parseDeckIds(request.payload.decks);

                if(deckIds.length !== request.payload.decks.length){
                    return boom.badData('Couldn\'t parse all deck ids given');
                }

                return groupDB.replaceDecks(existingGroup, deckIds).then( (group) => {
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

    updateDecks: function(request, reply){
        let groupId = request.params.id;
        let userId = request.auth.credentials.userid;
        let updateOps = request.payload;

        authorizeUser(groupId, userId).then( (authError) => {
            if(authError) return authError;

            return groupDB.get(groupId).then( (existingGroup) => {
                if(!existingGroup) return boom.notFound();

                return new Promise( (resolve, reject) => {
                    async.eachSeries(updateOps, (updateOp, done) => {

                        // parse deck identifier
                        let identifier = util.parseIdentifier(updateOp.deckId);
                        if(!identifier) return reply(boom.badData('Couldn\'t parse deck id given'));

                        if(updateOp.op === 'add') {
                            groupDB.addDeck(groupId, identifier.id)
                            .then( () => done())
                            .catch(done);
                        } else if (updateOp.op === 'remove'){
                            groupDB.removeDeck(groupId, identifier.id)
                            .then( () => done())
                            .catch(done);
                        }
                    }, (err) => {
                        if(err){
                            reject(err);
                        }

                        // reply with the updated deck group
                        groupDB.get(groupId).then( (updatedDeckGroup) => {
                            resolve(updatedDeckGroup);
                        }).catch( (err) => {
                            reject(err);
                        });
                    });
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

        console.log('edw');
        console.log(request.query.usergroup);

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

        if(!perms) return boom.notFound();

        if(!perms.admin) return boom.forbidden();

        if(!perms.edit) return boom.forbidden();
    });
}

// parse string deck ids to integers and 
function parseDeckIds(deckIds){
    return deckIds.map( (deckId) => {
        let identifier = util.parseIdentifier(deckId);
        if(!identifier) return;
        return parseInt(identifier.id);
    }).filter( (deckId) => {
        return (deckId !== undefined);
    });
}