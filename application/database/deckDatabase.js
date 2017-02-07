'use strict';

const ChangeLog = require('../lib/ChangeLog');

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
            if(parsed.length === 1 || idArray[1] === ''){
                return found;
            }
            else{
                // let revision = found.revisions[parseInt(parsed[1])-1];
                // revision.id = identifier;
                // revision.kind = 'deck';
                // return revision;
                let revision = found.revisions[parseInt(idArray[1])-1];
                if(typeof revision === 'undefined'){
                    console.log('Deck not found.');
                    console.log('err', err);
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

                // start tracking changes
                let deckTracker = ChangeLog.deckTracker(existingDeck, activeRevisionIndex);

                const deckRevision = existingDeck.revisions[activeRevisionIndex];
                deckRevision.title = deck.title;
                deckRevision.language = deck.language;
                existingDeck.description = deck.description;
                existingDeck.license = deck.license;
                //add comment, abstract, footer
                deckRevision.tags = deck.tags;
                existingDeck.revisions[activeRevisionIndex] = deckRevision;

                // changes ended here
                deckTracker.applyChangeLog();

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
            let revisionIndex = deck_id.split('-')[1] - 1;

            // start tracking changes
            let deckTracker = ChangeLog.deckTracker(deck, revisionIndex);

            deck.revisions[revisionIndex].title = newName;

            // changes ended here
            deckTracker.applyChangeLog();

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
                    // let root_deck_array = deck.root_deck.split('-');
                    // if(root_deck_array.length === 1){
                    //     root_deck_array.push(getActiveRevision(existingRootDeck));
                    // }
                    for(let i = 0; i < previousUsageArray.length; i++){
                        if(previousUsageArray[i].id === parseInt(deck.root_deck.split('-')[0]) && previousUsageArray[i].revision === parseInt(deck.root_deck.split('-')[1])){
                            previousUsageArray.splice(i,1);
                            break;
                        }
                    }
                    usageArray = [{'id':parseInt(deck.root_deck.split('-')[0]), 'revision': parseInt(deck.root_deck.split('-')[1])}];
                }

                let content_items = existingDeck.revisions[activeRevisionIndex].contentItems;
                // for(let i = 0; i < content_items.length; i++){
                //     content_items[i].order = parseInt(content_items[i].order);
                // }
                //let usageArray = existingDeck.revisions[activeRevisionIndex].usage;
                //console.log('content_items', content_items);
                //console.log('usageArray', usageArray);
                if(deck.fork){
                    usageArray = [];
                }

                const deckWithNewRevision = convertDeckWithNewRevision(deck, newRevisionId, content_items, usageArray);
                deckWithNewRevision.timestamp = existingDeck.timestamp;
                deckWithNewRevision.user = existingDeck.user;
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
                    // let new_metadata = deckWithNewRevision;
                    // delete new_metadata.revisions;
                    // console.log(new_revisions);
                    deckWithNewRevision.revisions = new_revisions;

                    //col.save(existingDeck);
                    return col.findOneAndUpdate({
                        _id: parseInt(id)
                    //}, { $push: { revisions: slideWithNewRevision.revisions[0] } }, {new: true});
                    }, { $set: deckWithNewRevision }, {new: true});
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
                // let itemId = citems[position-1].ref.id;
                // let itemRevision = citems[position-1].ref.revision;
                //
                // if(citems[position-1].kind === 'slide'){
                //     helper.connectToDatabase()
                //     .then((db) => db.collection('slides'))
                //     .then((col2) => {
                //         col2.findOne({_id: parseInt(itemId)})
                //         .then((foundSlide) => {
                //             let oldUsage = foundSlide.revisions[itemRevision-1].usage;
                //             for(let i = 0; i < oldUsage.length; i++){
                //                 if(oldUsage[i].id === parseInt(root_deck_path[0]) && oldUsage[i].revision === parseInt(root_deck_path[1])){
                //                     oldUsage.splice(i,1);
                //                     break;
                //                 }
                //             }
                //             foundSlide.revisions[itemRevision-1].usage = oldUsage;
                //             col2.save(foundSlide);
                //         });
                //
                //     });
                // }
                // else{
                //
                //     col.findOne({_id: parseInt(itemId)})
                //     .then((foundDeck) => {
                //         let oldUsage = foundDeck.revisions[itemRevision-1].usage;
                //         for(let i = 0; i < oldUsage.length; i++){
                //             if(oldUsage[i].id === parseInt(root_deck_path[0]) && oldUsage[i].revision === parseInt(root_deck_path[1])){
                //                 oldUsage.splice(i,1);
                //                 break;
                //             }
                //         }
                //         foundDeck.revisions[itemRevision-1].usage = oldUsage;
                //         col.save(foundDeck);
                //
                //     });
                // }
                module.exports.removeFromUsage(citems[position-1], root_deck_path);

                citems.splice(position-1, 1);
                existingDeck.revisions[activeRevisionId-1].contentItems = citems;
                col.save(existingDeck);

            });
        });
    },

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


            }).catch((err) => {
                console.log('Deck not found');
                console.log('err', err);
            });
        });
    },

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
                //console.log(deck);
                if(revision_id === -1){
                    revision_id = deck.active-1;
                }
                if(!deckTree){
                    deckTree = { title: deck.revisions[revision_id].title, id: deck_id+'-'+(revision_id+1), type: 'deck', user: String(deck.revisions[revision_id].user), children: []};
                }
                //TODO Darya: do not call revisions by a key, but by id!!!
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
                                module.exports.getFlatSlidesFromDB(innerDeck._id+'-'+citem.ref.revision, deckTree, return_decks)
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
    },

    forkDeckRevision(deck){
        module.exports.get(encodeURIComponent(deck.id)).then((existingDeck) => {
            let ind = existingDeck.revisions.length-1;
            let payload = {
                title: existingDeck.revisions[ind].title,
                description: existingDeck.description,
                language: existingDeck.revisions[ind].language,
                tags: existingDeck.revisions[ind].tags,
                license: existingDeck.license,
                user: request.payload.user,
                fork: true
            };
            module.exports.replace(encodeURIComponent(deck.id), payload).then((replaced) => {
                if (co.isEmpty(replaced.value))
                    throw replaced;
                else{
                    return replaced;
                }
            }).catch((error) => {
                request.log('error', error);
                reply(boom.badImplementation());
            });
        });
    },

    needsNewRevision(deck, user){
        return module.exports.getDeckEditors(deck).then((editorsList) => {
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

    handleChange(decktree, deck, root_deck, user_id){
        if(!root_deck){
            return new Promise(function(resolve, reject) {
                console.log('No need for recursive revisioning');
                resolve();
            });
        }
        let result = findDeckInDeckTree(decktree.children, deck, [{'id': root_deck}]);
        if(root_deck === deck)
            result = [{'id': root_deck}];
        if(!result || result.length === 0){
            return new Promise(function(resolve, reject) {
                console.log('Requested deck not found in the deck tree. If you havent defined revisions, then maybe active revisions of deck and root do not match');
                resolve();
            });
        }
        //result.push({'id': deck);
        //console.log('result', result);
        result.reverse();
        let revisions = [], new_revisions = [];
        return new Promise(function(resolve, reject) {
            async.eachSeries(result, function(next_deck, callback){
                module.exports.needsNewRevision(next_deck.id, user_id).then((needs) => {
                    //console.log(needs);
                    if(!needs.needs_revision){
                        callback();
                    }
                    else{
                        revisions.push(next_deck);
                        callback();
                    }
                });
            },function(err){
                //console.log('revisions array', revisions);
                if(revisions.length === 0){
                    resolve({'needsRevision': false});
                }
                revisions.reverse(); //start from the innermost deck that needs revision
                async.eachSeries(revisions, function(next_needs_revision, callback){
                    //iteratively do the needed revisions
                    //console.log('next_needs_revision', next_needs_revision);
                    module.exports.get(encodeURIComponent(next_needs_revision.id)).then((existingDeck) => {
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
                                module.exports.get(next_needs_revision.parent_id).then((existing_root_deck) => {
                                    payload.root_deck = existing_root_deck._id+'-'+existing_root_deck.active;
                                    //console.log('will be updated with parent', payload.root_deck);
                                    module.exports.replace(encodeURIComponent(next_needs_revision.id), payload).then((replaced) => {
                                        //must update parent of next revision with new revision id
                                        //console.log('updated ', replaced);
                                        //NOTE must update content items of parent
                                        module.exports.get(replaced.value._id).then((newDeck) => {

                                            //only update the root deck, i.e., direct parent
                                            module.exports.updateContentItem(newDeck, '', payload.root_deck, 'deck')
                                            .then((updated) => {
                                                new_revisions.push(newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id);
                                                //new_revisions[0]=newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id;
                                                callback();
                                            });
                                        });
                                    }).catch((error) => {
                                        console.log('error', error);
                                        //reply(boom.badImplementation());
                                    });
                                });
                                //payload.root_deck = next_needs_revision.parent_id.split('-')[0];
                            }
                            else{
                                payload.root_deck = next_needs_revision.parent_id; //NOTE parent must contain the revision number!
                                //console.log('will be updated with parent', payload.root_deck);
                                module.exports.replace(encodeURIComponent(next_needs_revision.id), payload).then((replaced) => {
                                    //must update parent of next revision with new revision id
                                    //console.log('updated ', replaced);
                                    //NOTE must update content items of parent
                                    module.exports.get(replaced.value._id).then((newDeck) => {

                                        //only update the root deck, i.e., direct parent
                                        module.exports.updateContentItem(newDeck, '', payload.root_deck, 'deck')
                                        .then((updated) => {
                                            new_revisions.push(newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id);
                                            //new_revisions[0]=newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id;
                                            callback();
                                        });
                                    });
                                }).catch((error) => {
                                    console.log('error', error);
                                    //reply(boom.badImplementation());
                                });
                            }
                        }
                        else{
                            module.exports.replace(encodeURIComponent(next_needs_revision.id), payload).then((replaced) => {
                                //must update parent of next revision with new revision id
                                //console.log('updated ', replaced);
                                module.exports.get(replaced.value._id).then((newDeck) => {
                                    new_revisions.push({'root_changed': newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id});
                                    callback();
                                });
                            }).catch((error) => {
                                console.log('error', error);
                            });
                        }
                    });

                },function(error){
                    //console.log('final revisions', revisions);
                    //console.log('new revisions', new_revisions);
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
                            //console.log('resp', resp);
                            resolve(resp);
                        }
                        else{
                            //console.log(new_revisions);
                            let target_deck = '';
                            for(let i = 0; i < new_revisions.length; i++){
                                if(!new_revisions[i].hasOwnProperty('root_changed') && new_revisions[i].split('-')[0] === deck.split('-')[0]){
                                    target_deck = new_revisions[i];
                                }
                            }
                            module.exports.getFlatSlidesFromDB(root_deck, undefined, true).then((flatTree) => {
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
            //console.log(decktree[i]);
            if (decktree[i].id === String(deck)) {
                let npath = JSON.parse(JSON.stringify(path));
                npath.push({'id': decktree[i].id, 'parent_id': path[path.length-1].id});
                return npath;
            }
            else{
                let npath = JSON.parse(JSON.stringify(path));
                npath.push({'id': decktree[i].id, 'parent_id': path[path.length-1].id});
                //console.log(path);
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
//
// function convertDeck(deck) {
//     let now = new Date();
//     return {
//         user: deck.user,
//         deck: deck.root_deck,
//         timestamp: now,
//         lastUpdate: now,
//         license: deck.license,
//         revisions: [{
//             title: deck.title,
//             timestamp: now,
//             user: deck.user,
//             visibility: false,
//             contentItems: deck.content_items
//         }]
//     };
// }

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
        //deck: deck.root_deck,
        //kind: 'deck',
        timestamp: now.toISOString(),
        //language: deck.language,
        description: deck.description,
        translated_from: deck.translation,
        //translations: deck.translations,
        lastUpdate: now.toISOString(),
        datasource: deck.datasource,
        license: deck.license,
        contributors: contributorsArray,
        //tags: deck.tags,
        active: 1,
        revisions: [{
            id: 1,
            usage: usageArray, //create new array and insert root deck
            title: deck.title,
            timestamp: now.toISOString(),
            user: deck.user,
            language: deck.language,
            //license: deck.license,
            parent: deck.parent_deck,
            tags: deck.tags,
            comment: deck.comment,
            abstract: deck.abstract,
            footer: deck.footer,
            contentItems: []
        }]
    };
    //console.log('from', slide, 'to', result);
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
        //user: deck.user,
        //deck: deck.root_deck,
        //timestamp: deck.timestamp,
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
    //console.log('from', slide, 'to', result);
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
