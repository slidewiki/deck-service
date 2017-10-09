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
            return groups.find({_id : id}).hasNext()
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
        .then((stream) => stream.toArray());;
    },

    insert: function(group){
        return getNextId().then((id) => {
            return getGroupsCollection().then( (groups) => {
                group._id = id;

                if (!validateGroup(group)) {
                    throw validateGroup.errors;
                }

                return groups.insertOne(group).then( (insertedGroup) => {
                    return insertedGroup.ops[0];
                });
            });
        });
    }, 

    replace: function(id, group){
        return getGroupsCollection()
        .then((groups) => {
            return groups.findOneAndReplace( { _id: id }, group, { returnOriginal: false });
        });
    }, 

    delete: function(id){
        return getGroupsCollection()
        .then( (groups) => {
            return groups.remove({_id: id});
        });
    }

};
