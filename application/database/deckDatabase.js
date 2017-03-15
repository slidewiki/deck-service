'use strict';

const _ = require('lodash');
const userService = require('../services/user');

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
                let revision = found.revisions[parseInt(idArray[1])-1];
                if(typeof revision === 'undefined'){
                    console.log('Deck not found.');
                    return;
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

    // returns the deck revision subdocument, either the one specified in identifier, or the active one
    getRevision: function(identifier) {
        return self.get(identifier)
        .then((deck) => {
            // return nothing if not found
            if (!deck) return;

            // depending on the identifier format, this may have just one revision, or all revisions
            if (deck.revisions.length === 1) {
                return deck.revisions[0];
            } else {
                // we need the active revision (?)
                return deck.revisions.find((rev) => (rev.id === deck.active));
            }
        });

    },

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

    // TODO only used for accessLevel tests right now, should be removed or properly integrated 
    // once a decision re: access level is made
    _adminUpdate: function(id, deckPatch) {
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(id)})
            .then((existingDeck) => {
                if (!_.isEmpty(deckPatch.accessLevel)) {
                    existingDeck.accessLevel = deckPatch.accessLevel;
                }

                return col.findOneAndReplace({ _id: parseInt(id) }, existingDeck, { returnOriginal: false } )
                .then((updated) => updated.value);
            });

        });

    },

    // TODO properly implement a PATCH-like method for partial updates
    replaceEditors: function(id, payload) {
        let deckId = parseInt(id);

        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((decks) => {
            return decks.findOne({ _id: deckId })
            .then((existingDeck) => {
                if (!_.isEmpty(payload.editors) ) {
                    existingDeck.editors = payload.editors;
                }

                // TODO validation is BROKEN needs update here as well
                // let valid = deckModel(deckRevision);
                // if (!valid) {
                //     throw deckModel.errors;
                // }

                return decks.findOneAndReplace( { _id: deckId }, existingDeck, { returnOriginal: false });
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

                //TODO check if all attributes are used from payload
                const deckRevision = existingDeck.revisions[activeRevisionIndex];
                deckRevision.title = deck.title;
                deckRevision.language = deck.language;
                existingDeck.description = deck.description;
                existingDeck.license = deck.license;
                //add comment, abstract, footer
                deckRevision.tags = deck.tags;

                if (!_.isEmpty(deck.editors) ){
                    existingDeck.editors = deck.editors;
                }

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
                    throw e;
                }

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
                self.removeFromUsage(citems[position-1], root_deck_path);

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

    getSubdeckIds: function(deckId) {
        return self.get(deckId)
        .then((deck) => {
            // return nothing if not found
            if (!deck) return;

            let deckRevision;
            // need to read contentItems from active revision
            // depending on the identifier format, this may have just one revision, or all revisions
            if (deck.revisions.length === 1) {
                deckRevision = deck.revisions[0];
            } else {
                // we need the active revision
                deckRevision = deck.revisions.find((rev) => (rev.id === deck.active));
            }

            let currentResult = [deck._id];

            let subdeckIds = deckRevision.contentItems
            .filter((citem) => citem.kind === 'deck')
            .map((citem) => `${citem.ref.id}-${citem.ref.revision}`);

            if (subdeckIds.length) {

                // after recursively getting all the subdecks, return the list including current deck (currentResult items)
                return new Promise((resolve, reject) => {
                    async.concatSeries(
                        subdeckIds,
                        (subdeckId, callback) => {
                            self.getSubdeckIds(subdeckId)
                            .then((nestedResult) => callback(null, nestedResult));
                        },
                        (error, results) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve(currentResult.concat(results));
                            }
                        }
                    );

                });

            } else {
                // just return the current deckId
                return currentResult;
            }

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
                //console.log(deck);
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

    // return the set of contributors to the deck / revision
    getDeckEditors(deck_id, editorsList){

        let revision_id = -1;
        let decktreesplit = deck_id.split('-');
        if(decktreesplit.length > 1){
            deck_id = decktreesplit[0];
            revision_id = decktreesplit[1]-1;
        }
        //first we should check if the deck has an editors attribute and fill it accordingly
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
                        if (err) return reject(err);
                        resolve(editorsList);
                    });

                });


            });
        });
    },

    // return the set of users and groups with write access to the deck
    getDeckUsersGroups(deck, deckId) {
        // TODO change this
        // deck is optional, so if deckId is missing, `deck` holds the actual deckId
        if (deckId === undefined) {
            deckId = deck;

            return self.get(deckId)
            .then((deck) => self.getDeckUsersGroups(deck, deckId));
        }

        let accessLevel = deck.accessLevel || 'public';

        if (accessLevel === 'private') {
            return Promise.resolve({
                users: [deck.user],
                groups: [],
            });

        } else {
            // we need all contributors
            return self.getDeckEditors(deckId)
            .then((contributors) => {

                if (accessLevel === 'public' || accessLevel === 'restricted') {
                    // we now read the editors property of the deck, providing some defaults
                    let users = [], groups = [];
                    if (deck.editors) {
                        if (deck.editors.users) {
                            users = deck.editors.users;
                        }
                        if (deck.editors.groups) {
                            groups = deck.editors.groups;
                        }
                    }

                    return {
                        users: [...(new Set(users.map((u) => u.id))), ...contributors],
                        groups: groups.map((g) => g.id),
                    };

                } else {
                    throw new Error(`Unexpected accessLevel: ${accessLevel}`);
                }

            });

        }

    },

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
            console.log('flatDeckArray', flatDeckArray);

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
                        console.log('next_deck', next_deck);
                        return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
                        .then((db2) => db2.collection('decks'))
                        .then((col) => {
                            col.findOne({_id: parseInt(next_deck.split('-')[0])})
                            .then((found) => {
                                let ind = parseInt(next_deck.split('-')[1])-1;
                                let copiedDeck = {
                                    _id: id_noRev_map[found._id],
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
                                copiedDeck.revisions[0].parent = next_deck.split('-')[0]+'-'+next_deck.split('-')[1];
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

    forkAllowed(deckId, userId) {
        userId = parseInt(userId);
        return self.get(deckId).then((deck) => {
            // next, we need to check the accessLevel, defaults to 'public'
            let accessLevel = deck.accessLevel || 'public';

            if (accessLevel === 'private') {
                // no-one but the deck owner can fork it!!
                return deck.user === userId;
            }

            // any other access level means you can fork it always
            return true;
        });
    },

    // this is now equivalent to needsNewRevision === false, as authorized users can now save a deck with or without revision regardless
    // unauthorized users are not allowed to save with revision, but they will be allowed to fork with new copy mechanism
    editAllowed(deckId, userId) {
        return self.needsNewRevision(deckId, userId)
        .then((needs) => (needs.needs_revision === false));
    },

    needsNewRevision(deckId, user){
        let userId = parseInt(user);

        return self.get(deckId)
        .then((deck) => {
            if (!deck) return;

            // set the admin role permission
            let adminAllowed = (deck.user === userId);

            // default is public
            let accessLevel = deck.accessLevel || 'public';

            return self.getDeckUsersGroups(deck, deckId)
            .then((editors) => {
                if (editors.users.includes(userId)) {
                    // user is an editor
                    return {'target_deck': deckId, 'user': user, 'needs_revision': false, 'admin_allowed': adminAllowed };
                } else {
                    // we also need to check if the groups allowed to edit the deck include the user
                    return userService.fetchUsersForGroups(editors.groups).then((groupsUsers) => {

                        if (groupsUsers.includes(userId)) {
                            // user is an editor
                            return {'target_deck': deckId, 'user': user, 'needs_revision': false, 'admin_allowed': adminAllowed };
                        } else {
                            // user is not an editor or owner
                            // also return if user can fork the deck (e.g. if it's public)
                            return {'target_deck': deckId, 'user': user, 'needs_revision': true, 'fork_allowed': (accessLevel !== 'private'), 'admin_allowed': adminAllowed };
                        }

                    }).catch((err) => {
                        console.warn(`could not fetch usergroup info from service: ${err.message}`);
                        // we're not sure, let's just not allow this user
                        return {'target_deck': deckId, 'user': user, 'needs_revision': true, 'fork_allowed': (accessLevel !== 'private'), 'admin_allowed': adminAllowed };
                    });
                }
            });
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
                self.needsNewRevision(next_deck.id, user_id).then((needs) => {
                    //console.log(needs);
                    if (!needs.needs_revision) {
                        // HACK we return the needs response as an error to break the series
                        callback(needs);
                    } else if (!needs.fork_allowed) {
                        // cannot edit this at all!
                        // HACK we return the needs response as an error to break the series
                        callback(needs);
                    } else {
                        revisions.push(next_deck);
                        callback();
                    }
                });
            },function(err){
                if (err) {
                    // err is needs result; means that either:
                    // a) we've reached a deck we can't edit at all (fork_allowed: false)
                    // b) we've reached a deck we can save without new revision (needs_revision: false)

                    if (err.needs_revision && !err.fork_allowed) {
                        // we cannot edit the deck! resolve the promise and inform caller of this
                        return resolve({ needs_revision: true, fork_allowed: false });
                    }
                    // else continue as normal
                    console.log(`stopped handleChange after reaching a deck we can save without new revision ${JSON.stringify(err)}`);
                }
                //console.log('revisions array', revisions);
                if(revisions.length === 0){
                    resolve({needs_revision: false});
                }
                revisions.reverse(); //start from the innermost deck that needs revision
                async.eachSeries(revisions, function(next_needs_revision, callback){
                    //iteratively do the needed revisions
                    //console.log('next_needs_revision', next_needs_revision);
                    self.get(encodeURIComponent(next_needs_revision.id)).then((existingDeck) => {
                        let ind = existingDeck.revisions.length-1;
                        let payload = {
                            title: existingDeck.revisions[ind].title,
                            description: existingDeck.description,
                            language: existingDeck.revisions[ind].language,
                            tags: existingDeck.revisions[ind].tags,
                            license: existingDeck.license,
                            user: user_id,
                            editors: existingDeck.editors,
                        };
                        if(next_needs_revision.hasOwnProperty('parent_id')){
                            if(findWithAttrRev(revisions, 'id', next_needs_revision.parent_id) > -1){
                                return self.get(next_needs_revision.parent_id).then((existing_root_deck) => {
                                    payload.root_deck = existing_root_deck._id+'-'+existing_root_deck.active;
                                    //console.log('will be updated with parent', payload.root_deck);
                                    return self.replace(encodeURIComponent(next_needs_revision.id), payload).then((replaced) => {
                                        //must update parent of next revision with new revision id
                                        //console.log('updated ', replaced);
                                        //NOTE must update content items of parent
                                        return self.get(replaced.value._id).then((newDeck) => {

                                            //only update the root deck, i.e., direct parent
                                            return self.updateContentItem(newDeck, '', payload.root_deck, 'deck')
                                            .then((updated) => {
                                                new_revisions.push(newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id);
                                                //new_revisions[0]=newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id;
                                                callback();
                                            });
                                        });
                                    });
                                });
                                //payload.root_deck = next_needs_revision.parent_id.split('-')[0];
                            }
                            else{
                                payload.root_deck = next_needs_revision.parent_id; //NOTE parent must contain the revision number!
                                //console.log('will be updated with parent', payload.root_deck);
                                return self.replace(encodeURIComponent(next_needs_revision.id), payload).then((replaced) => {
                                    //must update parent of next revision with new revision id
                                    //console.log('updated ', replaced);
                                    //NOTE must update content items of parent
                                    return self.get(replaced.value._id).then((newDeck) => {

                                        //only update the root deck, i.e., direct parent
                                        return self.updateContentItem(newDeck, '', payload.root_deck, 'deck')
                                        .then((updated) => {
                                            new_revisions.push(newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id);
                                            //new_revisions[0]=newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id;
                                            callback();
                                        });
                                    });
                                });
                            }
                        }
                        else{
                            return self.replace(encodeURIComponent(next_needs_revision.id), payload).then((replaced) => {
                                //must update parent of next revision with new revision id
                                //console.log('updated ', replaced);
                                return self.get(replaced.value._id).then((newDeck) => {
                                    new_revisions.push({'root_changed': newDeck._id+'-'+newDeck.revisions[newDeck.revisions.length-1].id});
                                    callback();
                                });
                            });
                        }
                    }).catch(callback);

                },function(error){
                    if (error) return reject(error);

                    //console.log('final revisions', revisions);
                    //console.log('new revisions', new_revisions);
                    if(new_revisions.length === 0){
                        resolve({'needs_revision': false});
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
    if(deck.hasOwnProperty('editors') && deck.editors === null){
        deck.editors = {users: [], groups: []};
    }
    else if(!deck.hasOwnProperty('editors')){
        deck.editors = {users: [], groups: []};
    }
    //should we have a default accessLevel?
    const result = {
        _id: deck._id,
        user: deck.user,
        accessLevel: deck.accessLevel,
        editors: deck.editors,
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
            contentItems: [],
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
    if(deck.hasOwnProperty('editors') && deck.editors === null){
        deck.editors = {users: [], groups: []};
    }
    else if(!deck.hasOwnProperty('editors')){
        deck.editors = {users: [], groups: []};
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

        accessLevel: deck.accessLevel,
        editors: deck.editors,

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
            contentItems: content_items,
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
