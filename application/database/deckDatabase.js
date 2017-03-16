'use strict';

const helper = require('./helper'),
    oid = require('mongodb').ObjectID,
    striptags = require('striptags'),
    deckModel = require('../models/deck.js');

let async = require('async');

let self = module.exports = {
    //gets a specified deck and all of its revision, or only the given revision
    get: function(identifier) {
        identifier = String(identifier);
        let idArray = identifier.split('-');
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => col.findOne({
            _id: parseInt(idArray[0])
        })
        .then((found) => {
            let parsed = identifier.split('-');
            if(parsed.length === 1 || idArray[1] === ''){
                return found;
            }
            else{
                let revision = found.revisions[parseInt(idArray[1])-1];
                if(typeof revision === 'undefined'){
                    return ;
                }
                else{
                    found.revisions = [revision];
                    return found;
                }
            }
        }).catch((err) => {
            console.log('Deck not found.');
            console.log('err', err);
        })
      );
    },
    //gets active revision of deck from database
    getActiveRevisionFromDB: function(identifier) {
        if(identifier.split('-').length > 1){
            return Promise.resolve(identifier);
        }
        else{
            return helper.connectToDatabase()
            .then((db) => db.collection('decks'))
            .then((col) => col.findOne({_id: parseInt(identifier)}))
            .then((found) => {
                if(found){
                    return Promise.resolve(found._id+'-'+found.active);
                }
                else {
                    return ;
                }
            });
        }

    },

    find: (collection, query) => {
        return helper.connectToDatabase()
        .then((db) => db.collection(collection))
        .then((col) => col.find(query))
        .then((cursor) => cursor.toArray());
    },

    findWithLimit: (collection, query, limit, offset) => {
        return helper.connectToDatabase()
        .then((db) => db.collection(collection))
        .then((col) => col.find(query).skip(offset).limit(limit))
        .then((cursor) => cursor.toArray());
    },

    findWithLimitAndSort: (collection, query, limit, offset, sorter) => {
        return helper.connectToDatabase()
        .then((db) => db.collection(collection))
        .then((col) => col.find(query).sort(sorter).skip(offset).limit(limit).sort(sorter))
        .then((cursor) => cursor.toArray());
    },

    //inserts a deck into the database
    insert: function(deck) {
        return helper.connectToDatabase()
        .then((db) => helper.getNextIncrementationValueForCollection(db, 'decks'))
        .then((newId) => {
            return helper.connectToDatabase()
            .then((db2) => db2.collection('decks'))
            .then((col) => {
                let valid = false;
                deck._id = newId;
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

    //updates a deck's metadata when no new revision is needed
    update: function(id, deck) {
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
                deckRevision.language = deck.language;
                existingDeck.description = deck.description;
                existingDeck.license = deck.license;
                //add comment, abstract, footer
                deckRevision.tags = deck.tags;
                existingDeck.revisions[activeRevisionIndex] = deckRevision;
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

    //renames a deck
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

    //updates a deck by creating a new revision
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
                    for(let i = 0; i < previousUsageArray.length; i++){
                        if(previousUsageArray[i].id === parseInt(deck.root_deck.split('-')[0]) && previousUsageArray[i].revision === parseInt(deck.root_deck.split('-')[1])){
                            previousUsageArray.splice(i,1);
                            break;
                        }
                    }
                    usageArray = [{'id':parseInt(deck.root_deck.split('-')[0]), 'revision': parseInt(deck.root_deck.split('-')[1])}];
                }

                let content_items = existingDeck.revisions[activeRevisionIndex].contentItems;
                if(deck.fork){
                    usageArray = [];
                }

                const deckWithNewRevision = convertDeckWithNewRevision(deck, newRevisionId, content_items, usageArray);
                deckWithNewRevision.timestamp = existingDeck.timestamp;
                deckWithNewRevision.user = existingDeck.user;

                deckWithNewRevision.origin = existingDeck.origin;

                if(existingDeck.hasOwnProperty('contributors')){
                    let contributors = existingDeck.contributors;
                    let existingUserContributorIndex = findWithAttr(contributors, 'user', deck.user);
                    if(existingUserContributorIndex > -1)
                        contributors[existingUserContributorIndex].count++;
                    else{
                        contributors.push({'user': deck.user, 'count': 1});
                    }
                    deckWithNewRevision.contributors = contributors;
                }

                try {
                    valid = deckModel(deckWithNewRevision);

                    if (!valid) {
                        throw deckModel.errors;
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
                    deckWithNewRevision.revisions = new_revisions;

                    return col.findOneAndUpdate({
                        _id: parseInt(id)
                    }, { $set: deckWithNewRevision }, {new: true});
                } catch (e) {
                    console.log('validation failed', e);
                    throw e;
                }

            });
        });
    },

    //inserts a content item (slide or deck) into a deck at the specified position, or appends it at the end if no position is given
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
            });
        });

    },

    //removes (unlinks) a content item from a given deck
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
                self.removeFromUsage(citems[position-1], root_deck_path);

                citems.splice(position-1, 1);
                existingDeck.revisions[activeRevisionId-1].contentItems = citems;
                col.save(existingDeck);

            });
        });
    },

    //removes an item from the usage of a given deck
    removeFromUsage: function(itemToRemove, root_deck_path){
        let itemId = itemToRemove.ref.id;
        let itemRevision = itemToRemove.ref.revision;
        if(itemToRemove.kind === 'slide'){
            helper.connectToDatabase()
            .then((db) => db.collection('slides'))
            .then((col2) => {
                col2.findOne({_id: parseInt(itemId)})
                .then((foundSlide) => {
                    let oldUsage = foundSlide.revisions[itemRevision-1].usage;
                    for(let i = 0; i < oldUsage.length; i++){
                        if(oldUsage[i].id === parseInt(root_deck_path[0]) && oldUsage[i].revision === parseInt(root_deck_path[1])){
                            oldUsage.splice(i,1);
                            break;
                        }
                    }
                    foundSlide.revisions[itemRevision-1].usage = oldUsage;
                    col2.save(foundSlide);
                });

            });
        }
        else{
            helper.connectToDatabase()
            .then((db) => db.collection('decks'))
            .then((col) => {
                col.findOne({_id: parseInt(itemId)})
                .then((foundDeck) => {
                    let oldUsage = foundDeck.revisions[itemRevision-1].usage;
                    for(let i = 0; i < oldUsage.length; i++){
                        if(oldUsage[i].id === parseInt(root_deck_path[0]) && oldUsage[i].revision === parseInt(root_deck_path[1])){
                            oldUsage.splice(i,1);
                            break;
                        }
                    }
                    foundDeck.revisions[itemRevision-1].usage = oldUsage;
                    col.save(foundDeck);

                });
            });
        }
    },

    //adds an item to the usage of a given deck
    addToUsage: function(itemToAdd, root_deck_path){

        let itemId = itemToAdd.ref.id;
        let itemRevision = itemToAdd.ref.revision;
        let usageToPush = {id: parseInt(root_deck_path[0]), revision: parseInt(root_deck_path[1])};
        if(itemToAdd.kind === 'slide'){
            helper.connectToDatabase()
            .then((db) => db.collection('slides'))
            .then((col2) => {
                col2.findOneAndUpdate(
                    {_id: parseInt(itemId), 'revisions.id':itemRevision},
                    {$push: {'revisions.$.usage': usageToPush}}
                );
            });
        }
        else{
            helper.connectToDatabase()
            .then((db) => db.collection('decks'))
            .then((col2) => {
                col2.findOneAndUpdate(
                    {_id: parseInt(itemId), 'revisions.id':itemRevision},
                    {$push: {'revisions.$.usage': usageToPush}}
                );
            });
        }
    },

    //updates an existing content item's revision
    updateContentItem: function(citem, revertedRevId, root_deck, ckind){ //can be used for reverting or updating
        let rootArray = root_deck.split('-');
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(rootArray[0])})
            .then((existingDeck) => {
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
                            if(existingDeck.revisions[i].contentItems[j].ref.id === citem._id && existingDeck.revisions[i].contentItems[j].kind === ckind) {
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

    //reverts a deck's active revision to a new given one
    revert: function(deck_id, deck){ //this can actually revert to past and future revisions
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
                      let contains = false;
                      for(let j = 0; j < existingDeck.revisions[parseInt(new_revision_id)-1].usage.length; j++){
                          if(existingDeck.revisions[parseInt(new_revision_id)-1].usage[j].id === parseInt(rootDeckArray[0]) && existingDeck.revisions[parseInt(new_revision_id)-1].usage[j].revision === parseInt(rootDeckArray[1])){
                              contains = true;
                              break;
                          }
                      }
                      if(!contains)
                          existingDeck.revisions[parseInt(new_revision_id)-1].usage.push({'id': parseInt(rootDeckArray[0]), 'revision': parseInt(rootDeckArray[1])});
                  }
                  existingDeck.active = new_revision_id;
                  col.save(existingDeck);
                  return existingDeck;
              });
        });
    },

    //recursive function that gets the decktree of a given deck and all of its sub-decks, can be used with onlyDecks to ignore slides
    getDeckTreeFromDB: function(deck_id, onlyDecks){
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
                            if(!onlyDecks){
                                helper.connectToDatabase()
                                .then((db) => db.collection('slides'))
                                .then((col) => {
                                    col.findOne({_id: parseInt(citem.ref.id)})
                                    .then((slide) => {
                                        let slide_revision = citem.ref.revision-1;
                                        deckTree.children.push({title: striptags(slide.revisions[slide_revision].title), id: slide._id+'-'+slide.revisions[slide_revision].id, type: 'slide'});
                                        callback();
                                    });
                                }).catch(callback);
                            }
                            else{
                                callback();
                            }
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {
                                return self.getDeckTreeFromDB(innerDeck._id+'-'+citem.ref.revision, onlyDecks)
                                .then((res) => {
                                    deckTree.children.push(res);
                                    callback();
                                });
                            }).catch(callback);;
                        }
                    },function(err){
                        if (err) {
                            reject(err);
                        } else {
                            resolve(deckTree);
                        }
                    });

                });


            });
        });
    },

    //returns the username of a user by the user's id (why is this here?)
    getUsernameById: function(user_id){
        return helper.connectToDatabase()
        .then((db) => db.collection('users'))
        .then((col) => col.findOne({
            _id: user_id})
        .then((user) => {
            if (user){
                return user.username;
            }else{
                return '';
            }
        })
        );
    },

    //returns a flattened structure of a deck's slides, and optionally its sub-decks
    getFlatSlidesFromDB: function(deck_id, deckTree, return_decks){

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
                    deckTree = { title: deck.revisions[revision_id].title, id: deck_id+'-'+(revision_id+1), type: 'deck', user: String(deck.revisions[revision_id].user), children: []};
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
                                    deckTree.children.push({title: slide.revisions[slide_revision].title, content: slide.revisions[slide_revision].content, speakernotes: slide.revisions[slide_revision].speakernotes, user: String(slide.revisions[slide_revision].user), id: slide._id+'-'+slide.revisions[slide_revision].id, type: 'slide'});
                                    callback();
                                });
                            });
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {
                                if(return_decks){
                                    let deck_revision = citem.ref.revision-1;
                                    deckTree.children.push({title: innerDeck.revisions[deck_revision].title, user: String(innerDeck.revisions[deck_revision].user), id: innerDeck._id+'-'+innerDeck.revisions[deck_revision].id, type: 'deck'});
                                }
                                self.getFlatSlidesFromDB(innerDeck._id+'-'+citem.ref.revision, deckTree, return_decks)
                                .then((res) => {
                                    callback();
                                });
                            });
                        }
                    },function(err){
                        resolve(deckTree);
                    });
                });
            }).catch((error) => {
                return ;
            });
        });
    },

    //returns a flattened structure of a deck's sub-decks
    getFlatDecksFromDB: function(deck_id, deckTree){

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
                    deckTree = { title: deck.revisions[revision_id].title, id: deck_id+'-'+(revision_id+1), type: 'deck', user: String(deck.revisions[revision_id].user), children: []};
                }

                return new Promise(function(resolve, reject) {
                    async.eachSeries(deck.revisions[revision_id].contentItems, function(citem, callback){

                        if(citem.kind === 'slide'){
                            callback();
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {
                                let deck_revision = citem.ref.revision-1;
                                deckTree.children.push({title: innerDeck.revisions[deck_revision].title, user: String(innerDeck.revisions[deck_revision].user), id: innerDeck._id+'-'+innerDeck.revisions[deck_revision].id, type: 'deck'});

                                module.exports.getFlatDecksFromDB(innerDeck._id+'-'+citem.ref.revision, deckTree)
                                .then((res) => {
                                    callback();
                                });
                            });
                        }
                    },function(err){
                        resolve(deckTree);
                    });

                });


            }).catch((error) => {
                return ;
            });
        });
    },

    //returns an implicit list of editors of a given deck
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
                                self.getDeckEditors(innerDeck._id+'-'+citem.ref.revision, editorsList)
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
    },

    //forks a given deck revision by copying all of its sub-decks into new decks
    forkDeckRevision(deck_id, user){

        return module.exports.getFlatDecksFromDB(deck_id)
        .then((res) => {
            //we have a flat sub-deck structure
            let flatDeckArray = [];
            flatDeckArray.push(res.id); //push root deck into array
            for(let i = 0; i < res.children.length; i++){
                flatDeckArray.push(res.children[i].id); //push next sub-deck into array
            }
            //init maps for new ids
            let id_map = {}, id_noRev_map = {};
            //reverse in order to iterate from bottom to top
            flatDeckArray.reverse();
            //feed the array for serial processing

            let new_decks = [];
            return new Promise(function(resolve, reject) {
                //first we generate all the new ids for the copied decks, and hold them in a map for future reference
                async.eachSeries(flatDeckArray, function(next_deck, callback){
                    return helper.connectToDatabase()
                    .then((db) => helper.getNextIncrementationValueForCollection(db, 'decks'))
                    .then((newId) => {
                        id_map[next_deck] = newId+'-'+1;
                        id_noRev_map[next_deck.split('-')[0]] = newId;
                        callback();
                    });
                },function(err){
                    //iterate the flat decktree and copy each deck, referring to the new ids in its content items and usage
                    async.eachSeries(flatDeckArray, function(next_deck, callback){
                        return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
                        .then((db2) => db2.collection('decks'))
                        .then((col) => {
                            col.findOne({_id: parseInt(next_deck.split('-')[0])})
                            .then((found) => {
                                let ind = parseInt(next_deck.split('-')[1])-1;
                                let copiedDeck = {
                                    _id: id_noRev_map[found._id],
                                    origin: {
                                        id: found._id,
                                        revision: found.revisions[ind].id,
                                        title: found.revisions[ind].title,
                                    },
                                    description: found.description,
                                    language: found.revisions[ind].language,
                                    tags: found.revisions[ind].tags,
                                    license: found.license,
                                    user: parseInt(user),
                                    translated_from: found.translated_from,
                                    contributors: found.contributors,
                                    active: 1
                                };

                                let now = new Date();
                                let timestamp = now.toISOString();
                                copiedDeck.timestamp = timestamp;
                                copiedDeck.lastUpdate = timestamp;
                                if(found.hasOwnProperty('datasource')){
                                    copiedDeck.datasource = found.datasource;
                                }
                                else{
                                    copiedDeck.datasource = null;
                                }
                                //copiedDeck.parent = next_deck.split('-')[0]+'-'+next_deck.split('-')[1];
                                copiedDeck.revisions = [found.revisions[ind]];
                                // own the revision as well!
                                copiedDeck.revisions[0].user = copiedDeck.user;

                                for(let i = 0; i < copiedDeck.revisions[0].contentItems.length; i++){
                                    for(let j in id_map){
                                        if(id_map.hasOwnProperty(j) && copiedDeck.revisions[0].contentItems[i].ref.id === parseInt(j.split('-')[0])){
                                            copiedDeck.revisions[0].contentItems[i].ref.id = parseInt(id_map[j].split('-')[0]);
                                            copiedDeck.revisions[0].contentItems[i].ref.revision = parseInt(id_map[j].split('-')[1]);
                                        }
                                    }
                                }
                                for(let i = 0; i < copiedDeck.revisions[0].usage.length; i++){
                                    for(let j in id_map){
                                        if(id_map.hasOwnProperty(j) && copiedDeck.revisions[0].usage[i].id === parseInt(j.split('-')[0])){
                                            copiedDeck.revisions[0].usage[i].id = parseInt(id_map[j].split('-')[0]);
                                            copiedDeck.revisions[0].usage[i].revision = parseInt(id_map[j].split('-')[1]);
                                        }
                                    }
                                }
                                for(let i = 0; i < copiedDeck.revisions[0].contentItems.length; i++){
                                    let nextSlide = copiedDeck.revisions[0].contentItems[i];
                                    if(nextSlide.kind === 'slide'){
                                        let root_deck_path = [copiedDeck._id, '1'];
                                        //console.log('outside root_deck_path', root_deck_path);
                                        module.exports.addToUsage(nextSlide, root_deck_path);
                                    }
                                    else{
                                        continue;
                                    }
                                }

                                new_decks.push(copiedDeck);
                                col.insertOne(copiedDeck);
                                callback();
                            });
                        });
                    },
                    function(err2){
                        resolve({'root_deck': id_map[res.id], 'id_map': id_map});
                    });
                });
            });
        });
    },

    //checks if a new revision is needed
    needsNewRevision(deck, user){
        return self.getDeckEditors(deck).then((editorsList) => {
            if(editorsList.includes(parseInt(user))){
                //user is an editor
                return new Promise(function(resolve, reject) {
                    resolve({'target_deck': deck, 'user': user, 'needs_revision': false});
                });
            }
            else{
                //user is not an editor or owner
                return new Promise(function(resolve, reject) {
                    resolve({'target_deck': deck, 'user': user, 'needs_revision': true});
                });
            }
        });
    },

    //performs recursive revisioning up to the top-most deck that is not owned/editable by the user
    handleChange(decktree, deck, root_deck, user_id){
        if(!root_deck){
            return new Promise(function(resolve, reject) {
                //No need for recursive revisioning
                resolve();
            });
        }
        let result = findDeckInDeckTree(decktree.children, deck, [{'id': root_deck}]);
        if(root_deck === deck)
            result = [{'id': root_deck}];
        if(!result || result.length === 0){
            return new Promise(function(resolve, reject) {
                //Requested deck not found in the deck tree. If you havent defined revisions, then maybe active revisions of deck and root do not match
                resolve();
            });
        }
        result.reverse();
        let revisions = [], new_revisions = [];
        return new Promise(function(resolve, reject) {
            async.eachSeries(result, function(next_deck, callback){
                self.needsNewRevision(next_deck.id, user_id).then((needs) => {
                    if(!needs.needs_revision){
                        callback();
                    }
                    else{
                        revisions.push(next_deck);
                        callback();
                    }
                });
            },function(err){
                if(revisions.length === 0){
                    resolve({'needsRevision': false});
                }
                revisions.reverse(); //start from the innermost deck that needs revision
                async.eachSeries(revisions, function(next_needs_revision, callback){
                    //iteratively do the needed revisions
                    self.get(encodeURIComponent(next_needs_revision.id)).then((existingDeck) => {
                        let ind = existingDeck.revisions.length-1;
                        let payload = {
                            title: existingDeck.revisions[ind].title,
                            description: existingDeck.description,
                            language: existingDeck.revisions[ind].language,
                            tags: existingDeck.revisions[ind].tags,
                            license: existingDeck.license,
                            user: user_id
                        };
                        if(next_needs_revision.hasOwnProperty('parent_id')){
                            if(findWithAttrRev(revisions, 'id', next_needs_revision.parent_id) > -1){
                                return self.get(next_needs_revision.parent_id).then((existing_root_deck) => {
                                    payload.root_deck = existing_root_deck._id+'-'+existing_root_deck.active;

                                    return self.replace(encodeURIComponent(next_needs_revision.id), payload).then((replaced) => {
                                        //must update parent of next revision with new revision id

                                        return self.get(replaced.value._id).then((newDeck) => {

                                            //only update the root deck, i.e., direct parent
                                            return self.updateContentItem(newDeck, '', payload.root_deck, 'deck')
                                            .then((updated) => {
                                                new_revisions.push(newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id);
                                                callback();
                                            });
                                        });
                                    });
                                });
                            }
                            else{
                                payload.root_deck = next_needs_revision.parent_id; //NOTE parent must contain the revision number!
                                return self.replace(encodeURIComponent(next_needs_revision.id), payload).then((replaced) => {
                                    //must update parent of next revision with new revision id
                                    return self.get(replaced.value._id).then((newDeck) => {

                                        //only update the root deck, i.e., direct parent
                                        return self.updateContentItem(newDeck, '', payload.root_deck, 'deck')
                                        .then((updated) => {
                                            new_revisions.push(newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id);
                                            callback();
                                        });
                                    });
                                });
                            }
                        }
                        else{
                            return self.replace(encodeURIComponent(next_needs_revision.id), payload).then((replaced) => {
                                //must update parent of next revision with new revision id
                                return self.get(replaced.value._id).then((newDeck) => {
                                    new_revisions.push({'root_changed': newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id});
                                    callback();
                                });
                            });
                        }
                    }).catch(callback);

                },function(error){
                    if (error) return reject(error);

                    if(new_revisions.length === 0){
                        resolve({'needsRevision': false});
                    }
                    else{
                        if(new_revisions[0].hasOwnProperty('root_changed')){
                            let resp = {
                                'new_deck_id': new_revisions[0].root_changed,
                                'position': 0,
                                'root_changed' : true
                            };
                            for(let i = 0; i < new_revisions.length; i++){
                                if(!new_revisions[i].hasOwnProperty('root_changed') && new_revisions[i].split('-')[0] === deck.split('-')[0]){
                                    resp.target_deck = new_revisions[i];
                                }
                            }
                            if(deck === root_deck)
                                resp.target_deck = new_revisions[0].root_changed;

                            resp.new_revisions = new_revisions;
                            resolve(resp);
                        }
                        else{
                            let target_deck = '';
                            for(let i = 0; i < new_revisions.length; i++){
                                if(!new_revisions[i].hasOwnProperty('root_changed') && new_revisions[i].split('-')[0] === deck.split('-')[0]){
                                    target_deck = new_revisions[i];
                                }
                            }
                            self.getFlatSlidesFromDB(root_deck, undefined, true).then((flatTree) => {
                                for(let i = 0; i < flatTree.children.length; i++){
                                    if(flatTree.children[i].id === new_revisions[0]){
                                        resolve({'new_revisions': new_revisions, 'target_deck': target_deck, 'new_deck_id': flatTree.children[i].id, 'position': i+1, 'root_changed': false});
                                    }
                                }
                            });
                        }
                    }

                });
            });
        });
    }
};



function findDeckInDeckTree(decktree, deck, path){
    if (decktree) {
        for (let i = 0; i < decktree.length; i++) {

            if(decktree[i].type === 'slide')
                continue;
            if (decktree[i].id === String(deck)) {
                let npath = JSON.parse(JSON.stringify(path));
                npath.push({'id': decktree[i].id, 'parent_id': path[path.length-1].id});
                return npath;
            }
            else{
                let npath = JSON.parse(JSON.stringify(path));
                npath.push({'id': decktree[i].id, 'parent_id': path[path.length-1].id});
                let found = findDeckInDeckTree(decktree[i].children, deck, npath);
                if(found) return found;

            }
        }
    }
    else return;
}

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
    let contributorsArray = [{'user': deck.user, 'count': 1}];
    if(!deck.hasOwnProperty('tags') || deck.tags === null){
        deck.tags = [];
    }
    const result = {
        _id: deck._id,
        user: deck.user,
        timestamp: now.toISOString(),
        description: deck.description,
        translated_from: deck.translation,
        lastUpdate: now.toISOString(),
        datasource: deck.datasource,
        license: deck.license,
        contributors: contributorsArray,
        active: 1,
        revisions: [{
            id: 1,
            usage: usageArray, //create new array and insert root deck
            title: deck.title,
            timestamp: now.toISOString(),
            user: deck.user,
            language: deck.language,
            parent: deck.parent_deck,
            tags: deck.tags,
            comment: deck.comment,
            abstract: deck.abstract,
            footer: deck.footer,
            contentItems: []
        }]
    };
    return result;
}

function convertDeckWithNewRevision(deck, newRevisionId, content_items, usageArray) {
    let now = new Date();
    deck.user = parseInt(deck.user);
    if(!deck.hasOwnProperty('tags') || deck.tags === null){
        deck.tags = [];
    }
    if(deck.language === null){
        deck.language = 'en_EN';
    }
    const result = {
        description: deck.description,
        lastUpdate: now.toISOString(),
        datasource: deck.datasource,
        license: deck.license,
        active: newRevisionId,
        revisions: [{
            id: newRevisionId,
            usage: usageArray,
            title: deck.title,
            timestamp: now.toISOString(),
            user: deck.user,
            language: deck.language,
            parent: deck.parent_deck,
            tags: deck.tags,
            comment: deck.comment,
            abstract: deck.abstract,
            footer: deck.footer,
            contentItems: content_items
        }]
    };
    return result;
}

function pushIfNotExist(editorsList, toBeInserted){
    if(!editorsList.includes(toBeInserted)){
        editorsList.push(toBeInserted);
    }
}

function findWithAttr(array, attr, value) {
    for(var i = 0; i < array.length; i++) {
        if(array[i][attr] === value) {
            return i;
        }
    }
    return -1;
}

function findWithAttrRev(array, attr, value) {
    for(var i = 0; i < array.length; i++) {
        if(array[i][attr].split('-')[0] === value.split('-')[0]) {
            return i;
        }
    }
    return -1;
}
