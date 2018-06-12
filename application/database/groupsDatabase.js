'use strict';

const helper = require('./helper');
const validateGroup = require('../models/group');
const userService = require('../services/user');

function getGroupsCollection(){
    return helper.connectToDatabase()
    .then((db) => db.collection('groups'));
}

function getNextId(){
    return helper.connectToDatabase()
    .then((db) => helper.getNextIncrementationValueForCollection(db, 'groups'));
}

let self = module.exports = {

    exists: function(id) {
        return getGroupsCollection().then( (groups) => {
            return groups.find({_id : id}).hasNext();
        });
    },

    get: function(id) {
        return getGroupsCollection()
        .then((groups) => groups.findOne({
            _id: id
        }));
    },

    getDeckGroups: function(deckId, userId, usergroup){

        // form conditions based on the filters given
        let conditions = [];
        if(userId){
            conditions.push({user: userId});
        }

        if(usergroup){
            let userGroupCondition = (Array.isArray(usergroup)) 
                ? {userGroup: {$in: usergroup}} 
                : {userGroup: usergroup};

            conditions.push(userGroupCondition);
        }

        let queryConditions = {};
        if(conditions.length > 0){
            queryConditions = {
                $or: conditions
            };
        }

        return getGroupsCollection()
        .then((groups) => groups.find({
            $and: [
                {decks: deckId}, 
                queryConditions
            ]
        }))
        .then((stream) => stream.toArray());
    },

    insert: function(group){
        return getNextId().then((id) => {
            return getGroupsCollection().then( (groups) => {
                group._id = id;

                let now = (new Date()).toISOString();
                group.timestamp = now;
                group.lastUpdate = now;

                if (!validateGroup(group)) {
                    throw validateGroup.errors;
                }

                return groups.insertOne(group).then( (insertedGroup) => {
                    return insertedGroup.ops[0];
                });
            });
        });
    }, 

    replaceMetadata: function(existingGroup, newMetadata){
        return getGroupsCollection()
        .then((groups) => {

            let newGroup = Object.assign({}, existingGroup);
            newGroup.lastUpdate = (new Date()).toISOString();
            newGroup.title = newMetadata.title || '';
            newGroup.description = newMetadata.description || '';
            (newMetadata.hasOwnProperty('userGroup'))  ? newGroup.userGroup = newMetadata.userGroup : delete newGroup.userGroup;
           
            return groups.findOneAndReplace( { _id: existingGroup._id }, newGroup, { returnOriginal: false });
        });
    }, 

    replaceDecks: function(existingGroup, newDecks){
        return getGroupsCollection()
        .then((groups) => {

            let newGroup = Object.assign({}, existingGroup);
            newGroup.lastUpdate = (new Date()).toISOString();
            newGroup.decks = newDecks;

            return groups.findOneAndReplace( { _id: existingGroup._id }, newGroup, { returnOriginal: false });
        });
    }, 

    addDeck: function(groupId, deckIdToAdd){       
        return getGroupsCollection()
        .then((groups) => {
            return groups.updateOne({
                _id: groupId
            }, 
            {
                $addToSet: {
                    decks: deckIdToAdd
                }
            });
        });
    },

    removeDeck: function(groupId, deckIdToRemove){
        return getGroupsCollection()
        .then((groups) => {
            return groups.updateOne({
                _id: groupId
            }, 
            {
                $pull: {
                    decks: deckIdToRemove
                }
            });
        });
    },

    delete: function(id){
        return getGroupsCollection()
        .then( (groups) => {
            return groups.remove({_id: id});
        });
    }, 

    count: function(query){
        return getGroupsCollection()
        .then( (groups) => groups.find(query).count());
    }, 

    list: function(query, pagination){

        let offset = pagination.page * pagination.per_page;
        let limit = pagination.per_page;
        let sort = { _id: 1 };      // sort with ASC _id

        return getGroupsCollection()
        .then( (groups) => groups.find(query).sort(sort).skip(offset).limit(limit))
        .then((stream) => stream.toArray());
    }, 

    userPermissions: function(groupId, userId, authToken){
        userId = parseInt(userId);

        return self.get(groupId).then( (group) => {
            if(!group) return null;

            if (!userId) {
                // logged out
                return { admin: false, edit: false };
            }

            // give all rights to group owner
            if(group.user === userId){
                return {
                    admin: true,
                    edit: true
                };
            }

            return userService.fetchGroupsForUser(userId, authToken).then( (usergroups) => {
                // if the deck group has a user group that is included in the user's user groups 
                // then give permisson to add/remove decks from the deck group
                if(usergroups.includes(group.userGroup)){
                    return {
                        admin: false,
                        edit: true
                    };
                } else {
                    return {
                        admin: false, 
                        edit: false
                    };
                }
            });
        });
    }

};
