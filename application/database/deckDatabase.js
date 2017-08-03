'use strict';

const _ = require('lodash');
const util = require('../lib/util');

const ChangeLog = require('../lib/ChangeLog');

const userService = require('../services/user');

const helper = require('./helper'),
    striptags = require('striptags'),
    validateDeck = require('../models/deck').validateDeck,
    Microservices = require('../configs/microservices');

const async = require('async');

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

    //gets a new id for a legacy deck
    getLegacyId: function(id) {
        return helper.connectToDatabase()
        .then((db) => db.collection('oldrevisions'))
        .then((col) => col.findOne({'_id' :parseInt(id)}))
        .then((old_deck) => {
            if(old_deck) {
                return helper.connectToDatabase()
                .then((db) => db.collection('decks'))
                .then((col) => col.findOne({'_id':parseInt(old_deck.deck_id)}))
                .then((found) => {
                    if(found) {
                        if (found.revisions.length){
                            return new Promise((resolve, reject) => {
                                let index = 0;
                                for (let i = found.revisions.length - 1; i>=0; i--){
                                    if (found.revisions[i].user === old_deck.user_id){
                                        index = parseInt(i)+1;
                                        resolve(found._id+'-'+index); //the last revision for this user
                                    };
                                }
                                resolve(found._id + '-' + found.revisions.length); //the last revision if there is no revision for this user
                                // async.eachOf(found.revisions, (value, key, cbEach) => {
                                //     if (value.user === old_deck.user_id){
                                //         //k = key;
                                //         if (key > j){ //this is a later revision of this user, return it
                                //             j = key;
                                //             k = key;
                                //             cbEach(j);
                                //         }else{
                                //             k=key;
                                //             cbEach(j); //this is a previous revision of this user, continue search
                                //         }
                                //     }else{
                                //         cbEach(k); //there is no revisions for this user, return the last revision
                                //     }
                                // }, (index) => {
                                //     let i = parseInt(index)+1;
                                //     resolve(found._id+'-'+i);
                                // });
                            });
                        }else{
                            return;
                        }
                    }else{
                        return ;
                    }
                }).catch((error) => {
                    console.log(error);
                    return;
                });
            }else{
                return;
            }
        }).catch((error) => {
            console.log(error);
            return;
        });
    },

    //gets the last revision of a user for a legacy deck
    getLegacyRevision: function(id, user_id){
        return 'id'+id+'user_id'+user_id;

    },

    // gets the latest revision id stored for deckId
    getLatestRevision: function(deckId) {
        deckId = parseInt(deckId);

        return helper.getCollection('decks')
        .then((col) => col.findOne(
            { _id: deckId },
            { revisions: { $slice: -1 } }
        )).then((found) => found && found.revisions[0].id);
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
    // returns first occurence of targetId, or nothing if cannot find the path
    // if targetKind is deck, then the path includes that as last item
    findPath: function(sourceDeckId, targetId, targetKind = 'deck', path) {
        let source = util.parseIdentifier(sourceDeckId);
        let target = util.parseIdentifier(targetId);

        // deck is default if invalid (?)
        if (!['deck', 'slide'].includes(targetKind)) targetKind = 'deck';

        return self.getRevision(sourceDeckId).then((sourceRevision) => {
            // source deck not found
            if (!sourceRevision) return [];

            // path should be canonical, so we need the revision to be defined
            source.revision = sourceRevision.id;

            if (!path) {
                path = [source];

                // return if source is same as target
                // but only for deck targets
                if (targetKind === 'deck' && source.id === target.id) return path;
            }

            if (targetKind === 'slide') {
                // first check all children for slide target
                let foundSlideIndex = sourceRevision.contentItems.findIndex((citem) => citem.kind === 'slide' && citem.ref.id === target.id);
                let foundSlide = sourceRevision.contentItems[foundSlideIndex];

                // the path points to the slide, append just the index and return
                if (foundSlide) return path.concat({ index: foundSlideIndex });
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
                if (targetKind === 'deck' && citem.ref.id === target.id) return true;
            });

            // target is child of source
            if (foundTarget) {
                // the last subPath added is the path to target (because we did break in previous loop)
                return subPaths.slice(-1)[0];
            }

            // if no further subdecks are here we just return empty (dead-end)
            if (subPaths.length === 0) return [];

            // otherwise we search down
            return new Promise((resolve, reject) => {
                async.concatSeries(subPaths, (subPath, callback) => {
                    // the sub deck is the last element in the path
                    let [nextSource] = subPath.slice(-1);

                    self.findPath(util.toIdentifier(nextSource), targetId, targetKind, subPath)
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

    // inserts a deck into the database
    insert: function(deck) {
        // check if parentDeck has revision
        let parentDeck = util.parseIdentifier(deck.root_deck);
        if (parentDeck && !parentDeck.revision) {
            // need to find the latest revision id
            return self.getLatestRevision(parentDeck.id)
            .then((parentRevision) => {
                if (!parentRevision) return;

                parentDeck.revision = parentRevision;
                deck.root_deck = util.toIdentifier(parentDeck);

                return self._insert(deck);
            });
        }

        return self._insert(deck);
    },

    // inserts a deck into the database
    _insert: function(deck) {
        return helper.connectToDatabase()
        .then((db) => helper.getNextIncrementationValueForCollection(db, 'decks'))
        .then((newId) => {
            return helper.getCollection('decks')
            .then((col) => {
                deck._id = newId;

                const convertedDeck = convertToNewDeck(deck);
                if (!validateDeck(convertedDeck)) {
                    throw new Error(JSON.stringify(validateDeck.errors));
                }

                return col.insertOne(convertedDeck).then((result) => {
                    // the deck.root_deck means we are adding a subdeck to that deck
                    if (!deck.root_deck) {
                        // also track in change log, but only if it's not a subdeck
                        ChangeLog.trackDeckCreated(convertedDeck._id, convertedDeck.user);
                    }
                    return result;
                });
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

                // TODO add comment, abstract, footer

                if (!_.isEmpty(deck.tags)) {
                    deckRevision.tags = deck.tags;
                }

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

    // DEPRECATED
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

    // simpler implementation of replace that does not update anything, just creates the revision
    revise: function(deckId, path, userId, parentOperations=[]) {
        userId = parseInt(userId);

        let deck = util.parseIdentifier(deckId);

        // parent is second to last; if path length is 1, then parent is undefined
        let [parentDeck] = path.slice(-2, -1);

        // root is first; if path length is 1, the root is the deck itself
        let rootDeckId = util.toIdentifier(path[0]);

        return self.get(deck.id).then((existingDeck) => {
            if (!existingDeck) return;

            // we will create the new revision as a copy of the input revision
            let originRevision;
            if (deck.revision) {
                // this can be used for revert as well
                originRevision = existingDeck.revisions.find((r) => r.id === deck.revision);
            } else {
                // if missing, we want the latest
                [originRevision] = existingDeck.revisions.slice(-1);
            }
            if (!originRevision) return;

            // start tracking
            let deckTracker = ChangeLog.deckTracker(existingDeck, rootDeckId, userId, parentOperations);

            let newRevision = _.cloneDeep(originRevision);
            // get the next revision id
            let newRevisionId = Math.max(...existingDeck.revisions.map((r) => r.id)) + 1;
            newRevision.id = newRevisionId;

            // update the new revision metadata
            let now = (new Date()).toISOString();
            newRevision.timestamp = now;
            newRevision.lastUpdate = now;

            newRevision.user = userId;

            // we need to add some extra metadata when reverting, let's add it always :)
            newRevision.originRevision = originRevision.id;

            // usage array stuff
            newRevision.usage = [];
            if (parentDeck) {
                // if replacing a subdeck we remove the parent deck revision from the usage of the originRevision
                _.remove(originRevision.usage, (u) => {
                    return (u.id === parentDeck.id && u.revision === parentDeck.revision);
                });

                // and we add it to the newRevision
                newRevision.usage.push(parentDeck);
            }

            // add the new revision!
            existingDeck.revisions.push(newRevision);

            // update the contributors to the deck
            let contributors = existingDeck.contributors;
            if (!contributors) {
                existingDeck.contributors = contributors = [];
            }

            // should a user that simply creates a revision be considered a contributor?
            // for now, the answer is yes, but only if it's an actual user
            if (userId > 0) {
                let existingContributor = contributors.find((c) => c.user === userId);
                if (existingContributor) {
                    // if found, simply increment the count
                    existingContributor.count++;
                } else {
                    // otherwise add it
                    existingContributor = { user: userId, count: 1};
                    contributors.push(existingContributor);
                }
            }

            // final metadata
            existingDeck.active = newRevisionId;
            existingDeck.lastUpdate = now;

            // update usage of each slide or subdeck
            async.eachSeries(originRevision.contentItems, (item, done) => {
                let promise;
                if (item.kind === 'slide') {
                    promise = helper.getCollection('slides').then((col) => {
                        return col.findOneAndUpdate(
                            {
                                _id: item.ref.id,
                                'revisions.id': item.ref.revision,
                            },
                            { $push: {
                                'revisions.$.usage': {
                                    id: deck.id,
                                    revision: newRevisionId,
                                },
                            } }
                        );
                    });

                } else {
                    promise = helper.getCollection('decks').then((col) => {
                        return col.findOneAndUpdate(
                            {
                                _id: item.ref.id,
                                'revisions.id': item.ref.revision,
                            },
                            { $push: {
                                'revisions.$.usage': {
                                    id: deck.id,
                                    revision: newRevisionId,
                                },
                            } }
                        );
                    });
                }

                promise.then((res) => {
                    if (!res.value) {
                        // something's wrong
                        console.warn(item);
                    }
                    done();
                }).catch(done);

            }, (err) => {
                if (err) {
                    console.warn(err);
                }
            });

            return helper.getCollection('decks').then((col) => {
                var batch = col.initializeOrderedBulkOp();
                // update current revision first
                batch.find({
                    _id: deck.id,
                    'revisions.id': originRevision.id,
                }).updateOne({
                    $set: {
                        'revisions.$': originRevision,
                    },
                });
                // then push new and other updates
                batch.find({ _id: deck.id }).updateOne({
                    $set: {
                        active: newRevisionId,
                        lastUpdate: now,
                        contributors: contributors,
                    },
                    $push: { 'revisions': newRevision },
                });
                return batch.execute().then((res) => existingDeck);

                // return col.save(existingDeck).then(() => existingDeck);
            }).then((updatedDeck) => {
                // complete the tracking after revision (it may be nothing)
                return deckTracker.applyChangeLog(updatedDeck).then((deckChanges) => {
                    // deckChanges may be nothing if an error occured

                    if (!parentDeck) return [updatedDeck, deckChanges];

                    // update parent deck first before returning
                    return self.updateContentItem(updatedDeck, '', util.toIdentifier(parentDeck), 'deck', userId, rootDeckId, parentOperations)
                    .then(({deckChanges: moreDeckChanges}) => {
                        return [updatedDeck, deckChanges.concat(moreDeckChanges)];
                    });

                });

            });

        });

    },

    // this is what we use to create a new revision, we need to do this recursively in the deck tree
    // `parentOperations` is set internally, external code should leave it undefined
    deepRevise: function(path, userId, parentOperations=[]) {
        // we revise the end of the path
        let [deck] = path.slice(-1);

        return self.revise(util.toIdentifier(deck), path, userId, parentOperations)
        .then(([updatedDeck, deckChanges]) => {
            if (!updatedDeck) return;

            let [revision] = updatedDeck.revisions.slice(-1);
            let nextParent = { id: updatedDeck._id, revision: revision.id };

            // replace last path item with new parent (after revision)
            let updatedPath = path.slice(0, -1).concat(nextParent);

            // revision is a copy of the previous revision, so it has the same contents
            // we extend updatedPath to include each subdeck
            let subPaths = revision.contentItems.filter((i) => i.kind === 'deck').map((i) => updatedPath.concat(i.ref));

            return new Promise((resolve, reject) => {
                async.eachSeries(subPaths, (subPath, done) => {
                    self.deepRevise(subPath, userId, parentOperations.concat(deckChanges))
                    .then(() => done()).catch(done);
                }, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(updatedDeck);
                    }
                });
            });
        });
    },

    // reverts a deck an to older revision
    revert: function(deckId, revisionId, path, userId, parentOperations=[]) {
        let deck = {
            id: parseInt(deckId),
            revision: parseInt(revisionId),
        };

        return self.get(deck.id).then((existingDeck) => {
            if (!existingDeck) return;

            // we require the revision to be explicit
            let revision = existingDeck.revisions.find((r) => r.id === deck.revision);
            if (!revision) return;


            // TODO commenting this because when we revert a revert,
            // we may end up having the same subdeck revision
            // in both the current deck revision, and an older one

            // // we also require the revision specified to not be the last
            // let [latestRevision] = existingDeck.revisions.slice(-1);
            // if (revision.id === latestRevision.id) {
            //     // it's like a no-op, already reverted to the requested revision :)
            //     return existingDeck;
            // };

            return self.revise(util.toIdentifier(deck), path, userId, parentOperations);
        });

    },

    // this is what we use to revert to a revision, we need to do this recursively in the deck tree
    // `parentOperations` is set internally, external code should leave it undefined
    deepRevert: function(path, revisionId, userId, parentOperations=[]) {
        // we revert the end of the path
        let [deck] = path.slice(-1);

        // deck points to the latest revision, but we revert to revisionId
        return self.revert(deck.id, revisionId, path, userId, parentOperations)
        .then(([updatedDeck, deckChanges]) => {
            if (!updatedDeck) return;

            let [revision] = updatedDeck.revisions.slice(-1);
            let nextParent = { id: updatedDeck._id, revision: revision.id };

            // replace last path item with new parent (after revert)
            let updatedPath = path.slice(0, -1).concat(nextParent);

            // revision is a copy of the revision we are reverting to, so it has the same contents
            // we extend updatedPath to include each subdeck
            let subPaths = revision.contentItems.filter((i) => i.kind === 'deck').map((i) => updatedPath.concat(i.ref));

            return new Promise((resolve, reject) => {
                async.eachSeries(subPaths, (subPath, done) => {
                    // each subpath ends with the subdeck at the revision
                    // it is under in the parent deck revision we are reverting to
                    // so we need to revert the subdeck as well to that revision
                    let [subDeck] = subPath.slice(-1);

                    self.deepRevert(subPath, subDeck.revision, userId, parentOperations.concat(deckChanges))
                    .then(() => done()).catch(done);
                }, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(updatedDeck);
                    }
                });
            });
        });
    },

    //inserts a content item (slide or deck) into a deck at the specified position, or appends it at the end if no position is given
    insertNewContentItem: function(citem, position, root_deck, ckind, citem_revision_id, user, top_root_deck, action) {
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

                let deckTracker;
                if (top_root_deck) {
                    // only track this when top_root_deck is provided
                    deckTracker = ChangeLog.deckTracker(existingDeck, top_root_deck, user, [], action);
                }
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

                existingDeck.lastUpdate = new Date().toISOString();
                existingDeck.revisions[activeRevisionId-1].lastUpdate = existingDeck.lastUpdate;

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

                    if (deckTracker) deckTracker.applyChangeLog();

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

                    if (deckTracker) deckTracker.applyChangeLog();

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

                existingDeck.lastUpdate = new Date().toISOString();
                existingDeck.revisions[activeRevisionId-1].lastUpdate = existingDeck.lastUpdate;

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

    // updates an existing content item's revision
    // can be used for reverting or updating
    updateContentItem: function(citem, revertedRevId, root_deck, ckind, user, top_root_deck, parentOperations) {
        let rootArray = root_deck.split('-');
        return helper.getCollection('decks')
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
                let deckTracker = ChangeLog.deckTracker(existingDeck, top_root_deck, user, parentOperations, revertedRevId ? 'revert' : undefined);

                existingDeck.lastUpdate = new Date().toISOString();
                for(let i = 0; i < existingDeck.revisions.length; i++) {
                    if(existingDeck.revisions[i].id === parseInt(rootRev)) {

                        for(let j = 0; j < existingDeck.revisions[i].contentItems.length; j++) {
                            if(existingDeck.revisions[i].contentItems[j].ref.id === citem._id && existingDeck.revisions[i].contentItems[j].kind === ckind) {
                                old_rev_id = existingDeck.revisions[i].contentItems[j].ref.revision;
                                existingDeck.revisions[i].contentItems[j].ref.revision = newRevId;

                                existingDeck.revisions[i].lastUpdate = existingDeck.lastUpdate;
                            }
                            else continue;
                        }
                    }
                    else continue;
                }

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

                return col.save(existingDeck)
                .then(() => deckTracker.applyChangeLog())
                .then((deckChanges) => {
                    return {
                        oldRevision: old_rev_id,
                        newRrevision: newRevId,
                        deckChanges: deckChanges,
                    };
                });
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

    //returns a flattened structure of a deck's slides, and optionally its sub-decks
    getFlatSlides: function(deckId, deckTree, returnDecks){

        return self.getRevision(deckId)
        .then((deckRevision) => {

            // return nothing if not found
            if (!deckRevision) return;

            if(!deckTree){
                // info of root deck
                deckTree = {
                    title: deckRevision.title,
                    id: deckId,
                    type: 'deck',
                    user: String(deckRevision.user),
                    theme: String(deckRevision.theme),
                    children: []
                };
            }

            // include subdecks in result
            if(returnDecks){
                deckTree.children.push({
                    title: deckRevision.title,
                    user: String(deckRevision.user),
                    id: deckId,
                    type: 'deck'
                });
            }

            return new Promise( (resolve, reject) => {
                async.eachSeries(deckRevision.contentItems, (citem, callback) => {

                    if(citem.kind === 'slide'){
                        helper.connectToDatabase()
                        .then((db) => db.collection('slides'))
                        .then((col) => {
                            col.findOne({_id: parseInt(citem.ref.id)})
                            .then((slide) => {
                                let slideRevision =  slide.revisions.find((rev) => (rev.id === citem.ref.revision));
                                deckTree.children.push({
                                    title:slideRevision.title,
                                    content: slideRevision.content,
                                    speakernotes: slideRevision.speakernotes,
                                    user: String(slideRevision.user),
                                    id: slide._id+'-'+slideRevision.id,
                                    type: 'slide'
                                });
                                callback();
                            }).catch( (err) => {
                                callback(err);
                            });
                        }).catch( (err) => {
                            callback(err);
                        });
                    }
                    else if (citem.kind === 'deck'){
                        // call recursively for subdecks
                        self.getFlatSlides(`${citem.ref.id}-${citem.ref.revision}`, deckTree, returnDecks)
                        .then(() => {
                            callback();
                        }).catch( (err) => {
                            callback(err);
                        });
                    }
                }, (err) => {
                    if(err){
                        reject(err);
                    }
                    else{
                        resolve(deckTree);
                    }
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
        deck_id = String(deck_id);
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
    createDeckRevision(deckId, userId, rootDeckId) {
        // we only need the id, ignore any revision id
        deckId = String(parseInt(deckId));

        // we also need the path from root to deck
        return self.findPath(rootDeckId, deckId).then((path) => {
            // create the new revision
            return self.deepRevise(path, userId).then((updatedDeck) => {
                if (!updatedDeck) return;

                // only return the last (new) revision for the updatedDeck in the revisions array
                updatedDeck.revisions = updatedDeck.revisions.slice(-1);
                return updatedDeck;
            });

        });

    },

    // reverts a deck to a past revision by copying it to a new one
    revertDeckRevision: function(deckId, revisionId, userId, rootDeckId) {
        // we only need the id, ignore any revision id there
        deckId = String(parseInt(deckId));

        // we also need the path from root to deck
        return self.findPath(rootDeckId, deckId).then((path) => {

            // revert to revision
            return self.deepRevert(path, revisionId, userId).then((updatedDeck) => {
                if (!updatedDeck) return;

                // only return the last (new) revision for the fullDeck in the revisions array
                updatedDeck.revisions = updatedDeck.revisions.slice(-1);
                return updatedDeck;
            });

        });

    },

    // we guard the fork deck revision method against abuse, by checking for change logs of one
    forkDeckRevision(deck_id, user, forAttach) {
        let deck = util.parseIdentifier(deck_id);
        return self.get(deck.id).then((existingDeck) => {
            let [latestRevision] = existingDeck.revisions.slice(-1);
            if (deck.revision && latestRevision.id !== deck.revision) {
                // we want to fork a read-only revision, all's well
                return self._forkDeckRevision(deck_id, user, forAttach);
            } else {
                // make the deck id canonical just in case
                deck.revision = latestRevision.id;
            }

            // before we fork it, let's check if it's a fresh revision
            return self.getChangesCounts(deck.id).then((counts) => {
                if (counts[deck.revision] === 1) {
                    // we want to fork a fresh revision, let's fork the one before it
                    console.log(`forking ${deck.revision -1} instead of ${deck.revision} for deck ${deck.id}`);
                    return self._forkDeckRevision(util.toIdentifier({ id: deck.id, revision: deck.revision - 1 }), user, forAttach);
                } else {
                    // unknown revision, old deck without changelog, or a revision with changes, just fork it!
                    return self._forkDeckRevision(deck_id, user, forAttach);
                }
            });
        });
    },

    // forks a given deck revision by copying all of its sub-decks into new decks
    // forAttach is true when forking is done during deck attach process
    _forkDeckRevision(deck_id, user, forAttach) {

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

                                // this points to the same deck, needs to be removed in forked decks
                                delete copiedDeck.revisions[0].originRevision;

                                // isFeatured needs to be removed in forked decks
                                delete copiedDeck.revisions[0].isFeatured;

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
                            if (!forAttach) {
                                // if not attaching, we need to track stuff here
                                let rootDeckId = id_map[res.id];
                                self._trackDecksForked(rootDeckId, id_map, user);
                            }

                            resolve({'root_deck': id_map[res.id], 'id_map': id_map});
                        }
                    });
                });
            });

        }).then((forkResult) => {
            // after forking the deck and if the revision we forked is the latest,
            // we create a new revision for the original deck;
            // this way the fork points to a read-only revision

            let deck = util.parseIdentifier(deck_id);
            return self.get(deck.id).then((existingDeck) => {
                let [latestRevision] = existingDeck.revisions.slice(-1);
                if (deck.revision && latestRevision.id !== deck.revision) {
                    // we forked a read-only revision, nothing to do here
                    return forkResult;
                } else {
                    // make the deck id canonical just in case
                    deck.revision = latestRevision.id;
                }

                // this is an automatic revision, the user should be 'system'
                // deck autorevision is created with same deck as root
                return self.createDeckRevision(deck.id, -1, deck.id).then((updatedDeck) => {
                    // we need to update all parents of the deck to keep them updated
                    // with the latest revision we have just created now
                    return self.getUsage(util.toIdentifier(deck)).then((usage) => {
                        // if a deck has no roots, itself is the root
                        console.log(`updating deck revision used for ${deck.id} in ${usage.length} parent decks`);

                        usage.reduce((p, parentDeck) => {
                            return p.then(() => {
                                // citem, revertedRevId, root_deck, ckind, user, top_root_deck, parentOperations
                                let parentDeckId = util.toIdentifier(parentDeck);
                                return self.updateContentItem(updatedDeck, '', parentDeckId, 'deck', -1, parentDeckId);
                            });
                        }, Promise.resolve());
                    }).then(() => {
                        // return the same result
                        return forkResult;
                    });

                });

            });

        });

    },

    // TODO make this actually private after code in handler.js has been moved here
    _trackDecksForked(rootDeckId, forkIdsMap, userId, forAttach) {
        // we reverse the array to track the root first, then the children in order
        let newDeckIds = Object.keys(forkIdsMap).map((key) => forkIdsMap[key]).reverse();

        let parentOperations = [];
        // taken from https://stackoverflow.com/questions/30823653/is-node-js-native-promise-all-processing-in-parallel-or-sequentially/#30823708
        // this starts with a promise that resolves to empty array,
        // then takes each new deck id and applies the tracking and returns a new promise that resolves
        // to the tracking results, that are picked up by the next iteration, etc...
        return newDeckIds.reduce((p, newDeckId) => {
            return p.then((deckChanges) => {
                // if errored somewhere return nothing, chain will just end without doing the rest
                if (!deckChanges) return;

                // parent operations is only the ops for the forking of the first deck (the root of the fork tree)
                // the first time this runs, deckChanges is empty!
                if (_.isEmpty(parentOperations)) parentOperations.push(...deckChanges);
                // we track everything as rooted to the deck_id
                return ChangeLog.trackDeckForked(newDeckId, userId, rootDeckId, parentOperations, forAttach);
            });
        }, Promise.resolve([]));

    },

    fill_translations(kind, translations_array){
        if (kind === 'deck'){
            return new Promise((resolve, reject) => {
                async.each(translations_array, (translation, cbEach) => {
                    return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
                    .then((db2) => db2.collection('decks'))
                    .then((col) => {
                        return col.findOne({_id: parseInt(translation.deck_id)})
                        .then((found) => {
                            if (found){
                                found.translations = translations_array;
                                col.save(found);
                                resolve();
                            }else{
                                console.log('Deck not found: ' + translation.deck_id);
                                reject('Deck not found: ' + translation.deck_id);
                            }

                        })
                        .catch(cbEach);
                    });
                }, (err) => {
                    if (err) {
                        return reject(err);
                    }
                });
            });
        }else{
            return new Promise((resolve, reject) => {
                async.each(translations_array, (translation, cbEach) => {
                    return helper.connectToDatabase() //db connection have to be accessed again in order to work with more than one collection
                    .then((db2) => db2.collection('slides'))
                    .then((col) => {
                        return col.findOne({_id: parseInt(translation.slide_id)})
                        .then((found) => {
                            if (found){
                                found.translations = translations_array;
                                col.save(found);
                                resolve();
                            }else{
                                console.log('Slide not found: ' + translation.slide_id);
                                reject('Slide not found: ' + translation.slide_id);
                            }
                        })
                        .catch(cbEach);
                    });
                }, (err) => {
                    if (err) {
                        return reject(err);
                    }
                });
            });
        }

    },

    //forks a given deck revision by copying all of its sub-decks into new decks
    translateDeckRevision(deck_id, user, language){

        return self.getFlatDecksFromDB(deck_id)
        .then((res) => {
            //we have a flat sub-deck structure
            let flatDeckArray = [];
            flatDeckArray.push(res.id); //push root deck into array
            for(let i = 0; i < res.children.length; i++){
                flatDeckArray.push(res.children[i].id); //push next sub-deck into array
            }
            //init maps for new ids
            let id_map = {}, id_noRev_map = {}, slide_id_map = {};
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
                                        kind: 'translation'
                                    },
                                    description: found.description,
                                    language: found.revisions[ind].language,
                                    license: found.license,
                                    user: parseInt(user),
                                    translated_from: found.translated_from,
                                    contributors: contributorsArray,
                                    active: 1,
                                    translations: found.translations
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

                                let contentItemsMap = {};
                                //console.log('before loop for content items');
                                async.eachSeries(copiedDeck.revisions[0].contentItems, (nextSlide, callback) => {
                                    if(nextSlide.kind === 'slide'){
                                        console.log('NEXT SLIDE', nextSlide);
                                        //we have to copy the slide, not like when forking
                                        let root_deck_path = [copiedDeck._id, '1'];
                                        helper.connectToDatabase()
                                        .then((db) => helper.getNextIncrementationValueForCollection(db, 'slides'))
                                        .then((newSlideId) => {
                                            helper.connectToDatabase()
                                            .then((db2) => db2.collection('slides'))
                                            .then((col2) => {
                                                col2.findOne({_id: parseInt(nextSlide.ref.id)})
                                                .then((slide) => {
                                                    let slideRevisionIndex = parseInt(nextSlide.ref.revision)-1;
                                                    slide.revisions = [slide.revisions[slideRevisionIndex]];
                                                    contentItemsMap[slide._id] = newSlideId;
                                                    slide_id_map[slide._id] = newSlideId;
                                                    let oldSlideId = slide._id;
                                                    slide._id = newSlideId;
                                                    //slide.translated_from =
                                                    let rp = require('request-promise-native');
                                                    let myPromise = new Promise((resolve, reject) => {

                                                        var options = {
                                                            method: 'POST',
                                                            uri: Microservices.translation.uri+'/slide/'+oldSlideId,
                                                            headers : {
                                                                'Content-Type': 'application/json',
                                                                'Cache-Control': 'no-cache'
                                                            },
                                                            body :{
                                                                'target': language,
                                                                'user': copiedDeck.user+''
                                                            },
                                                            json: true
                                                        };
                                                        rp(options).then(function (translated){
                                                            //console.log('SLIDE response', original);
                                                            if (translated.error){
                                                                //console.log(original);
                                                                resolve({});
                                                            }else{
                                                                //Change usage of slide
                                                                for(let i = 0; i < slide.revisions[0].usage.length; i++){
                                                                    for(let j in id_map){
                                                                        if(id_map.hasOwnProperty(j) && slide.revisions[0].usage[i].id === parseInt(j.split('-')[0])){
                                                                            slide.revisions[0].usage[i].id = parseInt(id_map[j].split('-')[0]);
                                                                            slide.revisions[0].usage[i].revision = parseInt(id_map[j].split('-')[1]);
                                                                        }
                                                                    }
                                                                }
                                                                translated._id = newSlideId;
                                                                translated.revisions[0].usage = slide.revisions[0].usage;
                                                                col2.save(translated);
                                                                let translations = [];
                                                                if (slide.translations){
                                                                    translations = slide.translations;
                                                                    translations.push({'slide_id':slide._id, 'language':language});
                                                                }else{
                                                                    translations.push({'slide_id':slide._id, 'language':language});
                                                                    translations.push({'slide_id':oldSlideId, 'language':slide.language});
                                                                }
                                                                //filling in the translations array for all decks in the 'family'
                                                                self.fill_translations('slide', translations)
                                                                .then(resolve)
                                                                .catch(reject);

                                                            }
                                                        })
                                                        .catch(function (e){
                                                            console.log('problem with request deck: ' + e.message);
                                                            reject(e);
                                                        });
                                                    });

                                                    //console.log('contentItemsMap', contentItemsMap);
                                                    //console.log('copiedDeck', copiedDeck);
                                                    for(let i = 0; i < copiedDeck.revisions[0].contentItems.length; i++){
                                                        if(copiedDeck.revisions[0].contentItems[i].ref.id === oldSlideId){
                                                            copiedDeck.revisions[0].contentItems[i].ref.id = newSlideId;
                                                            copiedDeck.revisions[0].contentItems[i].ref.revision = 1;
                                                        }
                                                    }
                                                    callback();
                                                });
                                            });
                                        });
                                    }
                                    else{
                                        callback();
                                    }
                                },(err) => {
                                    if (err) {
                                        return reject(err);
                                    }

                                    //console.log('outside root_deck_path', root_deck_path);
                                    //console.log('check point 1');
                                    // let translations = copiedDeck.translations;
                                    // translations.push({'deck_id':copiedDeck._id, 'language':language});//filling in the translations array for all decks in the 'family'
                                    // self.fill_translations(translations)
                                     //.then(() => {
                                    for(let i = 0; i < copiedDeck.revisions[0].contentItems.length; i++){
                                        for(let j in id_map){
                                            if(id_map.hasOwnProperty(j) && copiedDeck.revisions[0].contentItems[i].ref.id === parseInt(j.split('-')[0])){
                                                copiedDeck.revisions[0].contentItems[i].ref.id = parseInt(id_map[j].split('-')[0]);
                                                copiedDeck.revisions[0].contentItems[i].ref.revision = parseInt(id_map[j].split('-')[1]);
                                            }
                                        }
                                    }
                                    //console.log('check point 2');
                                    for(let i = 0; i < copiedDeck.revisions[0].usage.length; i++){
                                        for(let j in id_map){
                                            if(id_map.hasOwnProperty(j) && copiedDeck.revisions[0].usage[i].id === parseInt(j.split('-')[0])){
                                                copiedDeck.revisions[0].usage[i].id = parseInt(id_map[j].split('-')[0]);
                                                copiedDeck.revisions[0].usage[i].revision = parseInt(id_map[j].split('-')[1]);
                                            }
                                        }
                                    }
                                    //console.log('check point 3');
                                    for(let i = 0; i < copiedDeck.revisions[0].contentItems.length; i++){
                                        let nextSlide = copiedDeck.revisions[0].contentItems[i];
                                        //console.log('nextSlide', nextSlide);
                                        if(nextSlide.kind === 'slide'){
                                            let root_deck_path = [copiedDeck._id, '1'];
                                            //console.log('outside root_deck_path', root_deck_path);
                                            //console.log('contentItemsMap', contentItemsMap);
                                            self.addToUsage(nextSlide, root_deck_path);
                                        }
                                        else{
                                            continue;
                                        }
                                    }

                                    //console.log('check point 4');

                                    //translate copiedDeck
                                    //console.log('translation uri', Microservices.translation.uri+'/deck/'+found._id);
                                    let rp = require('request-promise-native');
                                    let myPromise = new Promise((resolve, reject) => {

                                        var options = {
                                            method: 'POST',
                                            uri: Microservices.translation.uri+'/deck/'+found._id,
                                            headers : {
                                                'Content-Type': 'application/json',
                                                'Cache-Control': 'no-cache'
                                            },
                                            body :{
                                                'target': language,
                                                'user': copiedDeck.user+''
                                            },
                                            json: true
                                        };
                                        rp(options).then(function (original){
                                            //console.log('response', original);
                                            if (original.error){
                                                //console.log(original);
                                                resolve({});
                                            }else{
                                                copiedDeck.revisions[0].title = original.revisions[0].title;
                                                copiedDeck.description = original.description;
                                                let original_language = copiedDeck.language;
                                                copiedDeck.language = language;
                                                copiedDeck.revisions[0].language = language;
                                                new_decks.push(copiedDeck);
                                                return col.insertOne(copiedDeck).then(() => {
                                                    let translations = [];
                                                    if (copiedDeck.translations) {
                                                        translations = copiedDeck.translations;
                                                        translations.push({'deck_id':copiedDeck._id, 'language':language});//filling in the translations array for all decks in the 'family'
                                                    }else{
                                                        translations.push({'deck_id':copiedDeck._id, 'language':language});
                                                        translations.push({'deck_id':original._id, 'language': original_language});
                                                    }

                                                    self.fill_translations('deck', translations)
                                                    .then(callback)
                                                    .catch((err) => {
                                                        console.log(err);
                                                        reject(err);
                                                    });
                                                });

                                                resolve();

                                            }
                                        })
                                        .catch(function (e){
                                            console.log('problem with request deck: ' + e.message);
                                            reject(e);
                                        });
                                    });
                                    //}).catch(reject);
                                });
                            });
                        }).catch(callback);
                    }, (err2) => {
                        if (err2) {
                            reject(err2);
                        } else {
                            resolve({'root_deck': id_map[res.id], 'id_map': id_map, 'slide_id_map': slide_id_map});
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

    // computes the usage of the item, i.e. the decks that point to it
    getUsage(itemId, itemKind='deck') {
        let item = util.parseIdentifier(itemId);
        let elemMatchQuery = {
            kind: itemKind,
            'ref.id': item.id,
        };

        let projectStage = {
            _id : 0,
            id: '$_id',
            revision: '$revisions.id',
        };

        if (item.revision) {
            elemMatchQuery['ref.revision'] = item.revision;
        } else {
            projectStage.using = {
                $arrayElemAt: [
                    { $filter: {
                        input: '$revisions.contentItems',
                        as: 'citem',
                        cond: {
                            $and: [
                                { $eq: ['$$citem.kind', itemKind] },
                                { $eq: ['$$citem.ref.id', item.id] },
                            ],
                        },
                    } },
                    0,
                ],
            };
        }

        let pipeline = [
            { $project: {
                revisions: {
                    id: 1,
                    contentItems: {
                        kind: 1,
                        ref: 1,
                    },
                },
            } },
            { $unwind: '$revisions' },
            { $match: {
                'revisions.contentItems': {
                    $elemMatch: elemMatchQuery,
                }
            } },
            { $project: projectStage },
        ];

        if (!item.revision) {
            // also clean up match property
            pipeline.push({
                $project: {
                    id: 1,
                    revision: 1,
                    using: '$using.ref.revision',
                },
            });
        }

        return helper.getCollection('decks')
        .then((decks) => decks.aggregate(pipeline))
        .then((result) => result.toArray());

    },

    // computes the usage of the item, i.e. the decks that point to it directly or indirectly
    getDeepUsage(itemId, itemKind='deck') {
        return self.getUsage(itemId, itemKind).then((parents) => {
            return parents.reduce((promise, parent) => {
                return promise.then((usage) => {
                    let parentId = util.toIdentifier(parent);
                    // a deck/slide parent is always a deck
                    return self.getDeepUsage(parentId).then((deepUsage) => {
                        // when method is called by client code the itemId may have revision
                        // in such a case `parent` includes a `using` attribute
                        // let's propagate that that in deep results
                        if (parent.using) {
                            deepUsage.forEach((u) => u.using = parent.using);
                        }
                        return usage.concat(deepUsage);
                    });
                });
            }, Promise.resolve(parents));
        });
    },

    // computes the decks that point to it directly or indirectly, and are roots themselves (their own parents is empty)
    // when item type is 'deck', includes the deck in question if it's a root deck (i.e. has no parents in the db)
    getRootDecks(itemId, itemKind='deck') {
        return self.getUsage(itemId, itemKind).then((parents) => {
            // return self if is deck and is root
            if (parents.length === 0) {
                if (itemKind === 'deck') {
                    return [util.parseIdentifier(itemId)];
                } else {
                    // orphan slide
                    return [];
                }
            }

            return parents.reduce((promise, parent) => {
                return promise.then((roots) => {
                    let parentId = util.toIdentifier(parent);
                    // a deck/slide parent is always a deck
                    return self.getRootDecks(parentId).then((deepRoots) => {
                        // when method is called by client code the itemId may have revision
                        // in such a case `parent` includes a `using` attribute
                        // let's propagate that that in deep results
                        if (parent.using) {
                            deepRoots.forEach((u) => u.using = parent.using);
                        }
                        return roots.concat(deepRoots);
                    });
                });
            }, Promise.resolve([]));
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

    replaceTags: function(deckId, tags, userId, rootDeckId){
        let deck = util.parseIdentifier(deckId);

        return self.get(deck.id).then((existingDeck) => {
            if (!existingDeck) return;

            // only the latest can be edited!
            let [latestRevision] = existingDeck.revisions.slice(-1);
            if (!latestRevision) return;

            // start tracking changes
            let deckTracker = ChangeLog.deckTracker(existingDeck, rootDeckId, userId);

            latestRevision.tags = tags;

            // changes ended here
            deckTracker.applyChangeLog();

            return helper.getCollection('decks')
            .then((col) => col.findOneAndReplace({ _id: deck.id }, existingDeck, { returnOriginal: false }) )
            .then((updated) => updated.value);
        });

    },

    // fetches specified media-type files that are present inside the deck
    getMedia: function(deckId, mediaType){
        return self.getFlatSlides(deckId, undefined, false).then( (flatSlides) => {
            if(!flatSlides) return;

            // get media uris per slide as arrays
            let media = flatSlides.children.map( (slide) => {
                return util.findMedia(slide.content, mediaType);
            });

            // flatten arrays of media uris
            let flatMedia = [].concat.apply([], media);

            // return unique media uris
            return [...new Set(flatMedia)];
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
                    // { $project: { _id: 0 } }, // TODO re-insert this after 3.4 upgrade
                    { $sort: { timestamp: 1 } },
                ]);
            }).then((result) => result.toArray());
        });

    },

    // returns change log record counts for all revisions of deck
    getChangesCounts: function(deckId) {
        let deck = util.parseIdentifier(deckId);
        return helper.getCollection('deckchanges').then((changes) => {

            return changes.aggregate([
                // primary filter
                { $match: {
                    $or: [
                        { 'path.id': deck.id },
                        {
                            'value.kind': 'deck',
                            'value.ref.id': deck.id,
                        },
                    ]
                } },
                // selection
                { $project: {
                    opgroup: {
                        $ifNull: [ { $arrayElemAt: ['$parents', 0] }, '$_id' ],
                    },
                    target: {
                        $cond: {
                            if: { $eq: ['$value.ref.id', deck.id] },
                            then: '$value.ref',
                            else: '$path',
                        }
                    }
                } },
                { $unwind: '$target' },
                // secondary filter
                { $match: { 'target.id': deck.id } },
                // first grouping, gets rid of groups
                { $group: {
                    _id: { revision: '$target.revision', opgroup: '$opgroup' },
                } },
                // second grouping, counts groups
                { $group: {
                    _id: '$_id.revision',
                    'changesCount': { $sum: 1 },
                } },

            ]);

        }).then((cursor) => {
            return new Promise((resolve, reject) => {
                let result = {};
                cursor.forEach((doc) => {
                    result[doc._id] = doc.changesCount;
                }, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            });
        });

    },
    // count deck forks for an array of deck ids
    countManyDeckForks(deckIds){
        let aggregateQuery = [
            {
                $match: {
                    'origin.id': {
                        $in: deckIds
                    }
                }
            },
            {
                $group: {
                    _id: '$origin.id',
                    forkCount: { $sum: 1 }
                }
            }
        ];

        return helper.connectToDatabase()
        .then((db) => db.collection('decks'))
        .then((col) => {
            return col.aggregate(aggregateQuery);
        }).then((cursor) => cursor.toArray());
    },

    // get  recent decks
    getAllRecent: function(limit, offset){
        return self.findWithLimitAndSort('decks', {}, limit, offset, {'timestamp': -1});
    },

    // get featured decks
    getAllFeatured: function(limit, offset){
        return self.findWithLimit('decks', {'revisions.isFeatured': 1}, limit, offset);
    },

    // get first slide
    getFirstSlide: function(revision) {
        // TODO two bugs in this code just by looking at it,
        // (1) it assumes first contentItem is slide
        // (2) it assumes there's at least one slide in contentItems, could be in subdecks
        // (3) it keeps iteration even though it found it
        let firstSlide;
        for (let key in revision.contentItems) {
            if (revision.contentItems[key].order === 1
                && revision.contentItems[key].kind === 'slide') {
                firstSlide = revision.contentItems[key].ref.id;

                if (revision.contentItems[key].ref.revision) {
                    firstSlide += '-' + revision.contentItems[key].ref.revision;
                }
            }
        }

        return firstSlide;
    }

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

    let usageArray = [];
    if (deck.root_deck) {
        usageArray.push(util.parseIdentifier(deck.root_deck));
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
