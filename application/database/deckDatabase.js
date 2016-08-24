'use strict';

const helper = require('./helper'),
    oid = require('mongodb').ObjectID,
    striptags = require('striptags'),
    deckModel = require('../models/deck.js');

let async = require('async');

let self = module.exports = {
    get: function(identifier) {
        identifier = String(identifier).split('-')[0];
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => col.findOne({
            _id: parseInt(identifier.split('-')[0])
        })
        .then((found) => {
            let parsed = identifier.split('-');
            if(parsed.length === 1){
                return found;
            }
            else{
                // let revision = found.revisions[parseInt(parsed[1])-1];
                // revision.id = identifier;
                // revision.kind = 'deck';
                // return revision;
                let revision = found.revisions[parseInt(parsed[1])-1];
                found.revisions = [revision];
                return found;
            }
        })
    );
    },

    insert: function(deck) {
        return helper.connectToDatabase()
        .then((db) => helper.getNextIncrementationValueForCollection(db, 'decks'))
        .then((newId) => {
            return helper.connectToDatabase()
            .then((db2) => db2.collection('decks'))
            .then((col) => {
                let valid = false;
                deck._id = newId;
                if(typeof deck.root_deck !== 'undefined'){
                    deck.root_deck = deck.root_deck.split('-')[0];
                }
                else {
                    deck.root_deck = null;
                }

                try {
                    const convertedDeck = convertToNewDeck(deck);
                    //console.log(convertedDeck);
                    valid = deckModel(convertedDeck);
                    if (!valid) {
                        return deckModel.errors;
                    }

                    return col.insertOne(convertedDeck);
                } catch (e) {
                    console.log('validation failed', e);
                }
                return;
            });
        });
    },

    update: function(deck) {    //when no new revision is needed..
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => col.findOneAndUpdate({
            _id: deck.id
        }, deck));
    },

    rename: function(deck_id, newName){
        let deckId = deck_id.split('-')[0];
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => col.findOne({_id: parseInt(deckId)})
        .then((deck) => {
            deck.revisions[deck_id.split('-')[1]-1].title = newName;
            return col.findOneAndUpdate({_id: parseInt(deckId)}, deck);
        }));
    },


    replace: function(id, deck) {
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(id)})
            .then((existingDeck) => {
                const maxRevisionId = existingDeck.revisions.reduce((prev, curr) => {
                    if (curr.id > prev)
                        return curr.id;
                    else
                        return prev;
                }, 1);
                let valid = false;
                const newRevisionId = parseInt(maxRevisionId)+1;
                //must get previously active revision and copy content items to new revision
                let activeRevisionIndex = getActiveRevision(existingDeck);
                let content_items = existingDeck.revisions[activeRevisionIndex].contentItems;
                const deckWithNewRevision = convertDeckWithNewRevision(deck, newRevisionId, content_items);
                try {
                    valid = deckModel(deckWithNewRevision);

                    if (!valid) {
                        return deckModel.errors;
                    }

                    return col.findOneAndUpdate({
                        _id: parseInt(id)
                    }, {$set: {active : newRevisionId}, $push: { revisions: deckWithNewRevision.revisions[0] } });
                } catch (e) {
                    console.log('validation failed', e);
                }
                return;
            });
        });
    },

    insertNewContentItem: function(citem, position, root_deck, ckind, citem_revision_id){
        if(typeof citem_revision_id === 'undefined'){
            citem_revision_id = parseInt(1);
        }
        else{
            citem_revision_id = parseInt(citem_revision_id);
        }
        let root_deck_path = root_deck.split('-');
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(root_deck_path[0])})
            .then((existingDeck) => {
                //TODO must check if the root_deck comes with a revision id or not, and get the element accordingly
                let activeRevisionId = existingDeck.active;
                if(root_deck_path.length > 1){
                    activeRevisionId = root_deck_path[1];
                }
                if(position && position > 0){
                    let citems = existingDeck.revisions[activeRevisionId-1].contentItems;
                    for(let i = position-1; i < citems.length; i++){
                        citems[i].order = parseInt(citems[i].order)+1;
                    }

                    let newCitem = {
                        order: parseInt(position),
                        kind: ckind,
                        ref : {
                            id: String(citem.id),
                            revision:citem_revision_id
                        }
                    };
                    citems.splice(position-1, 0, newCitem);
                    existingDeck.revisions[activeRevisionId-1].contentItems = citems;
                    col.save(existingDeck);
                }
                else{
                    col.findOneAndUpdate({
                        _id: parseInt(root_deck_path[0]),  revisions : {$elemMatch: {id: parseInt(activeRevisionId)}}  },
                        {
                            $push: {
                                'revisions.$.contentItems': {
                                    order: parseInt(getOrder(existingDeck.revisions[activeRevisionId-1]))+1,
                                    kind: ckind,
                                    ref : {
                                        id: String(citem.id),
                                        revision:citem_revision_id
                                    }
                                }
                            }
                        }
                    );
                }
                //existingDeck.revisions[activeRevisionId-1]
            });
        });

    },

    removeContentItem: function(position, root_deck){
        let root_deck_path = root_deck.split('-');
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(root_deck_path[0])})
            .then((existingDeck) => {
                //TODO must check if the root_deck comes with a revision id or not, and get the element accordingly
                let activeRevisionId = existingDeck.active;
                if(root_deck_path.length > 1){
                    activeRevisionId = root_deck_path[1];
                }
                let citems = existingDeck.revisions[activeRevisionId-1].contentItems;
                for(let i = position-1; i < citems.length; i++){
                    citems[i].order = citems[i].order-1;
                }
                //remove reference from item to root deck, and from deck to removed item
                let itemId = citems[position-1].ref.id;
                col.findOneAndUpdate({_id: parseInt(itemId)}, {'$set' : {'deck' : null}});
                citems.splice(position-1, 1);
                existingDeck.revisions[activeRevisionId-1].contentItems = citems;
                col.save(existingDeck);

            });
        });
    },


    updateContentItem: function(citem, revertedRevId, root_deck, ckind){ //can be used for reverting or updating
        let rootArray = root_deck.split('-');

        helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            col.findOne({_id: parseInt(rootArray[0])})
            .then((existingDeck) => {
                let newRevId = getNewRevisionID(citem);
                if(revertedRevId !== ''){
                    newRevId = revertedRevId;
                }
                let rootRev = existingDeck.active;
                if(rootArray.length > 1){
                    rootRev = rootArray[1];
                }
                for(let i = 0; i < existingDeck.revisions.length; i++) {
                    if(existingDeck.revisions[i].id === parseInt(rootRev)) {

                        for(let j = 0; j < existingDeck.revisions[i].contentItems.length; j++) {
                            if(existingDeck.revisions[i].contentItems[j].ref.id === String(citem._id)) {
                                existingDeck.revisions[i].contentItems[j].ref.revision = newRevId;
                            }
                            else continue;
                        }
                    }
                    else continue;
                }
                col.save(existingDeck);
            });
        });
    },


    revert: function(deck_id, deck){ //this can actually revert to past and future revisions
        //NOTE must add validation on deck id
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOneAndUpdate({_id: parseInt(deck_id)}, {'$set' : {'active' : parseInt(deck.revision_id)}});
        });
    },


    getDeckTreeFromDB: function(deck_id){
        let deckTree;
        let revision_id = -1;
        let decktreesplit = String(deck_id).split('-');
        if(decktreesplit.length > 1){
            deck_id = decktreesplit[0];
            revision_id = decktreesplit[1]-1;
        }
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(deck_id)})
            .then((deck) => {
                if(revision_id === -1){
                    revision_id = deck.active-1;
                }
                deckTree = { title: striptags(deck.revisions[revision_id].title), id: deck_id+'-'+(revision_id+1), type: 'deck', children: []};


                return new Promise(function(resolve, reject) {
                    async.eachSeries(deck.revisions[revision_id].contentItems, function(citem, callback){
                        if(citem.kind === 'slide'){
                            helper.connectToDatabase()
                            .then((db) => db.collection('slides'))
                            .then((col) => {
                                col.findOne({_id: parseInt(citem.ref.id)})
                                .then((slide) => {
                                    let slide_revision = citem.ref.revision-1;
                                    deckTree.children.push({title: striptags(slide.revisions[slide_revision].title), id: slide._id+'-'+slide.revisions[slide_revision].id, type: 'slide'});
                                    callback();
                                });
                            });
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {

                                module.exports.getDeckTreeFromDB(innerDeck._id+'-'+citem.ref.revision)
                                .then((res) => {
                                    deckTree.children.push(res);
                                    callback();
                                });
                            });
                        }
                    },function(err){
                        resolve(deckTree);
                    });

                });


            });
        });
    },

    getFlatSlidesFromDB: function(deck_id, deckTree){

        let revision_id = -1;
        let decktreesplit = deck_id.split('-');
        if(decktreesplit.length > 1){
            deck_id = decktreesplit[0];
            revision_id = decktreesplit[1]-1;
        }
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(deck_id)})
            .then((deck) => {
                if(revision_id === -1){
                    revision_id = deck.active-1;
                }
                if(!deckTree){
                    deckTree = { title: deck.revisions[revision_id].title, id: deck_id+'-'+(revision_id+1), type: 'deck', children: []};
                }

                return new Promise(function(resolve, reject) {
                    async.eachSeries(deck.revisions[revision_id].contentItems, function(citem, callback){

                        if(citem.kind === 'slide'){
                            helper.connectToDatabase()
                            .then((db) => db.collection('slides'))
                            .then((col) => {
                                col.findOne({_id: parseInt(citem.ref.id)})
                                .then((slide) => {
                                    let slide_revision = citem.ref.revision-1;
                                    deckTree.children.push({title: slide.revisions[slide_revision].title, content: slide.revisions[slide_revision].content, id: slide._id+'-'+slide.revisions[slide_revision].id, type: 'slide'});
                                    callback();
                                });
                            });
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {
                                module.exports.getFlatSlidesFromDB(innerDeck._id+'-'+citem.ref.revision, deckTree)
                                .then((res) => {
                                    callback();
                                });
                            });
                        }
                    },function(err){
                        resolve(deckTree);
                    });

                });


            });
        });
    }
};

function getActiveRevision(deck){
    for(let i = 0; i < deck.revisions.length; i++) {
        if(deck.revisions[i].id === deck.active) {
            return i;
        }
        else continue;
    }
    return -1;
}

function getNewRevisionID(citem){
    if(citem.revisions.length > 0)
        return Math.max.apply(
            Math,citem.revisions.map(
                (o) => {
                    return o.id;
                }
            )
        );
    else return 0;
}

//returns the max order of appearance (i.e., position) of a content item inside a deck, or 0 if it is empty
// function getOrder(activeRevision){
//   if(activeRevision.revisions[0].contentItems.length > 0){
//     return Math.max.apply(
//       Math,activeRevision.revisions[0].contentItems.map(
//         function(o){
//           return o.order;
//         }
//       )
//     );
//   }
//   else return 0;
// }

//returns the max order of appearance (i.e., position) of a content item inside a deck, or 0 if it is empty
function getOrder(activeRevision){
    if(activeRevision.contentItems.length > 0){
        return Math.max.apply(
            Math,activeRevision.contentItems.map(
                (o) => {
                    return o.order;
                }
            )
        );
    }
    else return 0;
}

function convertDeck(deck) {
    let now = new Date();
    return {
        user: deck.user,
        deck: deck.root_deck,
        timestamp: now,
        lastUpdate: now,
        license: deck.license,
        revisions: [{
            title: deck.title,
            timestamp: now,
            user: deck.user,
            visibility: false,
            contentItems: deck.content_items
        }]
    };
}

function convertToNewDeck(deck){
    let now = new Date();
    const result = {
        _id: deck._id,
        user: deck.user,
        deck: deck.root_deck,
        kind: 'deck',
        timestamp: now.toISOString(),
        language: deck.language,
        description: deck.description,
        translation: deck.translation,
        lastUpdate: now.toISOString(),
        tags: deck.tags,
        active: 1,
        revisions: [{
            id: 1,
            title: deck.title,
            timestamp: now.toISOString(),
            user: deck.user,
            license: deck.license,
            parent: deck.parent_deck,
            contentItems: []
        }]
    };
    //console.log('from', slide, 'to', result);
    return result;
}

function convertDeckWithNewRevision(deck, newRevisionId, content_items) {
    let now = new Date();
    const result = {
        user: deck.user,
        deck: deck.root_deck,
        timestamp: now.toISOString(),
        language: deck.language,
        revisions: [{
            id: newRevisionId,
            timestamp: now.toISOString(),
            user: deck.user,
            license: deck.license,
            title: deck.title,
            parent: deck.parent_deck,
            contentItems: content_items
        }]
    };
    //console.log('from', slide, 'to', result);
    return result;
}
