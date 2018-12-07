'use strict';

const _ = require('lodash');
const boom = require('boom');

const util = require('../lib/util');
const ChangeLog = require('../lib/ChangeLog');

const userService = require('../services/user');
const translationService = require('../services/translation');
const fileService = require('../services/file');

const helper = require('./helper'),
    striptags = require('striptags'),
    validateDeck = require('../models/deck').validateDeck;

const usageDB = require('./usage');

const async = require('async');

let self = module.exports = {

    list: function(query, options={}) {
        // sort stage
        let sortStage = {};
        if (options.sort === 'title') {
            sortStage = { 'revisions.title': 1 };
        } else if(options.sort === 'timestamp') {
            sortStage = { timestamp: -1 };
        } else if(options.sort === 'lastUpdate') {
            sortStage = { lastUpdate: -1 };
        } else {
            sortStage = { _id: 1 };
        }

        return helper.getCollection('decks').then((decks) => {
            let pipeline = [
                { $match: query },
                {
                    $project: {
                        user: 1,
                        active: 1,
                        hidden: 1,
                        description: 1,
                        timestamp: 1,
                        lastUpdate: 1,
                        revisions: 1,
                        tags: 1,
                        translation: 1,
                        countRevisions: {
                            $size: '$revisions'
                        }
                    }
                },
                { $unwind: '$revisions' },
                {
                    '$redact': {
                        '$cond': {
                            if: { $eq: [ '$active', '$revisions.id' ] },
                            then: '$$DESCEND',
                            else: '$$PRUNE'
                        }
                    }
                },
            ];

            if (options.rootsOnly) {
                pipeline.push(
                    { $addFields: {
                        usageCount: {
                            $size: '$revisions.usage'
                        },
                    } }
                );
                pipeline.push(
                    { $match: { 'usageCount': 0 } }
                );
            }

            // just count the result set
            if (options.countOnly) {
                pipeline.push({ $count: 'totalCount' });

            } else {
                // add sorting
                pipeline.push({ $sort: sortStage });

                // some routes don't support pagination
                if (options.pageSize) {
                    pipeline.push({ $skip: (options.page - 1) * options.pageSize });
                    pipeline.push({ $limit: options.pageSize });
                }
            }

            return decks.aggregate(pipeline);
        }).then( (result) => result.toArray());
    },

    // gets a specified deck and all of its revision, or only the given revision
    get: async function(identifier, variantFilter, fallbackFilter) {
        // TODO check why we allow invalid identifier as input here!!!
        let {id: deckId, revision: revisionId} = util.parseIdentifier(identifier) || {};

        let col = await helper.getCollection('decks');
        let found = await col.findOne({ _id: deckId, user: { $gt: 0 } });
        if (!found) return;

        if (revisionId) {
            let revision = _.find(found.revisions, { id: revisionId });
            if (!revision) return; // not found!

            // include only requested
            found.revisions = [revision];
        }

        // translate all revisions
        if (!_.isEmpty(variantFilter) || !_.isEmpty(fallbackFilter)) {
            for (let deckRevision of found.revisions) {
                if (!_.isEmpty(variantFilter) && variantFilter.language === deckRevision.language) {
                    // skip it if the same language as requested
                    continue;
                }

                // check if variant language exists
                let variantData = !_.isEmpty(variantFilter) && _.find(deckRevision.variants, variantFilter);
                if (!variantData && !_.isEmpty(fallbackFilter)) {
                    // if cannot match it, but fallbackFilter is provided, try again with that
                    if (fallbackFilter.language === deckRevision.language) {
                        // skip it if fallback matched with default language
                        continue;
                    }
                    variantData = _.find(deckRevision.variants, fallbackFilter);
                }

                if (variantData) {
                    // put the original (non-variant) data in a separate object here
                    let originalData = _.pick(deckRevision, Object.keys(variantData));
                    originalData.original = true;
                    deckRevision.variants.unshift(originalData);

                    // replace variant data in result object (but only if assigned already in variantData)
                    // found variant data, we need to first 
                    _.merge(deckRevision, variantData);
                }
            }
        }

        return found;
    },

    // TODO
    // this could likely replace #get as it returns a more uniform data structure,
    // only with the requested revision data merged into a single object
    getDeck: async function(identifier, variantFilter, fallbackFilter) {
        let {id, revision} = util.parseIdentifier(identifier) || {};

        let deck = await self.get(id, variantFilter, fallbackFilter);
        if (!deck) return;

        let [latestRevision] = deck.revisions.slice(-1);

        let deckRevision;
        if (!revision) {
            // if not set, we are looking at the latest one
            deckRevision = latestRevision;
            revision = latestRevision.id;
        } else {
            deckRevision = _.find(deck.revisions, { id: revision });
            if (!deckRevision) return; // not found
        }

        // merge revision data into deck data
        // don't mix revision owner with deck owner
        deckRevision.revisionUser = deckRevision.user;
        delete deckRevision.user;

        // also the revision timestamp and lastUpdate
        deckRevision.revisionTimestamp = deckRevision.timestamp;
        delete deckRevision.timestamp;
        deckRevision.revisionLastUpdate = deckRevision.lastUpdate;
        delete deckRevision.lastUpdate;

        _.merge(deck, deckRevision);

        // add proper ids, revision id
        deck.id = id;
        deck.revision = revision;
        // and latest revision id and revision count
        deck.latestRevision = latestRevision.id;
        deck.revisionCount = deck.revisions.length;
        // remove other revisions
        delete deck.revisions;

        return deck;
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
                                    }
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

    // collects deck from all matching deck ids in list
    collect: async function(path, deckProperties=[], revisionProperties=[]) {
        let projection = {};
        deckProperties.forEach((p) => {
            projection[p] = 1;
        });
        projection['revisions.$'] = 1;
        // revisionProperties.forEach((p) => {
        //     projection[`revisions.${p}`] = 1;
        // });

        let results = [];
        let decks = await helper.getCollection('decks');
        for (let {id, revision} of path) {
            if (!id) continue;

            let result = await decks.findOne({ _id: id, 'revisions.id': revision }, { fields: projection });
            if (result) {
                // bring revision properties to top level
                revisionProperties.forEach((p) => {
                    result[p] = result.revisions[0][p];
                });
                // delete revisions
                delete result.revisions;

                results.push(result);
            }
        }

        // init the arrays for collection
        let collected = { id: [] };
        deckProperties.forEach((p) => collected[p] = []);
        revisionProperties.forEach((p) => collected[p] = []);

        return results.reduce((collected, result) => {
            // collect the ids
            collected.id.push(result._id);

            // collect the properites
            [...deckProperties, revisionProperties].forEach((p) => {
                let value = result[p];
                if (_.isArray(value)) {
                    collected[p].push(...value);
                } else {
                    collected[p].push(value);
                }
            });

            return collected;
        }, collected);
    },

    // return a path array of deckId as it exists in the tree with rootDeckId as root
    // returns first occurence of targetId, or nothing if cannot find the path
    // if targetKind is deck, then the path includes that as last item
    findPath: function(sourceDeckId, targetId, targetKind = 'deck', path) {
        let source = util.parseIdentifier(sourceDeckId);
        let target = util.parseIdentifier(targetId);
        if (!target) return [];

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
                let variant;
                let foundSlideIndex = sourceRevision.contentItems.findIndex((citem) => {
                    if (citem.kind !== 'slide') return false;
                    if (citem.ref.id === target.id) return true;

                    // also check the variants
                    // set variant when such is found
                    return !!(variant = _.find(citem.variants, { id: target.id }));
                });
                let foundSlide = sourceRevision.contentItems[foundSlideIndex];

                // the path points to the slide, append just the index and return
                if (foundSlide) return path.concat({ index: foundSlideIndex, variant });
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
    insert: async function(payload, userId, skipTracking=false) {
        let newId = await helper.getNextId('decks');

        payload = Object.assign({
            // TODO put defaults here ?
        }, payload, {
            // TODO put other metadata here ?
            _id: newId,
            user: userId,
        });

        const convertedDeck = convertToNewDeck(payload);
        if (!validateDeck(convertedDeck)) {
            throw new Error(JSON.stringify(validateDeck.errors));
        }

        let decks = await helper.getCollection('decks');
        let result = await decks.insertOne(convertedDeck);

        if (!skipTracking) {
            // also track in change log, but only if it's not a subdeck or a fork etc.
            ChangeLog.trackDeckCreated(convertedDeck._id, userId);
        }

        // just added this one deck
        return result.ops[0];
    },

    // updates admin properties in patch object
    adminUpdate: async function(deckId, patch) {
        deckId = parseInt(deckId);

        let decks = await helper.getCollection('decks');
        let update = _.pick(patch, 'accessLevel', 'user');

        if (update.user) {
            // we also make it hidden:
            // 1) when deleting in order to be removed from the search index automatically
            // 2) when transferring owner, so that it doesn't display in the new owner's public decks right away

            // TODO alert user they own a new deck
            update.hidden = true;
        }

        return decks.findOneAndUpdate({ _id: deckId }, {
            $set: update,
        }, { returnOriginal: false }).then((result) => result.value);
    },

    // returns the new or existing request, with isNew set to true if it was new
    // returns undefined if deck does not exist
    addEditRightsRequest: function(deckId, userId) {
        return self.get(deckId).then((existingDeck) => {
            if (!existingDeck) return;

            let editRightsRequests = existingDeck.editRightsRequests;
            if (!editRightsRequests) {
                editRightsRequests = [];
            }

            let existingRequest = editRightsRequests.find((r) => r.user === userId);
            if (existingRequest) {
                return Object.assign({ isNew: false }, existingRequest);
            }

            let timestamp = new Date().toISOString();
            let newRequest = { user: userId, requestedAt: timestamp };
            editRightsRequests.push(newRequest);

            return helper.getCollection('decks')
            .then((decks) => decks.findOneAndUpdate({ _id: deckId }, { $set: { editRightsRequests }}))
            .then(() => Object.assign({ isNew: true }, newRequest));
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

                    if (!_.isEmpty(existingDeck.editRightsRequests)) {
                        // filter out any edit rights requests with users in editors list
                        let filteredRequests = existingDeck.editRightsRequests
                        .filter((r) => !existingDeck.editors.users.some((e) => e.id === r.user));

                        existingDeck.editRightsRequests = filteredRequests;
                    }
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

                // language is treated differently now
                let variantFilter = _.pick(deck, 'language');
                if (!_.isEmpty(variantFilter) && variantFilter.language !== deckRevision.language) {
                    // the data to update / add
                    let variantData = _.pick(deck, [
                        'title',
                        'description',
                    ]);
                    let variant = _.find(deckRevision.variants, variantFilter);
                    if (variant) {
                        // update the data if present in payload
                        Object.assign(variant, variantData);
                    } else {
                        // create a new variant!
                        Object.assign(variantData, variantFilter);
                        if (deckRevision.variants) {
                            deckRevision.variants.push(variantData);
                        } else {
                            deckRevision.variants = [variantData];
                        }
                    }

                } else {
                    // language must never be provided in API when changing the deck with default language
                    deckRevision.title = deck.title;
                    // TODO move the description to the deck revision level already!
                    deckRevision.description = deck.description;

                    existingDeck.description = deck.description;
                    existingDeck.license = deck.license;
                }

                if (deck.slideDimensions) {
                    existingDeck.slideDimensions = deck.slideDimensions;
                }

                // TODO add comment, abstract, footer

                if (!_.isEmpty(deck.tags)) {
                    deckRevision.tags = deck.tags;
                }

                let oldTheme = deckRevision.theme;
                if(!deck.hasOwnProperty('theme') || deck.theme === null){
                    deckRevision.theme = 'default';
                }
                else{
                    deckRevision.theme = deck.theme;
                }

                if(!deck.hasOwnProperty('allowMarkdown') || deck.allowMarkdown === null){
                    deckRevision.allowMarkdown = false;
                }
                else{
                    deckRevision.allowMarkdown = deck.allowMarkdown;
                }

                if (deck.hasOwnProperty('educationLevel')) {
                    deckRevision.educationLevel = deck.educationLevel;
                }

                if (deck.hasOwnProperty('hidden')) {
                    existingDeck.hidden = deck.hidden;
                }

                // lastUpdated update
                existingDeck.lastUpdate = (new Date()).toISOString();
                deckRevision.lastUpdate = existingDeck.lastUpdate;
                if (!_.isEmpty(deck.editors) ){
                    existingDeck.editors = deck.editors;
                }

                if (!validateDeck(deckRevision)) {
                    throw validateDeck.errors;
                }

                // save changes and wait for them
                return deckTracker.applyChangeLog()
                .then(() => col.findOneAndReplace({ _id: parseInt(id) }, existingDeck, { returnOriginal: false }))
                .then((result) => {
                    // return the new deck in database and a hash of changes of interest to caller
                    return {
                        replaced: result.value,
                        changed: {
                            // return the new theme, or false if unchanged
                            theme: (deckRevision.theme !== oldTheme) && deckRevision.theme,
                        },
                    };
                });
            });
        });
    },

    //renames a deck
    rename: function(deck_id, newName, variantFilter, top_root_deck, user){
        // if not included in the call, the deck itself is the top_root_deck
        top_root_deck = top_root_deck || deck_id;

        let {id: deckId} = util.parseIdentifier(deck_id);

        return helper.getCollection('decks')
        .then((col) => col.findOne({ _id: deckId })
        .then((deck) => {
            if (!deck) return;

            // always the latest
            let [deckRevision] = deck.revisions.slice(-1);
            if (!deckRevision) return;

            // start tracking changes
            let deckTracker = ChangeLog.deckTracker(deck, top_root_deck, user);

            if (!_.isEmpty(variantFilter)) {
                let existingVariant = _.find(deckRevision.variants, variantFilter);
                if (!existingVariant) {
                    // try to match the revision!
                    existingVariant = _.find([deckRevision], variantFilter);
                    if (!existingVariant) {
                        // ok, we can create it!!!!
                        existingVariant = Object.assign({}, variantFilter);
                        // make sure revision actually has variants!
                        if (deckRevision.variants) {
                            deckRevision.variants.push(existingVariant);
                        } else {
                            deckRevision.variants = [existingVariant];
                        }
                    }
                    // the existingVariant is the same object as the deckRevision by now
                }
                existingVariant.title = newName;
            } else {
                deckRevision.title = newName;
            }

            // lastUpdated update
            deck.lastUpdate = (new Date()).toISOString();
            deckRevision.lastUpdate = deck.lastUpdate;

            return deckTracker.applyChangeLog()
            .then(() => col.findOneAndReplace({_id: parseInt(deckId)}, deck, { returnOriginal: false }))
            .then((result) => result.value);
        }));
    },

    // simpler implementation of replace that does not update anything, just creates the revision
    revise: async function(deckId, path, userId, parentOperations=[]) {
        userId = parseInt(userId);

        let deck = util.parseIdentifier(deckId);

        // parent is second to last; if path length is 1, then parent is undefined
        let [parentDeck] = path.slice(-2, -1);

        // root is first; if path length is 1, the root is the deck itself
        let rootDeckId = util.toIdentifier(path[0]);

        let existingDeck = await self.get(deck.id);
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

        // update usage for new and origin revision
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

        // final metadata
        existingDeck.active = newRevisionId;
        existingDeck.lastUpdate = now;

        // add new revision to usage of each slide or subdeck
        // TODO let it fail ??? 
        await usageDB.addToUsage({
            id: deck.id,
            revision: newRevisionId,
        }, originRevision.contentItems);

        let decks = await helper.getCollection('decks');
        let batch = decks.initializeOrderedBulkOp();

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
            },
            $push: { 'revisions': newRevision },
        });
        await batch.execute();

        // complete the tracking after revision (it may be nothing)
        let deckChanges = await deckTracker.applyChangeLog(existingDeck);
        // deckChanges may be nothing if an error occured
        if (!parentDeck) return [existingDeck, deckChanges];

        // update parent deck first before returning
        let {deckChanges: moreDeckChanges} = await self.updateContentItem(existingDeck, '', util.toIdentifier(parentDeck), 'deck', userId, rootDeckId, parentOperations);
        return [existingDeck, deckChanges.concat(moreDeckChanges)];
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
                    activeRevisionId = parseInt(root_deck_path[1]);
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

                let updatedRevision = _.find(existingDeck.revisions, {id: activeRevisionId});

                existingDeck.lastUpdate = new Date().toISOString();
                updatedRevision.lastUpdate = existingDeck.lastUpdate;

                if(position && position > 0){
                    let citems = updatedRevision.contentItems;
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
                    updatedRevision.contentItems = citems;
                }
                else{
                    // add it to the end
                    // we need to track stuff, this doesn't help
                    let citems = updatedRevision.contentItems;
                    let newCitem = {
                        order: parseInt(getOrder(updatedRevision))+1,
                        kind: ckind,
                        ref : {
                            id: parseInt(citem.id),
                            revision:citem_revision_id
                        }
                    };
                    citems.push(newCitem);
                    updatedRevision.contentItems = citems;
                }

                return col.save(existingDeck)
                .then(() => deckTracker && deckTracker.applyChangeLog())
                .then(() => updatedRevision);
            });
        });

    },

    // new method for inserting, simply receives the content item and adds it 
    // into a deck at the specified position, or appends it at the end if no position is given
    insertContentItem: async function(citem, position, deckId, userId, rootDeckId, action) {
        position = parseInt(position);
        let deckRef = util.parseIdentifier(deckId);

        let decks = await helper.getCollection('decks');
        let existingDeck = await decks.findOne({ _id: deckRef.id });

        // always mess with the latest revision!
        let [updatedRevision] = existingDeck.revisions.slice(-1);
        // normalize deckRef
        if (!deckRef.revision) {
            deckRef.revision = updatedRevision.id;
        }

        let deckTracker;
        if (rootDeckId) {
            // only track this when rootDeckId is provided
            deckTracker = ChangeLog.deckTracker(existingDeck, rootDeckId, userId, [], action);
        }
        // copy edit rights from existingDeck to new
        if (citem.kind === 'deck') {
            let attachedDeckId = util.toIdentifier(citem.ref);
            await self.deepReplaceEditors(attachedDeckId, { editors: existingDeck.editors });
        }

        // TODO add contributor data after attaching if needed
        existingDeck.lastUpdate = new Date().toISOString();
        updatedRevision.lastUpdate = existingDeck.lastUpdate;

        let citems = updatedRevision.contentItems;
        if (position && position > 0) {
            for (let i = position - 1; i < citems.length; i++) {
                citems[i].order++;
            }

            let newCitem = Object.assign({
                order: position,
            }, citem);

            citems.splice(position - 1, 0, newCitem);
        } else {
            // add it to the end
            // we need to track stuff, this doesn't help
            let newCitem = Object.assign({
                order: parseInt(getOrder(updatedRevision)) + 1,
            }, citem);
            citems.push(newCitem);
        }

        // update content items array
        updatedRevision.contentItems = citems;

        if (deckTracker) await deckTracker.applyChangeLog();

        await decks.save(existingDeck);

        // handle usage as well
        await usageDB.addToUsage(deckRef, [citem]);

        return updatedRevision;
    },

    // removes (unlinks) a content item from a given deck
    removeContentItem: async function(position, root_deck, top_root_deck, userId){
        let parentDeck = util.parseIdentifier(root_deck) || {};

        let decks = await helper.getCollection('decks');
        let existingDeck = await decks.findOne({_id: parentDeck.id});

        // TODO get the active (?) if missing
        if (!parentDeck.revision) {
            parentDeck.revision = existingDeck.active;
        }

        // skip tracking if no top_root_deck or userId provided
        let deckTracker;
        if (top_root_deck && userId) {
            deckTracker = ChangeLog.deckTracker(existingDeck, top_root_deck, userId);
        }

        let deckRevision = _.find(existingDeck.revisions, { id: parentDeck.revision });
        let citems = deckRevision.contentItems;
        for(let i = position-1; i < citems.length; i++){
            citems[i].order = citems[i].order-1;
        }
        let citemToRemove = citems[position-1];

        citems.splice(position-1, 1);
        deckRevision.contentItems = citems;

        existingDeck.lastUpdate = new Date().toISOString();
        deckRevision.lastUpdate = existingDeck.lastUpdate;

        if (deckTracker) await deckTracker.applyChangeLog();

        await decks.save(existingDeck);

        // handle usage as well
        await usageDB.removeFromUsage(parentDeck, [citemToRemove]);

        return citemToRemove;
    },

    //removes an item from the usage of a given deck
    // DEPRECATED
    removeFromUsage: function(itemToRemove, root_deck_path){
        let itemId = itemToRemove.ref.id;
        let itemRevision = itemToRemove.ref.revision;
        if(itemToRemove.kind === 'slide'){
            return helper.connectToDatabase()
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
            return helper.connectToDatabase()
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
    // DEPRECATED
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
    updateContentItem: function(citem, revertedRevId, parentDeckId, ckind, userId, rootDeckId, parentOperations) {
        userId = parseInt(userId);
        return helper.getCollection('decks').then((decks) => {
            let parentDeck = util.parseIdentifier(parentDeckId);

            return decks.findOne({ _id: parentDeck.id }).then((existingDeck) => {
                let newRevision;
                if (revertedRevId) {
                    newRevision = revertedRevId;
                } else {
                    newRevision = getNewRevisionID(citem);
                }

                // pre-compute what the for loop does
                let deckTracker;
                if (rootDeckId) { // tracking is optional
                    deckTracker = ChangeLog.deckTracker(existingDeck, rootDeckId, userId, parentOperations, revertedRevId ? 'revert' : undefined);
                }

                existingDeck.lastUpdate = new Date().toISOString();

                // only the latest revision is updateable!
                let [updatedDeckRevision] = existingDeck.revisions.slice(-1);
                updatedDeckRevision.lastUpdate = existingDeck.lastUpdate;

                let existingItem = updatedDeckRevision.contentItems.find((i) => i.ref.id === citem._id && i.kind === ckind);
                let oldRevision = existingItem.ref.revision;
                existingItem.ref.revision = newRevision;

                return decks.save(existingDeck)
                .then(() => deckTracker && deckTracker.applyChangeLog())
                .then((deckChanges) => {
                    return {
                        oldRevision,
                        newRevision,
                        deckChanges,
                        updatedDeckRevision,
                    };
                });
            });
        });
    },

    // inserts or updates a variant (language dependent only) id and revision in position index under given deck
    setContentVariant: async function(parentDeckId, index, newVariant, userId) {
        // latest revision always
        let existingDeck = await self.getDeck(parentDeckId);
        if (!existingDeck) return;

        let contentItem = existingDeck.contentItems[index];
        let variants = contentItem.variants || [];
        let existingVariant = _.find(variants, { language: newVariant.language });
        if (existingVariant) {
            // effectively replaces values in existing variant
            _.merge(existingVariant, newVariant);
        } else {
            variants.push(newVariant);
        }

        let now = new Date().toISOString();
        let decks = await helper.getCollection('decks');
        let result = await decks.findOneAndUpdate(
            { _id: existingDeck.id, 'revisions.id': existingDeck.revision },
            { $set: {
                lastUpdate: now,
                'revisions.$.lastUpdate': now,
                [`revisions.$.contentItems.${index}.variants`]: variants,
            } },
            { returnOriginal: false }
        );

        return result.value;
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

    // returns a flattened structure of a deck's sub-decks
    getFlatDecks: async function(deckId, variantFilter, deckTree) {
        let deck = await self.getDeck(deckId, variantFilter);
        if (!deck) return; // not found

        // make it canonical
        deckId = util.toIdentifier(deck);

        let deckNode = {
            type: 'deck',
            id: deckId,
            title: deck.title,
            user: String(deck.user),
        };

        if (!deckTree) {
            // is root
            deckTree = Object.assign(deckNode, {
                children: [],
            });
        } else {
            // is subdeck, add flat to children
            deckTree.children.push(deckNode);
        }

        // recurse!
        for (let item of _.filter(deck.contentItems, { kind: 'deck' })) {
            let itemId = util.toIdentifier(item.ref);
            await self.getFlatDecks(itemId, variantFilter, deckTree);
        }

        return deckTree;
    },

    // return the set of users and groups with write access to the deck
    async getDeckUsersGroups(deckOrId) {
        let deck;
        if (typeof deckOrId !== 'object') {
            // it's an id
            deck = await self.getDeck(deckOrId);
        } else {
            // it's the deck
            deck = deckOrId;
        }
        if (!deck) return; // not found

        let accessLevel = deck.accessLevel || 'public';

        if (accessLevel === 'private') {
            return {
                users: [deck.user],
                groups: [],
            };

        } else {

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
                    users: users.map((u) => u.id),
                    groups: groups.map((g) => g.id),
                };

            } else {
                throw new Error(`Unexpected accessLevel: ${accessLevel}`);
            }

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

    updateTranslations(kind, translations_array){
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

    getDeckVariants: async function(deckId) {
        let deck = await self.getDeck(deckId);
        if (!deck) return;

        // also put the original (non-variant) data in a separate object here
        let originalData = Object.assign({
            original: true,
        }, _.pick(deck, 'title', 'description', 'language'));

        return [originalData, ...(deck.variants || [])];
    },

    addDeckVariant: async function(deckId, variantData, userId, rootId) {
        let deck = await self.get(deckId);
        if (!deck) return;

        // always work with latest revision
        let [latestRevision] = deck.revisions.slice(-1);
        // ensure variants
        if (!latestRevision.variants) {
            latestRevision.variants = [];
        }

        // check against the deck language and the variants array
        // for now we only support language as variant definition
        let variantFilter = _.pick(variantData, 'language');
        if (latestRevision.language === variantFilter.language || _.find(latestRevision.variants, variantFilter)) {
            throw boom.badData(`deck variant for ${Object.entries(variantFilter)} already exists for deck ${deckId}`);
        }

        // start tracking here
        // if missing, the deck is the root
        rootId = rootId || deckId;
        let deckTracker = ChangeLog.deckTracker(deck, rootId, userId);

        // here deck changes
        latestRevision.variants.push(variantData);

        let decks = await helper.getCollection('decks');
        await decks.findOneAndUpdate(
            { _id: deck._id, 'revisions.id': latestRevision.id },
            { $set: { 'revisions.$.variants': latestRevision.variants } }
        );

        // wait before responding
        await deckTracker.applyChangeLog();

        // respond with provided variant data on success
        return variantData;
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
            }

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

    // queries the database to return the set of all decks that are part of a deck fork chain
    // the group can be identified by the deck with minimum id (earliest created one)
    // if it returns an empty array, it means the deck id is NOT in the database
    computeForkGroup(deckId) {
        deckId = parseInt(deckId);
        let pipeline = [
            { $match: { _id: deckId } },
            { $project: { origin: 1 } },
            // add the origins
            { $graphLookup: {
                from: 'decks',
                startWith: '$origin.id',
                connectFromField: 'origin.id',
                connectToField: '_id',
                as: 'origins',
            } },
            { $project: {
                origins: { _id: 1 },
            } },
            // add self in origins, it could be the fork group root
            { $project: {
                origins: { $setUnion: [ '$origins', [{ _id: '$_id' }] ] },
            } },
            // add the forks of origins
            { $graphLookup: {
                from: 'decks',
                startWith: '$origins._id',
                connectFromField: '_id',
                connectToField: 'origin.id',
                as: 'originsforks',
            } },
            { $project: {
                origins: 1,
                originsforks: { _id: 1 },
            } },
            // add the forks
            { $graphLookup: {
                from: 'decks',
                startWith: '$_id',
                connectFromField: '_id',
                connectToField: 'origin.id',
                as: 'forks',
            } },
            { $project: {
                _id: 0,
                origins: 1,
                originsforks: 1,
                forks: { _id: 1 },
            } },
            { $project: {
                forkGroup: { $setUnion: [ '$origins', '$forks', '$originsforks' ] },
            } },
            { $unwind: '$forkGroup' },
            { $project: { id: '$forkGroup._id' } },
        ];

        return helper.getCollection('decks')
        .then((decks) => decks.aggregate(pipeline))
        .then((result) => result.map((d) => d.id).toArray());
    },

    // computes the usage of the item, i.e. the decks that point to it
    getUsage(itemId, itemKind='deck', keepVisibleOnly=false) {
        let item = util.parseIdentifier(itemId);

        // prepare some objects to be used later for building the pipeline
        let elemMatchQuery = {
            'ref.id': item.id,
        };
        let variantMatchQuery = {
            'variants.id': item.id,
        };

        let projectStage = {
            _id : 0,
            id: '$_id',
            revision: '$revisions.id',
            theme: '$revisions.theme',
        };

        if (item.revision) {
            elemMatchQuery['ref.revision'] = item.revision;
            variantMatchQuery['variants.revision'] = item.revision;
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
            // always match as first stage to be fast because of indexes
            { $match: {
                'revisions.contentItems': {
                    $elemMatch: {
                        kind: itemKind,
                        $or: [
                            elemMatchQuery,
                            variantMatchQuery,
                        ],
                    }
                }
            } },
            { $unwind: '$revisions' },
            { $project: {
                revisions: {
                    id: 1,
                    // we need to reform this array to include the variants as contentItems to filter later
                    contentItems: {
                        $reduce: {
                            input: '$revisions.contentItems',
                            initialValue: [],
                            in: {
                                $concatArrays: [
                                    '$$value',
                                    [ { kind: '$$this.kind', ref: '$$this.ref', } ],
                                    { $ifNull: [
                                        { $map: {
                                            input: '$$this.variants',
                                            as: 'variant',
                                            in: { kind: '$$this.kind', ref: '$$variant' },
                                        } },
                                        [],
                                    ] },
                                ],
                            },
                        }
                    },
                    theme: 1,
                },
            } },
            { $match: {
                'revisions.contentItems': {
                    $elemMatch: _.merge({
                        kind: itemKind,
                    }, elemMatchQuery),
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
                    theme: 1,
                    using: '$using.ref.revision',
                },
            });
        }

        return helper.getCollection('decks')
        .then((decks) => decks.aggregate(pipeline))
        .then((result) => result.toArray())
        .then((usage) => {
            if (keepVisibleOnly) {
                // remove parents that are not visible
                return usage.reduce((promise, parent) => {
                    return promise.then((visibleUsage) => {
                        return self.get(parent.id).then((parentDeck) => {
                            let [latestRevision] = parentDeck.revisions.slice(-1);
                            if (latestRevision.id !== parent.revision) {
                                return visibleUsage;
                            } else {
                                return visibleUsage.concat(parent);
                            }
                        });
                    });
                }, Promise.resolve([]));

            } else {
                return usage;
            }

        });

    },

    // computes the usage of the item, i.e. the decks that point to it directly or indirectly
    getDeepUsage(itemId, itemKind='deck', keepVisibleOnly=true) {
        return self.getUsage(itemId, itemKind, keepVisibleOnly).then((parents) => {
            return parents.reduce((promise, parent) => {
                return promise.then((usage) => {
                    let parentId = util.toIdentifier(parent);
                    // a deck/slide parent is always a deck
                    return self.getDeepUsage(parentId, 'deck', keepVisibleOnly).then((deepUsage) => {
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
    getRootDecks(itemId, itemKind='deck', keepVisibleOnly=true) {
        let item = util.parseIdentifier(itemId);
        if (keepVisibleOnly && itemKind === 'deck' && item.revision) {
            return self.get(item.id).then((existingDeck) => {
                if (!existingDeck) return [];

                let [latestRevision] = existingDeck.revisions.slice(-1);
                if (latestRevision.id === item.revision) {
                    return self._getRootDecks(itemId, itemKind, keepVisibleOnly);
                } else {
                    return [];
                }
            });
        }

        return self._getRootDecks(itemId, itemKind, keepVisibleOnly);
    },

    _getRootDecks(itemId, itemKind='deck', keepVisibleOnly=true) {
        return self.get(itemId).then( (deck) => {
            return self.getUsage(itemId, itemKind).then((parents) => {
                // return self if is deck and is root
                if (parents.length === 0) {
                    if (itemKind === 'deck') {
                        let item = util.parseIdentifier(itemId);
                        item.hidden = deck.hidden;
                        return [item];
                    } else {
                        // orphan slide
                        return [];
                    }
                }

                return parents.reduce((promise, parent) => {
                    return promise.then((roots) => {
                        let parentId = util.toIdentifier(parent);
                        // a deck/slide parent is always a deck
                        return self.getRootDecks(parentId, 'deck', keepVisibleOnly).then((deepRoots) => {
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
        });
    },

    getDeckOwners(query) {

        return helper.getCollection('decks').then((decks) => {

            return decks.aggregate([
                // apply filter
                { $match: query },
                // group by user and count decks
                { $group: {
                    _id: '$user',
                    'decksCount': { $sum: 1 },
                } },
                { $sort: { _id: 1 } },
            ]);

        }).then((cursor) => cursor.toArray());

    },

    // computes all deck permissions the user has been granted
    async userPermissions(deckId, userId) {
        userId = parseInt(userId);
        let deck = await self.getDeck(deckId);

        if (!deck) return;

        // return {readOnly: true} if requesting any revision other than the latest
        let readOnly = (deck.revision !== deck.latestRevision);
        if (deck.user === userId) {
            // deck owner, return all
            return { fork: true, edit: true, admin: true, readOnly };
        }

        let canFork = !deck.hidden;
        let editors = await self.getDeckUsersGroups(deck);

        if (editors.users.includes(userId)) {
            // user is an editor
            return { fork: canFork, edit: true, admin: false, readOnly };
        } else {
            // we also need to check if the groups allowed to edit the deck include the user
            let groupsUsers;
            try {
                groupsUsers = await userService.fetchUsersForGroups(editors.groups);
            } catch (err) {
                console.warn(`could not fetch usergroup info from service: ${err.message}`);
                // we're not sure, let's just not allow this user
                return { fork: canFork, edit: false, admin: false, readOnly };
            }

            if (groupsUsers.includes(userId)) {
                // user is an editor
                return { fork: canFork, edit: true, admin: false, readOnly };
            } else {
                // user is not an editor or owner
                // also return if user can fork the deck (e.g. if it's public)
                return { fork: canFork, edit: false, admin: false, readOnly };
            }

        }

    },

    // computes fork permission only
    forkAllowed(deckId, userId) {
        userId = parseInt(userId);
        return self.get(deckId).then((deck) => {
            if (!deck) return;

            if (deck.hidden) {
                // no-one but the deck owner can fork it!!
                return deck.user === userId;
            }

            // if not hidden you can fork it always
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
                    return col.save(deck).then(() => deck.revisions[revisionId].tags);
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

                return col.save(deck).then(() => deck.revisions[revisionId].tags);
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

            // update lastUpdate of deck and revision
            let now = new Date().toISOString();

            existingDeck.lastUpdate = now;
            latestRevision.lastUpdate = now;

            // changes ended here
            return deckTracker.applyChangeLog()
            .then(() => helper.getCollection('decks'))
            .then((col) => col.findOneAndReplace({ _id: deck.id }, existingDeck, { returnOriginal: false }) )
            .then((updated) => updated.value);
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
        return self.findWithLimitAndSort('decks', {
            hidden: { $in: [false, null] },
        }, limit, offset, {'timestamp': -1});
    },

    // get featured decks
    getAllFeatured: function(limit, offset){
        return self.findWithLimit('decks', {
            'revisions.isFeatured': 1,
            hidden: { $in: [false, null] },
        }, limit, offset);
    },

    // get first slide
    // DEPRECATED
    getFirstSlide: function(revision) {
        // TODO this code assumes there's at least one slide in contentItems, could be in subdecks

        let firstSlideItem = revision.contentItems.find((item) => item.kind === 'slide');
        if (!firstSlideItem) return;

        // we need to pick the slide in the revision language
        if (!_.isEmpty(firstSlideItem.variants)) {
            let variant = firstSlideItem.variants.find((v) => v.language === revision.language);
            if (variant) {
                return util.toIdentifier(variant);
            }
        }

        return util.toIdentifier(firstSlideItem.ref);
    },

    archiveDeck: async function(deckId, userId, reason='spam', comment) {
        let db = await helper.connectToDatabase();
        let existingDeck = await db.collection('decks').findOne({_id: parseInt(deckId)});

        // store deck in 'deck_archived' collection
        let archivedCol = db.collection('decks_archived');

        // add some archival metadata
        existingDeck.archiveInfo = {
            archivedAt: new Date().toISOString(),
            archivedBy: userId,
            reason: reason,
        };

        if (comment) existingDeck.archiveInfo.comment = comment;

        await archivedCol.save(existingDeck);

        // remove from 'deck' collection
        let removeDeckPromise = db.collection('decks').remove({'_id': existingDeck._id});

        // update usage of its content slides
        let updateSlidesUsagePromise = (async() => {
            let slides = db.collection('slides');
            for (let revision of existingDeck.revisions) {
                for (let item of revision.contentItems) {
                    if (item.kind !== 'slide') continue;

                    // combine all refs in one array
                    let refs = [item.ref, ...(item.variants || [])];
                    for (let ref of refs) {
                        await slides.findOneAndUpdate(
                            {
                                _id: ref.id,
                                'revisions.id': ref.revision,
                            },
                            { $pull: {
                                'revisions.$.usage': {
                                    id: existingDeck._id,
                                    revision: revision.id,
                                },
                            } }
                        );
                    }
                }
            }
        })();

        return Promise.all([removeDeckPromise, updateSlidesUsagePromise]);
    },

    // moves the entire deck tree including all subdecks to the archive
    // can only be used for root decks, i.e. decks that are subdecks of none
    archiveDeckTree: async function(deckId, userId, reason='spam', comment) {
        // verify if it's a root deck
        let parents = await self.getUsage(deckId);
        // if it's a root deck, parents should be empty
        if (_.size(parents) > 0) {
            // abort!
            throw boom.methodNotAllowed(`cannot archive a non-root deck ${deckId}`);
        }

        let res = await self.getFlatDecks(deckId);
        if (!res) throw boom.notFound();

        for (let subdeckChild of res.children) {
            let subdeck = util.parseIdentifier(subdeckChild.id);
            await self.archiveDeck(subdeck.id, userId);
        }

        // when it's done, continue with archiving the root deck
        return self.archiveDeck(deckId, userId, reason, comment);
    },

    // DEPRECATED
    getEnrichedDeckTree: function(deckId, onlyDecks=false, path=[]){
        return self.getDeck(deckId).then( (deck) => {
            if(!deck) return;

            // make deckId canonical
            deckId = util.toIdentifier(deck);

            return self.getRevision(deckId).then( (revision) => {

                path.push({id: deck._id, revision: deck.revision, hidden: deck.hidden});

                let decktree = {
                    id: deck._id, 
                    revisionId: deck.revision, 
                    latestRevisionId: deck.latestRevision, 
                    type: 'deck',
                    title: revision.title, 
                    description: deck.description, 
                    timestamp: deck.timestamp, 
                    lastUpdate: deck.lastUpdate, 
                    language: revision.language, 
                    owner: deck.user, 
                    tags: revision.tags.map ( (tag) => { return tag.tagName; }),
                    path: path,
                    hidden: deck.hidden,
                    contents: []
                };

                return new Promise( (resolve, reject) => {
                    async.eachSeries(revision.contentItems, (item, callback) => {

                        let subdocumentId = `${item.ref.id}-${item.ref.revision}`;

                        let subPath = _.cloneDeep(path);

                        if(item.kind === 'deck'){
                            self.getEnrichedDeckTree(subdocumentId, onlyDecks, subPath)
                            .then( (subdecktree) => {
                                decktree.contents.push(subdecktree);
                                callback();
                            }).catch(callback);
                        } else {
                            if(onlyDecks) callback();

                            helper.connectToDatabase()
                            .then((db) => db.collection('slides'))
                            .then((col) => {
                                return col.findOne({_id: parseInt(item.ref.id)})
                                .then((slide) => {
                                    if(!slide) callback();

                                    let revision = slide.revisions.find( (rev) => {return rev.id === item.ref.revision; });
                                    if(!revision) callback();

                                    let slideDetails = {
                                        id: slide._id,
                                        revisionId: revision.id,
                                        type: 'slide',
                                        title: revision.title,
                                        content: revision.content,
                                        speakernotes: revision.speakernotes,
                                        timestamp: slide.timestamp,
                                        lastUpdate: slide.lastUpdate,
                                        language: revision.language,
                                        owner: slide.user,
                                        path: path,
                                    };

                                    decktree.contents.push(slideDetails);
                                    callback();
                                });
                            }).catch(callback);
                        }
                    }, (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(decktree);
                        }
                    });
                });
            });
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

    deck.user = parseInt(deck.user);

    if(!deck.hasOwnProperty('tags') || deck.tags === null){
        deck.tags = [];
    }
    if(!deck.hasOwnProperty('theme') || deck.theme === null){
        deck.theme = 'default';
    }
    if(!deck.hasOwnProperty('allowMarkdown') || deck.allowMarkdown === null){
        deck.allowMarkdown = false;
    }
    if(deck.hasOwnProperty('editors') && deck.editors === null){
        deck.editors = {users: [], groups: []};
    }
    else if(!deck.hasOwnProperty('editors')){
        deck.editors = {users: [], groups: []};
    }

    if (!deck.hasOwnProperty('hidden')) {
        // all new decks (or subdecks) are hidden by default unless overriden
        deck.hidden = true;
    }

    // clean up nulls / undefined
    let revision = _.omitBy({
        id: 1,
        usage: [],
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
        contentItems: deck.contentItems || [],
        variants: deck.variants || [],
        theme: deck.theme,
        allowMarkdown: deck.allowMarkdown,
        educationLevel: deck.educationLevel,
    }, _.isNil);

    //should we have a default accessLevel?
    return _.omitBy({
        _id: deck._id,
        user: deck.user,
        hidden: deck.hidden,
        origin: deck.origin,
        accessLevel: deck.accessLevel,
        editors: deck.editors,
        timestamp: now.toISOString(),
        description: deck.description,
        translated_from: deck.translation,
        lastUpdate: now.toISOString(),
        datasource: deck.datasource,
        license: deck.license,
        slideDimensions: deck.slideDimensions,
        active: 1,
        revisions: [revision]
    }, _.isNil);

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
