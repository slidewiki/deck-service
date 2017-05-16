'use strict';

const _ = require('lodash');
const util = require('../lib/util');

const ChangeLog = require('../lib/ChangeLog');

const userService = require('../services/user');

const helper = require('./helper'),
    striptags = require('striptags'),
    validateDeck = require('../models/deck').validateDeck;

let async = require('async');

let self = module.exports = {
    //gets a specified deck and all of its revision, or only the given revision
    get: function(identifier) {
        identifier = String(identifier);
        let idArray = identifier.split('-');
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => col.findOne({ _id: parseInt(idArray[0]) }))
        .then((found) => {
            if (!found) return;

            // add some extra revision metadata
            let [latestRevision] = found.revisions.slice(-1);
            found.latestRevisionId = latestRevision.id;

            let parsed = identifier.split('-');
            if(parsed.length === 1 || idArray[1] === ''){
                // this is the requested revision, if not set it is the 'active' revision
                found.revisionId = found.active;
                return found;
            }
            else{
                // this is the requested revision
                found.revisionId = parseInt(idArray[1]);

                let revision = found.revisions[parseInt(idArray[1])-1];
                if(typeof revision === 'undefined'){
                    return;
                }
                else{
                    found.revisions = [revision];
                    return found;
                }
            }
        });

    },

    // TODO
    // this could likely replace #get as it returns a more uniform data structure,
    // only with the requested revision data merged into a single object
    getDeck: function(identifier) {
        let [deckId, revisionId] = identifier.split('-').map(parseInt);

        return self.get(deckId).then((deck) => {
            if (!deck) return;

            if (!revisionId) {
                // if not set, we are looking at the active one
                revisionId = deck.active;
            }

            let deckRevision = deck.revisions.find((r) => (r.id === revisionId));
            if (!deckRevision) return; // revision not found

            // add some extra revision metadata
            deck.revisionId = revisionId;

            let [latestRevision] = deck.revisions.slice(-1);
            deck.latestRevisionId = latestRevision.id;

            return _.merge(deck, deckRevision);
        });

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

    count: (collection, query) => {
        return helper.connectToDatabase()
        .then((db) => db.collection(collection))
        .then((col) => col.count(query));
    },

    // return a path array of deckId as it exists in the tree with rootDeckId as root
    // returns first occurence of deckId, or nothing if cannot find the path
    findPath: function(sourceDeckId, targetDeckId, path) {
        let source = util.parseIdentifier(sourceDeckId);
        let target = util.parseIdentifier(targetDeckId);

        // HACK force error if target does not include revision
        target.revision;

        return self.getRevision(sourceDeckId).then((sourceRevision) => {
            // source deck not found
            if (!sourceRevision) return;

            // path should be canonical, so we need the revision to be defined
            source.revision = sourceRevision.id;

            if (!path) {
                path = [source];

                // return if source is same as target
                if (_.isEqual(source, target)) return path;
            }

            // expand all subdecks
            let subPaths = [];
            // we use #some so that `return true` breaks (means we found the target) and `return` continues
            let foundTarget = sourceRevision.contentItems.some((citem, index) => {
                // skip slides
                if (citem.kind !== 'deck') return; // continue

                // each subdeck expands the base path, we keep separate paths for each subdeck
                subPaths.push(path.concat(_.assign({index}, citem.ref)));

                // also check if target deck is direct child and break
                if (_.isEqual(citem.ref, target)) return true;
            });

            // target is child of source
            if (foundTarget) {
                // the last subPath added is the path to target (because we did break in previous loop)
                return subPaths.slice(-1)[0];
            }

            // if no further subdecks are here we just return empty (dead-end)
            if (subPaths.length === 0) return;

            // otherwise we search down
            return new Promise((resolve, reject) => {
                async.concatSeries(subPaths, (subPath, callback) => {
                    // the sub deck is the last element in the path
                    let [nextSource] = subPath.slice(-1);
                    let subDeckId = `${nextSource.id}-${nextSource.revision}`;

                    self.findPath(subDeckId, targetDeckId, subPath)
                    .then((result) => callback(null, result))
                    .catch(callback);

                }, (error, results) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(results);
                    }
                });
            });

        });

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
                    valid = validateDeck(convertedDeck);
                    if (!valid) {
                        throw validateDeck.errors;
                    }

                    return col.insertOne(convertedDeck);
                } catch (e) {
                    console.log('validation failed', e);
                    throw e;
                }
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

    // same as replaceEditors, but applied to all subdecks under deck `id`
    deepReplaceEditors: function(deckId, payload) {
        // getSubdeckIds includes self (deckId)
        return self.getSubdeckIds(deckId)
        .then((subdeckIds) => {
            if (!subdeckIds) return;

            return new Promise((resolve, reject) => {
                async.eachSeries(subdeckIds, (subdeckId, done) => {
                    // #replaceEditors accepts string for deck id
                    self.replaceEditors(subdeckId.toString(), payload)
                    .then((replaced) => {
                        if (replaced.ok !== 1) {
                            done(replaced);
                        } else {
                            done();
                        }
                    })
                    .catch(done);

                }, (error) => {
                    if (error) {
                        reject(error);
                    }  else {
                        resolve();
                    }
                });
            });
        });
    },

    //updates a deck's metadata when no new revision is needed
    update: function(id, deck) {
        // if not included in the call, the deck itself is the top_root_deck
        let top_root_deck = deck.top_root_deck || id;

        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(id)})
            .then((existingDeck) => {
                if (!existingDeck) return;

                let idArray = id.split('-');
                let activeRevisionIndex ;
                if(idArray.length > 1){
                    activeRevisionIndex = parseInt(idArray[1])-1;
                }
                else{
                    activeRevisionIndex = getActiveRevision(existingDeck);
                }

                // start tracking changes
                let deckTracker = ChangeLog.deckTracker(existingDeck, top_root_deck, deck.user);

                //TODO check if all attributes are used from payload
                const deckRevision = existingDeck.revisions[activeRevisionIndex];
                deckRevision.title = deck.title;
                deckRevision.language = deck.language;
                existingDeck.description = deck.description;
                existingDeck.license = deck.license;
                //add comment, abstract, footer
                deckRevision.tags = deck.tags;

                if(!deck.hasOwnProperty('theme') || deck.theme === null){
                    deckRevision.theme = 'default';
                }
                else{
                    deckRevision.theme = deck.theme;
                }

                // changes ended here
                deckTracker.applyChangeLog();

                // lastUpdated update
                existingDeck.lastUpdate = (new Date()).toISOString();
                deckRevision.lastUpdate = existingDeck.lastUpdate;
                if (!_.isEmpty(deck.editors) ){
                    existingDeck.editors = deck.editors;
                }

                if(existingDeck.hasOwnProperty('contributors')){
                    let contributors = existingDeck.contributors;
                    let existingUserContributorIndex = findWithAttr(contributors, 'user', parseInt(deck.user));
                    if(existingUserContributorIndex > -1)
                        contributors[existingUserContributorIndex].count++;
                    else{
                        contributors.push({'user': parseInt(deck.user), 'count': 1});
                    }
                    existingDeck.contributors = contributors;
                }
                if (!validateDeck(deckRevision)) {
                    throw validateDeck.errors;
                }

                return col.findOneAndReplace({ _id: parseInt(id) }, existingDeck, { returnOriginal: false });
            });
        });
    },

    //renames a deck
    rename: function(deck_id, newName, top_root_deck, user){
        // if not included in the call, the deck itself is the top_root_deck
        top_root_deck = top_root_deck || deck_id;

        let deckId = deck_id.split('-')[0];
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => col.findOne({_id: parseInt(deckId)})
        .then((deck) => {
            if (!deck) return;

            let revisionIndex = deck_id.split('-')[1] - 1;
            let deckRevision = deck.revisions[revisionIndex];
            if (!deckRevision) return;

            // start tracking changes
            let deckTracker = ChangeLog.deckTracker(deck, top_root_deck, user);

            deckRevision.title = newName;

            // changes ended here
            deckTracker.applyChangeLog();

            // lastUpdated update
            deck.lastUpdate = (new Date()).toISOString();
            deckRevision.lastUpdate = deck.lastUpdate;

            return col.findOneAndReplace({_id: parseInt(deckId)}, deck);
        }));
    },

    //updates a deck by creating a new revision
    replace: function(id, deck) {
        // if not included in the call, the deck itself is the top_root_deck
        let top_root_deck = deck.top_root_deck || id;

        let idArray = String(id).split('-');
        if(idArray.length > 1){
            id = idArray[0];
        }
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(id)})
            .then((existingDeck) => {
                if (!existingDeck) return;

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
                    let root_deck_array = deck.root_deck.split('-');
                    for(let i = 0; i < previousUsageArray.length; i++){
                        if(previousUsageArray[i].id === parseInt(root_deck_array[0]) && previousUsageArray[i].revision === parseInt(root_deck_array[1])){
                            previousUsageArray.splice(i,1);
                            break;
                        }
                    }
                    usageArray = [{'id':parseInt(root_deck_array[0]), 'revision': parseInt(root_deck_array[1])}];
                }

                let content_items = existingDeck.revisions[activeRevisionIndex].contentItems;
                if(deck.fork){
                    usageArray = [];
                }

                const deckWithNewRevision = convertDeckWithNewRevision(deck, newRevisionId, content_items, usageArray);
                deckWithNewRevision.timestamp = existingDeck.timestamp;

                // TODO remove this once migration process is fixed and/or revised
                if (deckWithNewRevision.timestamp instanceof Date) deckWithNewRevision.timestamp = deckWithNewRevision.timestamp.toISOString();

                deckWithNewRevision.user = existingDeck.user;

                if (existingDeck.origin) {
                    deckWithNewRevision.origin = existingDeck.origin;
                }

                if(existingDeck.hasOwnProperty('contributors')){
                    let contributors = existingDeck.contributors;
                    let existingUserContributorIndex = findWithAttr(contributors, 'user', parseInt(deck.user));
                    if(existingUserContributorIndex > -1)
                        contributors[existingUserContributorIndex].count++;
                    else{
                        contributors.push({'user': parseInt(deck.user), 'count': 1});
                    }
                    deckWithNewRevision.contributors = contributors;
                }

                try {
                    valid = validateDeck(deckWithNewRevision);

                    if (!valid) {
                        throw validateDeck.errors;
                    }
                    for(let i = 0; i < content_items.length; i++){
                        let citem = content_items[i];
                        if(citem.kind === 'slide'){
                            helper.connectToDatabase()
                            .then((db) => db.collection('slides'))
                            .then((col) => {
                                return col.findOne({_id: parseInt(citem.ref.id)})
                                .then((slide) => {
                                    slide.revisions[citem.ref.revision-1].usage.push({'id': parseInt(id), 'revision': newRevisionId});
                                    return col.save(slide);
                                });
                            });
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {
                                innerDeck.revisions[citem.ref.revision-1].usage.push({'id': parseInt(id), 'revision': newRevisionId});
                                return col.save(innerDeck);
                            });
                        }
                    }
                    let deckTracker = ChangeLog.deckTracker(existingDeck, top_root_deck, deck.user);

                    let new_revisions = existingDeck.revisions;
                    new_revisions[activeRevisionIndex].usage = previousUsageArray;
                    new_revisions.push(deckWithNewRevision.revisions[0]);
                    deckWithNewRevision.revisions = new_revisions;

                    deckTracker.applyChangeLog(deckWithNewRevision);

                    //col.save(existingDeck);
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
    insertNewContentItem: function(citem, position, root_deck, ckind, citem_revision_id, top_root_deck, user){
        // if top_root_deck is missing, root_deck is the top
        if (!top_root_deck) top_root_deck = root_deck;

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

                let deckTracker = ChangeLog.deckTracker(existingDeck, top_root_deck, user);
                // copy edit rights from existingDeck to new
                if (ckind === 'deck') {
                    let attachedDeckId = `${parseInt(citem.id)}-${citem_revision_id}`;
                    self.get(attachedDeckId).then(() => {
                        return self.deepReplaceEditors(attachedDeckId, { editors: existingDeck.editors });
                    }).catch((err) => {
                        console.warn(`could not properly set edit rights for ${attachedDeckId} when adding it to ${root_deck}; error was: ${err}`);
                    });
                }
                // TODO some async updates happening here, need to handle errors to avoid data corruption

                if(existingDeck.hasOwnProperty('contributors')){
                    let revIndex = 0;
                    if(citem.revisions.length > 1){
                        revIndex = parseInt(citem_revision_id)-1;
                    }
                    let contributors = existingDeck.contributors;
                    let existingUserContributorIndex = findWithAttr(contributors, 'user', parseInt(citem.revisions[revIndex].user));
                    if(existingUserContributorIndex > -1)
                        contributors[existingUserContributorIndex].count++;
                    else{
                        contributors.push({'user': parseInt(citem.revisions[revIndex].user), 'count': 1});
                    }
                    existingDeck.contributors = contributors;
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

                    deckTracker.applyChangeLog();

                    col.save(existingDeck);
                }
                else{
                    // add it to the end
                    // we need to track stuff, this doesn't help
                    let citems = existingDeck.revisions[activeRevisionId-1].contentItems;
                    let newCitem = {
                        order: parseInt(getOrder(existingDeck.revisions[activeRevisionId-1]))+1,
                        kind: ckind,
                        ref : {
                            id: parseInt(citem.id),
                            revision:citem_revision_id
                        }
                    };
                    citems.push(newCitem);
                    existingDeck.revisions[activeRevisionId-1].contentItems = citems;

                    deckTracker.applyChangeLog();

                    col.save(existingDeck);

                    // TODO dead code
                    return;

                    // we need to track stuff, this doesn't help
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
                            },
                            $set: {
                                'contributors': existingDeck.contributors
                            }
                        }
                    );
                }
            });
        });

    },

    //removes (unlinks) a content item from a given deck
    removeContentItem: function(position, root_deck, top_root_deck, userId){
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

                let deckTracker = ChangeLog.deckTracker(existingDeck, top_root_deck, userId);

                let citems = existingDeck.revisions[activeRevisionId-1].contentItems;
                for(let i = position-1; i < citems.length; i++){
                    citems[i].order = citems[i].order-1;
                }
                self.removeFromUsage(citems[position-1], root_deck_path);

                citems.splice(position-1, 1);
                existingDeck.revisions[activeRevisionId-1].contentItems = citems;

                deckTracker.applyChangeLog();

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
                return col2.findOne({_id: parseInt(itemId)})
                .then((foundSlide) => {
                    let oldUsage = foundSlide.revisions[itemRevision-1].usage;
                    for(let i = 0; i < oldUsage.length; i++){
                        if(oldUsage[i].id === parseInt(root_deck_path[0]) && oldUsage[i].revision === parseInt(root_deck_path[1])){
                            oldUsage.splice(i,1);
                            break;
                        }
                    }
                    foundSlide.revisions[itemRevision-1].usage = oldUsage;
                    return col2.save(foundSlide);
                });

            });
        }
        else{
            helper.connectToDatabase()
            .then((db) => db.collection('decks'))
            .then((col) => {
                return col.findOne({_id: parseInt(itemId)})
                .then((foundDeck) => {
                    let oldUsage = foundDeck.revisions[itemRevision-1].usage;
                    for(let i = 0; i < oldUsage.length; i++){
                        if(oldUsage[i].id === parseInt(root_deck_path[0]) && oldUsage[i].revision === parseInt(root_deck_path[1])){
                            oldUsage.splice(i,1);
                            break;
                        }
                    }
                    foundDeck.revisions[itemRevision-1].usage = oldUsage;
                    return col.save(foundDeck);

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
            return helper.connectToDatabase()
            .then((db) => db.collection('slides'))
            .then((col2) => {
                return col2.findOneAndUpdate(
                    {_id: parseInt(itemId), 'revisions.id':itemRevision},
                    {$push: {'revisions.$.usage': usageToPush}}
                );
            });
        }
        else{
            return helper.connectToDatabase()
            .then((db) => db.collection('decks'))
            .then((col2) => {
                return col2.findOneAndUpdate(
                    {_id: parseInt(itemId), 'revisions.id':itemRevision},
                    {$push: {'revisions.$.usage': usageToPush}}
                );
            });
        }
    },

    //updates an existing content item's revision
    updateContentItem: function(citem, revertedRevId, root_deck, ckind, top_root_deck, user){ //can be used for reverting or updating
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

                // pre-compute what the for loop does
                let deckTracker = ChangeLog.deckTracker(existingDeck, top_root_deck, user);

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
                deckTracker.applyChangeLog();
                if(existingDeck.hasOwnProperty('contributors')){
                    let revIndex = 0;
                    if(citem.revisions.length > 1){
                        revIndex = parseInt(newRevId)-1;
                    }
                    let contributors = existingDeck.contributors;
                    let existingUserContributorIndex = findWithAttr(contributors, 'user', parseInt(citem.revisions[revIndex].user));
                    if(existingUserContributorIndex > -1)
                        contributors[existingUserContributorIndex].count++;
                    else{
                        contributors.push({'user': parseInt(citem.revisions[revIndex].user), 'count': 1});
                    }
                    existingDeck.contributors = contributors;
                }
                col.save(existingDeck);
                return {'old_revision': old_rev_id, 'new_revision': newRevId};
            });
        });
    },

    //reverts a deck's active revision to a new given one
    revert: function(deck_id, deck){
        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            let targetRevisionIndex = parseInt(deck.revision_id)-1;
            return col.findOne({_id: parseInt(deck_id)})
            .then((existingDeck) => {
                let targetRevision = existingDeck.revisions[targetRevisionIndex];
                let now = (new Date()).toISOString();
                targetRevision.timestamp = now;
                targetRevision.lastUpdate = now;

                targetRevision.user = parseInt(deck.user);

                targetRevision.id = existingDeck.revisions.length+1;
                return col.findOneAndUpdate(
                    { _id: parseInt(deck_id) },
                    {
                        '$set': {
                            'active': targetRevision.id,
                            'lastUpdate': now,
                        },
                        '$push': { 'revisions': targetRevision },
                    },
                    { returnOriginal: false }
                );
            });

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
                if (!deck) return;

                if(revision_id === -1){
                    revision_id = deck.active-1;
                }
                // detect wrong revision id
                if (!deck.revisions[revision_id]) return;

                let [latestRevision] = deck.revisions.slice(-1);

                deckTree = {
                    id: deck_id+'-'+(revision_id+1),
                    revisionId: (revision_id + 1),
                    latestRevisionId: latestRevision.id,
                    title: striptags(deck.revisions[revision_id].title),
                    type: 'deck',
                    children: [],
                };

                return new Promise((resolve, reject) => {
                    async.eachSeries(deck.revisions[revision_id].contentItems, (citem, callback) => {
                        if(citem.kind === 'slide'){
                            if(!onlyDecks){
                                helper.connectToDatabase()
                                .then((db) => db.collection('slides'))
                                .then((col) => {
                                    return col.findOne({_id: parseInt(citem.ref.id)})
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
                    }, (err) => {
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
                            .then((nestedResult) => callback(null, nestedResult))
                            .catch(callback);
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
                    deckTree = { title: deck.revisions[revision_id].title, id: deck_id+'-'+(revision_id+1), type: 'deck', user: String(deck.revisions[revision_id].user), theme: String(deck.revisions[revision_id].theme), children: []};
                }
                return new Promise((resolve, reject) => {
                    async.eachSeries(deck.revisions[revision_id].contentItems, (citem, callback) => {

                        if(citem.kind === 'slide'){
                            helper.connectToDatabase()
                            .then((db) => db.collection('slides'))
                            .then((col) => {
                                return col.findOne({_id: parseInt(citem.ref.id)})
                                .then((slide) => {
                                    let slide_revision = citem.ref.revision-1;
                                    deckTree.children.push({title: slide.revisions[slide_revision].title, content: slide.revisions[slide_revision].content, speakernotes: slide.revisions[slide_revision].speakernotes, user: String(slide.revisions[slide_revision].user), id: slide._id+'-'+slide.revisions[slide_revision].id, type: 'slide'});
                                    callback();
                                });
                            }).catch(callback);
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {
                                if(return_decks){
                                    let deck_revision = citem.ref.revision-1;
                                    deckTree.children.push({title: innerDeck.revisions[deck_revision].title, user: String(innerDeck.revisions[deck_revision].user), id: innerDeck._id+'-'+innerDeck.revisions[deck_revision].id, type: 'deck'});
                                }
                                return self.getFlatSlidesFromDB(innerDeck._id+'-'+citem.ref.revision, deckTree, return_decks)
                                .then(() => {
                                    callback();
                                });
                            }).catch(callback);
                        }
                    }, (err) => {
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

                return new Promise((resolve, reject) => {
                    async.eachSeries(deck.revisions[revision_id].contentItems, (citem, callback) => {

                        if(citem.kind === 'slide'){
                            callback();
                        }
                        else{
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((innerDeck) => {
                                let deck_revision = citem.ref.revision-1;
                                deckTree.children.push({title: innerDeck.revisions[deck_revision].title, user: String(innerDeck.revisions[deck_revision].user), id: innerDeck._id+'-'+innerDeck.revisions[deck_revision].id, type: 'deck'});

                                return self.getFlatDecksFromDB(innerDeck._id+'-'+citem.ref.revision, deckTree)
                                .then(() => {
                                    callback();
                                });
                            }).catch(callback);
                        }
                    }, (err) => {
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

    // returns an implicit list of editors of a given deck
    getDeckEditors(deck_id, editorsList){
        if (!editorsList) editorsList = [];

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

                // take all revisions older than revision_id (including revision_id)
                let deckRevisions = deck.revisions.slice(0, revision_id + 1);

                // add all deck revision owners up to and including this revision
                deckRevisions.forEach((rev) => {
                    pushIfNotExist(editorsList, rev.user);
                });
                pushIfNotExist(editorsList, deck.user);

                // figure out the subdecks by id and revision
                let contentItems = deckRevisions.map((rev) => rev.contentItems);
                contentItems = _.flatten(contentItems).filter((citem) => citem.kind === 'deck');
                contentItems = _.uniqBy(contentItems, (citem) => `${citem.ref.id}-${citem.ref.revision}`);

                return new Promise((resolve, reject) => {
                    async.eachSeries(contentItems, (citem, callback) => {
                        col.findOne({_id: parseInt(citem.ref.id)})
                        .then((innerDeck) => self.getDeckEditors(innerDeck._id+'-'+citem.ref.revision, editorsList))
                        .then(() => callback())
                        .catch(callback);
                    }, (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(editorsList);
                        }
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

    // simply creates a new deck revision without updating anything
    createDeckRevision(deckId, userId, parentDeckId, rootDeckId) {
        return self.get(deckId).then((existingDeck) => {
            if (!existingDeck) return;

            // ready to copy stuff to new revision
            let [lastRevision] = existingDeck.revisions.slice(-1);
            let replacePayload = {
                title: lastRevision.title,
                description: existingDeck.description,
                language: lastRevision.language,
                tags: lastRevision.tags,
                license: existingDeck.license,
                user: userId,
                root_deck: parentDeckId,
                top_root_deck: rootDeckId,
            };

            // create the new revision
            return self.replace(deckId, replacePayload)
            .then((replaced) => {
                if (replaced.ok !== 1) {
                    throw replaced;
                }

                // if deck is a sub-deck, update its parent's content items
                // HACK replaced.value._id is used instead of parsing deckId and getting the deck id (wo/ revision)
                // we do this because we want to get the full deck (with all revisions)
                return self.get(replaced.value._id).then((fullDeck) => {
                    if (parentDeckId) {
                        // update parent deck first before returning
                        return self.updateContentItem(fullDeck, '', parentDeckId, 'deck', rootDeckId, userId)
                        .then(() => fullDeck);
                    } else {
                        return fullDeck;
                    }
                });
            });

        }).then((fullDeck) => {
            if (!fullDeck) return;

            // only return the last (new) revision for the fullDeck in the revisions array
            fullDeck.revisions = fullDeck.revisions.slice(-1);
            return fullDeck;
        });

    },

    //forks a given deck revision by copying all of its sub-decks into new decks
    forkDeckRevision(deck_id, user){

        return self.getFlatDecksFromDB(deck_id)
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
            return new Promise((resolve, reject) => {
                //first we generate all the new ids for the copied decks, and hold them in a map for future reference
                async.eachSeries(flatDeckArray, (next_deck, callback) => {
                    return helper.connectToDatabase()
                    .then((db) => helper.getNextIncrementationValueForCollection(db, 'decks'))
                    .then((newId) => {
                        id_map[next_deck] = newId+'-'+1;
                        id_noRev_map[next_deck.split('-')[0]] = newId;
                        callback();
                    }).catch(callback);
                }, (err) => {
                    if (err) {
                        return reject(err);
                    }

                    //iterate the flat decktree and copy each deck, referring to the new ids in its content items and usage
                    async.eachSeries(flatDeckArray, (next_deck, callback) => {
                        return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
                        .then((db2) => db2.collection('decks'))
                        .then((col) => {
                            return col.findOne({_id: parseInt(next_deck.split('-')[0])})
                            .then((found) => {
                                let ind = parseInt(next_deck.split('-')[1])-1;
                                let contributorsArray = found.contributors;
                                //contributorsArray.push({'user': parseInt(user), 'count': 1});
                                let existingUserContributorIndex = findWithAttr(contributorsArray, 'user', parseInt(user));
                                if(existingUserContributorIndex > -1)
                                    contributorsArray[existingUserContributorIndex].count++;
                                else{
                                    contributorsArray.push({'user': parseInt(user), 'count': 1});
                                }

                                let copiedDeck = {
                                    _id: id_noRev_map[found._id],
                                    origin: {
                                        id: found._id,
                                        revision: found.revisions[ind].id,
                                        title: found.revisions[ind].title,
                                        user: found.user,
                                    },
                                    description: found.description,
                                    language: found.revisions[ind].language,
                                    license: found.license,
                                    user: parseInt(user),
                                    translated_from: found.translated_from,
                                    contributors: contributorsArray,
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
                                copiedDeck.revisions[0].id = 1;
                                // own the revision as well!
                                copiedDeck.revisions[0].user = copiedDeck.user;

                                // renew creation date for fresh revision
                                copiedDeck.revisions[0].timestamp = timestamp;
                                copiedDeck.revisions[0].lastUpdate = timestamp;

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
                                        self.addToUsage(nextSlide, root_deck_path);
                                    }
                                    else{
                                        continue;
                                    }
                                }

                                new_decks.push(copiedDeck);
                                return col.insertOne(copiedDeck).then(() => {
                                    callback();
                                });
                            });
                        }).catch(callback);
                    }, (err2) => {
                        if (err2) {
                            reject(err2);
                        } else {
                            resolve({'root_deck': id_map[res.id], 'id_map': id_map});
                        }
                    });
                });
            });
        });
    },

    getDeckForks(deckId, userId) {
        if (userId) userId = parseInt(userId);
        deckId = parseInt(deckId);

        // check for 404 first
        return self.get(deckId).then((deck) => {
            if (!deck) return;

            let query = { 'origin.id': deckId };
            if (userId) {
                query.user = userId;
            };

            // then run the query itself
            return self.find('decks', query);
        });
    },

    countDeckForks(deckId, userId) {
        if (userId) userId = parseInt(userId);
        deckId = parseInt(deckId);

        // check for 404 first
        return self.get(deckId).then((deck) => {
            if (!deck) return;

            let query = { 'origin.id': deckId };
            if (userId) {
                query.user = userId;
            }

            return self.count('decks', query);
        });
    },

    // computes all deck permissions the user has been granted
    userPermissions(deckId, userId) {
        userId = parseInt(userId);
        return self.get(deckId)
        .then((deck) => {
            if (!deck) return;

            // return {readOnly: true} if requesting any revision other than the latest
            // depending on `deckId` format, the deck may include just the requested revision or all of them
            let readOnly = (deck.revisionId !== deck.latestRevisionId);

            if (deck.user === userId) {
                // deck owner, return all
                return { fork: true, edit: true, admin: true, readOnly };
            }

            // default level is public
            let accessLevel = deck.accessLevel || 'public';
            return self.getDeckUsersGroups(deck, deckId)
            .then((editors) => {
                if (editors.users.includes(userId)) {
                    // user is an editor
                    return { fork: true, edit: true, admin: false, readOnly };
                } else {
                    // we also need to check if the groups allowed to edit the deck include the user
                    return userService.fetchUsersForGroups(editors.groups).then((groupsUsers) => {

                        if (groupsUsers.includes(userId)) {
                            // user is an editor
                            return { fork: true, edit: true, admin: false, readOnly };
                        } else {
                            // user is not an editor or owner
                            // also return if user can fork the deck (e.g. if it's public)
                            return { fork: (accessLevel !== 'private'), edit: false, admin: false, readOnly };
                        }

                    }).catch((err) => {
                        console.warn(`could not fetch usergroup info from service: ${err.message}`);
                        // we're not sure, let's just not allow this user
                        return { fork: (accessLevel !== 'private'), edit: false, admin: false, readOnly };
                    });
                }
            });
        });

    },

    // computes fork permission only
    forkAllowed(deckId, userId) {
        userId = parseInt(userId);
        return self.get(deckId).then((deck) => {
            if (!deck) return;

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

    // computes admin permission only
    adminAllowed(deckId, userId) {
        userId = parseInt(userId);
        return self.get(deckId).then((deck) => {
            if (!deck) return;
            return (deck.user === userId);
        });
    },

    getTags(deckIdParam){
        let {deckId, revisionId} = splitDeckIdParam(deckIdParam);

        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(deckId)})
            .then((deck) => {

                if(!deck) return;

                if(revisionId === null){
                    revisionId = getActiveRevision(deck);
                }

                if(!deck.revisions[revisionId]) return;

                return (deck.revisions[revisionId].tags || []);
            });
        });
    },

    addTag: function(deckIdParam, tag) {
        let {deckId, revisionId} = splitDeckIdParam(deckIdParam);

        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(deckId)})
            .then((deck) => {

                if(!deck) return;

                if(revisionId === null){
                    revisionId = getActiveRevision(deck);
                }

                if(!deck.revisions[revisionId]) return;

                if(!deck.revisions[revisionId].tags){
                    deck.revisions[revisionId].tags = [];
                }

                // check if new tag already exists in tags array
                if(!deck.revisions[revisionId].tags.some((element) => {
                    return element.tagName === tag.tagName;
                })){
                    deck.revisions[revisionId].tags.push(tag);
                    col.save(deck);
                }

                return deck.revisions[revisionId].tags;
            });
        });
    },

    removeTag: function(deckIdParam, tag){
        let {deckId, revisionId} = splitDeckIdParam(deckIdParam);

        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.findOne({_id: parseInt(deckId)})
            .then((deck) => {

                if(!deck) return;

                if(revisionId === null){
                    revisionId = getActiveRevision(deck);
                }

                if(!deck.revisions[revisionId]) return;

                deck.revisions[revisionId].tags = (deck.revisions[revisionId].tags || []).filter( (el) => {
                    return el.tagName !== tag.tagName;
                });

                col.save(deck);
                return deck.revisions[revisionId].tags;
            });
        });
    },

    // fetches change log records for the deck or subdecks thereof
    getChangeLog: function(identifier) {
        // always check if deck exists to return a 404
        return self.get(identifier).then((existingDeck) => {
            if (!existingDeck) return;

            let deck = util.parseIdentifier(identifier);
            // set default if not specified (?)
            // if (!deck.revision) deck.revision = existingDeck.active;

            let valueQuery = {
                'value.kind': 'deck',
                'value.ref.id': deck.id,
            };
            // if not specified, return all
            if (deck.revision) valueQuery['value.ref.revision'] = deck.revision;

            return helper.getCollection('deckchanges').then((changes) => {
                return changes.aggregate([
                    { $match: {
                        $or: [
                            { path: {
                                $elemMatch: deck
                            } },
                            valueQuery,
                        ]
                    } },
                    { $project: { _id: 0 } },
                    { $sort: { timestamp: -1 } },
                ]);
            }).then((result) => result.toArray());
        });

    },

};

// split deck id given as parameter to deck id and revision id
function splitDeckIdParam(deckId){
    let revisionId = null;
    let decktreesplit = deckId.split('-');
    if(decktreesplit.length > 1){
        deckId = decktreesplit[0];
        revisionId = decktreesplit[1]-1;
    }

    return {deckId, revisionId};
}

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
    if(!deck.hasOwnProperty('theme') || deck.theme === null){
        deck.theme = 'default';
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
            lastUpdate: now.toISOString(),
            user: deck.user,
            language: deck.language,
            parent: deck.parent_deck,
            tags: deck.tags,
            comment: deck.comment,
            abstract: deck.abstract,
            footer: deck.footer,
            contentItems: [],
            theme: deck.theme
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
    if(!deck.hasOwnProperty('theme') || deck.theme === null){
        deck.theme = 'default';
    }
    if(deck.hasOwnProperty('editors') && deck.editors === null){
        deck.editors = {users: [], groups: []};
    }
    else if(!deck.hasOwnProperty('editors')){
        deck.editors = {users: [], groups: []};
    }
    const result = {
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
            lastUpdate: now.toISOString(),
            user: deck.user,
            language: deck.language,
            parent: deck.parent_deck,
            tags: deck.tags,
            comment: deck.comment,
            abstract: deck.abstract,
            footer: deck.footer,
            contentItems: content_items,
            theme: deck.theme
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
    for(let i = 0; i < array.length; i++) {
        if(array[i][attr] === value) {
            return i;
        }
    }
    return -1;
}

function findWithAttrRev(array, attr, value) {
    for(let i = 0; i < array.length; i++) {
        if(array[i][attr].split('-')[0] === value.split('-')[0]) {
            return i;
        }
    }
    return -1;
}
