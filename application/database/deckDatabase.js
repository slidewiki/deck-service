'use strict';

const helper = require('./helper'),
    oid = require('mongodb').ObjectID,
    striptags = require('striptags'),
    deckModel = require('../models/deck.js');

let async = require('async');

let self = module.exports = {
    get: function(identifier) {
        //identifier = String(identifier).split('-')[0];
        identifier = String(identifier);
        let idArray = identifier.split('-');
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => col.findOne({
            _id: parseInt(idArray[0])
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
                let revision = found.revisions[parseInt(idArray[1])-1];
                found.revisions = [revision];
                return found;
            }
        })
    );
    },

    find: (collection, query) => {
        return helper.connectToDatabase()
        .then((db) => db.collection(collection))
        .then((col) => col.find(query))
        .then((cursor) => cursor.toArray());
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
                // if(typeof deck.root_deck !== 'undefined'){
                //     deck.root_deck = deck.root_deck.split('-')[0];
                // }
                // else {
                //     deck.root_deck = null;
                // }
                if(typeof deck.root_deck === 'undefined'){
                    deck.root_deck = null;
                }

                try {
                    const convertedDeck = convertToNewDeck(deck);
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

    update: function(id, deck) {    //when no new revision is needed..
        // return helper.connectToDatabase()
        // .then((db) => db.collection('decks'))
        // .then((col) => col.findOneAndUpdate({
        //     _id: deck.id
        // }, deck));
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(id)})
            .then((existingDeck) => {
                let valid = false;
                let idArray = id.split('-');
                let activeRevisionIndex ;
                if(idArray.length > 1){
                    activeRevisionIndex = parseInt(idArray[1])-1;
                }
                else{
                    activeRevisionIndex = getActiveRevision(existingDeck);
                }

                const deckRevision = existingDeck.revisions[activeRevisionIndex];
                deckRevision.title = deck.title;
                deckRevision.description = deck.description;
                deckRevision.license = deck.license;
                //deckRevision.theme = deck.theme;
                deckRevision.tags = deck.tags;
                existingDeck.revisions[activeRevisionIndex-1] = deckRevision;
                try {
                    valid = deckModel(deckRevision);

                    if (!valid) {
                        return deckModel.errors;
                    }
                    return col.findOneAndUpdate({
                        _id: parseInt(id)
                    }, existingDeck, {new: true});
                } catch (e) {
                    console.log('validation failed', e);
                }
                return;
            });
        });
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
        let idArray = String(id).split('-');
        if(idArray.length > 1){
            id = idArray[0];
        }
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
                //NOTE or should we get the id from the request, it contains the revision that is replaced...
                let activeRevisionIndex = getActiveRevision(existingDeck);
                if(idArray.length > 1){
                    activeRevisionIndex = parseInt(idArray[1])-1;
                }

                let usageArray = existingDeck.revisions[activeRevisionIndex].usage;
                //we should remove the usage of the previous revision in the root deck
                let previousUsageArray = JSON.parse(JSON.stringify(usageArray));

                if(deck.root_deck){
                    //console.log(slide.root_deck);

                    for(let i = 0; i < previousUsageArray.length; i++){
                        if(previousUsageArray[i].id === parseInt(deck.root_deck.split('-')[0]) && previousUsageArray[i].revision === parseInt(deck.root_deck.split('-')[1])){
                            previousUsageArray.splice(i,1);
                            break;
                        }
                    }
                    usageArray = [{'id':parseInt(deck.root_deck.split('-')[0]), 'revision': parseInt(deck.root_deck.split('-')[1])}];
                }

                let content_items = existingDeck.revisions[activeRevisionIndex].contentItems;
                //let usageArray = existingDeck.revisions[activeRevisionIndex].usage;
                //console.log('content_items', content_items);
                //console.log('usageArray', usageArray);
                const deckWithNewRevision = convertDeckWithNewRevision(deck, newRevisionId, content_items, usageArray);
                let updatedMetadata = {active : newRevisionId};

                try {
                    valid = deckModel(deckWithNewRevision);

                    if (!valid) {
                        return deckModel.errors;
                    }
                    for(let i = 0; i < content_items.length; i++){
                        let citem = content_items[i];
                        if(citem.kind === 'slide'){
                            helper.connectToDatabase()
                            .then((db) => db.collection('slides'))
                            .then((col) => {
                                col.findOne({_id: parseInt(citem.ref.id)})
                                .then((slide) => {
                                    slide.revisions[citem.ref.revision-1].usage.push({'id': parseInt(id), 'revision': newRevisionId});
                                    col.save(slide);
                                });
                            });
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {
                                innerDeck.revisions[citem.ref.revision-1].usage.push({'id': parseInt(id), 'revision': newRevisionId});
                                col.save(innerDeck);
                            });
                        }
                    }
                    let new_revisions = existingDeck.revisions;
                    new_revisions[activeRevisionIndex].usage = previousUsageArray;
                    new_revisions.push(deckWithNewRevision.revisions[0]);

                    return col.findOneAndUpdate({
                        _id: parseInt(id)
                    //}, { $push: { revisions: slideWithNewRevision.revisions[0] } }, {new: true});
                    }, { $set: { revisions: new_revisions, active: newRevisionId } }, {new: true});
                    // return col.findOneAndUpdate({
                    //     _id: parseInt(id)
                    // }, {$set: updatedMetadata, $push: { revisions: deckWithNewRevision.revisions[0] } });
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
                            id: parseInt(citem.id),
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
                                        id: parseInt(citem.id),
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
        //console.log('root_deck', root_deck);
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(rootArray[0])})
            .then((existingDeck) => {
                //console.log('existingDeck', existingDeck);
                let newRevId = getNewRevisionID(citem);
                if(revertedRevId !== ''){
                    newRevId = revertedRevId;
                }
                let rootRev = existingDeck.active;
                if(rootArray.length > 1){
                    rootRev = rootArray[1];
                }
                let old_rev_id = rootArray[1];
                for(let i = 0; i < existingDeck.revisions.length; i++) {
                    if(existingDeck.revisions[i].id === parseInt(rootRev)) {

                        for(let j = 0; j < existingDeck.revisions[i].contentItems.length; j++) {
                            if(existingDeck.revisions[i].contentItems[j].ref.id === citem._id) {
                                old_rev_id = existingDeck.revisions[i].contentItems[j].ref.revision;
                                existingDeck.revisions[i].contentItems[j].ref.revision = newRevId;
                            }
                            else continue;
                        }
                    }
                    else continue;
                }
                col.save(existingDeck);
                return {'old_revision': old_rev_id, 'new_revision': newRevId};
            });
        });
    },


    revert: function(deck_id, deck){ //this can actually revert to past and future revisions
        //NOTE must add validation on deck id
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOneAndUpdate({_id: parseInt(deck_id)}, {'$set' : {'active' : parseInt(deck.revision_id)}}, {new: true});
        });
    },

    updateUsage: function(deck, new_revision_id, root_deck){
        let idArray = deck.split('-');
        let rootDeckArray = root_deck.split('-');
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(idArray[0])})
              .then((existingDeck) => {
                  //first remove usage of deck from old revision
                  if(root_deck){
                      let usageArray = existingDeck.revisions[parseInt(idArray[1])-1].usage;
                      for(let i = 0; i < usageArray.length; i++){
                          if(usageArray[i].id === parseInt(rootDeckArray[0]) && usageArray[i].revision === parseInt(rootDeckArray[1])){
                              usageArray.splice(i,1);
                              break;
                          }
                      }
                      //then update usage array of new/reverted revision
                      existingDeck.revisions[parseInt(new_revision_id)-1].usage.push({'id': parseInt(rootDeckArray[0]), 'revision': parseInt(rootDeckArray[1])});
                  }
                  existingDeck.active = new_revision_id;
                  col.save(existingDeck);
                  return existingDeck;
              });
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
                                    deckTree.children.push({title: slide.revisions[slide_revision].title, content: slide.revisions[slide_revision].content, speakernotes: slide.revisions[slide_revision].speakernotes, id: slide._id+'-'+slide.revisions[slide_revision].id, type: 'slide'});
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
    },

    getDeckEditors(deck_id, editorsList){

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
                if(!editorsList){
                    editorsList = [deck.user];
                    pushIfNotExist(editorsList, deck.revisions[revision_id].user);
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
                                    pushIfNotExist(editorsList, slide.user);
                                    pushIfNotExist(editorsList, slide.revisions[slide_revision].user);
                                    callback();
                                });
                            });
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {
                                module.exports.getDeckEditors(innerDeck._id+'-'+citem.ref.revision, editorsList)
                                .then((res) => {
                                    callback();
                                });
                            });
                        }
                    },function(err){
                        resolve(editorsList);
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
    let root_deck = deck.root_deck;
    let usageArray = [];
    if(root_deck !== null){
        let root_deck_array = root_deck.split('-');
        usageArray.push({
            'id': parseInt(root_deck_array[0]),
            'revision': parseInt(root_deck_array[1])
        });
    }
    deck.user = parseInt(deck.user);
    const result = {
        _id: deck._id,
        user: deck.user,
        //deck: deck.root_deck,
        kind: 'deck',
        timestamp: now.toISOString(),
        language: deck.language,
        description: deck.description,
        translation: deck.translation,
        lastUpdate: now.toISOString(),
        //tags: deck.tags,
        active: 1,
        revisions: [{
            id: 1,
            usage: usageArray, //create new array and insert root deck
            title: deck.title,
            timestamp: now.toISOString(),
            user: deck.user,
            license: deck.license,
            parent: deck.parent_deck,
            tags: deck.tags,
            contentItems: []
        }]
    };
    //console.log('from', slide, 'to', result);
    return result;
}

function convertDeckWithNewRevision(deck, newRevisionId, content_items, usageArray) {
    let now = new Date();
    deck.user = parseInt(deck.user);
    const result = {
        user: deck.user,
        deck: deck.root_deck,
        timestamp: now.toISOString(),
        language: deck.language,
        revisions: [{
            id: newRevisionId,
            usage: usageArray,
            timestamp: now.toISOString(),
            user: deck.user,
            license: deck.license,
            title: deck.title,
            parent: deck.parent_deck,
            description: deck.description,
            tags: deck.tags,
            contentItems: content_items
        }]
    };
    //console.log('from', slide, 'to', result);
    return result;
}

function pushIfNotExist(editorsList, toBeInserted){
    if(!editorsList.includes(toBeInserted)){
        editorsList.push(toBeInserted);
    }
}
