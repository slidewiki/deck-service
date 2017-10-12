'use strict';

const helper = require('./helper');
const validateGroup = require('../models/group');

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

    getDeckGroups: function(deckId){
        return getGroupsCollection()
        .then((groups) => groups.find({
            decks: deckId
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

    replace: function(existingGroup, newGroup){
        return getGroupsCollection()
        .then((groups) => {

            // keep existing group's timestamp and _id
            newGroup._id = existingGroup._id;
            newGroup.timestamp = existingGroup.timestamp;
            newGroup.lastUpdate = (new Date()).toISOString();
            newGroup.user = existingGroup.user;

            return groups.findOneAndReplace( { _id: existingGroup._id }, newGroup, { returnOriginal: false });
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

    userPermissions: function(groupId, userId){
        userId = parseInt(userId);

        return self.get(groupId).then( (group) => {
            if(!group) return null;

            // give all rights to group owner
            if(group.user === userId){
                return {
                    admin: true,
                    edit: true
                };
            }

            return {
                admin: false, 
                edit: false
            };
        });
    }

};
