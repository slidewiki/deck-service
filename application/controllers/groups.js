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
                    delete group.decks
                    return group;
                }))
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    insert: function(request, reply){
        groupDB.insert(request.payload).then( (group) => {
            return reply(group);
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    }, 


    replace: function(request, reply){
        let groupId = request.params.id;

        groupDB.exists(groupId).then( (exists) => {
            if(!exists) return reply(boom.notFound());

            return groupDB.replace(groupId, request.payload).then( (group) => {
                return reply(group.value);
            });
        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    }, 

    delete: function(request, reply){
        let groupId = request.params.id; 

        groupDB.exists(groupId).then( (exists) => {
            if(!exists) return reply(boom.notFound());

            return groupDB.delete(groupId).then( () => {
                reply();
            });

        }).catch( (err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });
    }

};