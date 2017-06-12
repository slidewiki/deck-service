'use strict';

const _ = require('lodash');
const async = require('async');

const Immutable = require('immutable');
const diff = require('immutablediff');
const patch = require('immutablepatch');

const util = require('../lib/util');

const deckModel = require('../models/deck');
const changeModel = require('../models/deckChange');

const helper = require('../database/helper');

const ChangeLogRecord = {

    createUpdate: function(before, after, path) {
        // before and after are objects and could have the same values,
        // we only want to keep in both the attributes that are different in any way
        let beforeDiff = _.omitBy(before, (value, key) => _.isEqual(value, after[key]));
        let afterDiff = _.omitBy(after, (value, key) => _.isEqual(value, before[key]));

        if (_.isEmpty(beforeDiff) && _.isEmpty(afterDiff)) return;

        return {
            op: 'update',

            path: path,

            values: afterDiff,
            oldValues: beforeDiff,

            timestamp: (new Date()).toISOString(),
        };
    },

    createNodeRemove: function(before, index, path) {
        // we keep the removed value and its index
        return {
            op: 'remove',

            path: path.concat({ index }),
            value: before[index],

            timestamp: (new Date()).toISOString(),
        };

    },

    createNodeInsert: function(after, index, path) {
        if (!_.isEmpty(path) && _.isNumber(index)) path = path.concat({ index });

        // we set this to zero because the value will be the first item in after
        if (!_.isNumber(index)) index = 0;

        // we keep the added value and its index
        return {
            op: 'add',

            path: path,
            value: after[index],

            timestamp: (new Date()).toISOString(),
        };

    },

    createNodeUpdate: function(before, after, index, path) {
        if (!_.isEmpty(path) && _.isNumber(index)) path = path.concat({ index });

        return {
            op: 'replace',

            path: path,

            value: after,
            oldValue: before,

            timestamp: (new Date()).toISOString(),
        };

    },

    createNodeReplace: function(contentItems, replaceOps, index, path) {
        if (!_.isEmpty(path) && _.isNumber(index)) path = path.concat({ index });

        let before = contentItems.get(index).toJS();
        let after = patch(contentItems, replaceOps).get(index).toJS();

        return {
            op: 'replace',

            path: path,

            value: after,
            oldValue: before,

            timestamp: (new Date()).toISOString(),
        };

    },
};

// flag to enable/disable track detailed revert change log
const detailedRevertChangeLog = true;

// returns a new object without `order` property
const omitOrder = (item) => _.omit(item, 'order');

let self = module.exports = {

    deckTracker: function(deck, rootDeckId, user, parentOperations=[], editAction) {
        // parentOperations is an array of deck change records that includes
        // any change records that act as a source for the operation we are currently tracking
        // those for now are really only one deck change
        // the one that started either of the actions: revise, revert, fork, or attach!

        // user is integer
        if (user) user = parseInt(user);

        // latest is the only editable revision!!
        const [revision] = deck.revisions.slice(-1);

        // we only keep the properties we'd like to track for changes
        // we cloneDeep to make sure we don't share any references between deck/trackableDeck etc
        const deckBefore = _.cloneDeep(_.pick(
            deck,
            _.keys(deckModel.trackedDeckProperties)));

        // in order to do the comparison, we merge revision into deck and only keep trackable stuff
        _.merge(deckBefore, _.cloneDeep(_.pick(
            revision,
            _.keys(deckModel.trackedDeckRevisionProperties))
        ));

        // we keep this here for children tracking
        const contentItemsBefore = Immutable.fromJS(revision.contentItems.map(omitOrder));

        return {
            // returns the change log record that should be appended to the database
            // should be called right after all changes are made, and before saving the deck object
            deckUpdateRecords: function(path, updatedDeck) {
                // we may have two records here: one for updating the values
                // the other for updating the revision (but only when not a subdeck)
                let records = [];

                // check if we are applying update to deck across revisions
                // in that case the deck/updatedDeck latest revisions will be different
                let updatedRevision = revision;
                [updatedRevision] = updatedDeck.revisions.slice(-1);

                if (revision.id !== updatedRevision.id) {
                    // this means we are creating a new revision for the deck
                    // that means that we should have an 'update' change log record

                    // if the path length is 1, we need to record a ROOT deck 'replace'
                    if (path.length === 1) {

                        let before = {
                            kind: 'deck',
                            ref: {
                                id: deck._id,
                                revision: revision.id,
                            },
                        };
                        let after = {
                            kind: 'deck',
                            ref: {
                                id: deck._id,
                                revision: updatedRevision.id,
                            },
                        };

                        // no index or path in this case
                        records.push(ChangeLogRecord.createNodeUpdate(before, after));

                    }

                } else {
                    // there is no revision change, so we need to check if some values
                    // in the deck revision (which is always the latest) where updated 

                    let deckAfter = _.cloneDeep(_.pick(updatedDeck, _.keys(deckModel.trackedDeckProperties)));

                    // in order to do the comparison, we merge revision into deck and only keep trackable stuff
                    _.merge(deckAfter, _.cloneDeep(_.pick(
                        updatedRevision,
                        _.keys(deckModel.trackedDeckRevisionProperties))
                    ));

                    // this may include empty slots nothing, which is ok
                    records.push(ChangeLogRecord.createUpdate(deckBefore, deckAfter, path));
                }

                // this may be a sparse array!
                return records;
            },

            contentItemsRecords: function(path, updatedDeck) {
                // check if we are applying update to deck across revisions
                // in that case the deck/updatedDeck latest revisions will be different
                let updatedRevision = revision;
                [updatedRevision] = updatedDeck.revisions.slice(-1);

                if (revision.id !== updatedRevision.id) {
                    if (revision.originRevision < revision.id) {
                        // this is a revert! check the flag
                        if (!detailedRevertChangeLog) {
                            // do nothing
                            return [];
                        } else {
                            console.log(`generating change log for deck ${deck._id} revert action from ${revision.id} to ${updatedRevision.originRevision}`);
                        }
                    } else {
                        console.log(`generating change log for deck ${deck._id} revise action from ${revision.id}`);
                    }
                }

                const contentItemsAfter = Immutable.fromJS(updatedRevision.contentItems.map(omitOrder));
                const contentItemOps = diff(contentItemsBefore, contentItemsAfter);

// console.log(path);
// console.log(contentItemsBefore);
// console.log(contentItemsAfter);
// console.log(contentItemOps);

                // in order to get correct positions, we need to apply each diff op
                // to the contentItemsBefore object incrementally as we iterate through the diffs
                let contentItemsPatched = contentItemsBefore;

                let replaceOpsGroup = [], lastReplaceIndex;
                // we have a list of JSON patch-style operations, which we would like to save in the log
                // in a reversible way as to provide full log capabilities without need for current state
                let result = contentItemOps.toJS().concat({ op: 'dummy' }).reduce((acc, rec) => {
                    // we add a dummy record to make sure we process everything
                    let nextRecord;

                    if (rec.op !== 'replace') {
                        // check if anything's in the replace group and add it before moving on
                        if (replaceOpsGroup.length) {
                            // starts another group
                            // create the record from the current group
                            let patchList = Immutable.fromJS(replaceOpsGroup);
                            acc.push(ChangeLogRecord.createNodeReplace(contentItemsPatched, patchList, lastReplaceIndex, path));

                            // patch the contentItems!
                            contentItemsPatched = patch(contentItemsPatched, patchList);
                            // clear the group
                            replaceOpsGroup.length = 0;
                            // unset the replace index
                            lastReplaceIndex = -1;
                        }
                    }

                    if (rec.op === 'remove') {
                        // we only expect removal of an index, will throw an error otherwise
                        let indexMatch = rec.path.match(/^\/(\d+)$/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${updatedRevision.id}: ${JSON.stringify(rec)}`);
                        }

                        // indexMatch[1] includes just the index added
                        let index = parseInt(indexMatch[1]);
                        nextRecord = ChangeLogRecord.createNodeRemove(contentItemsPatched.toJS(), index, path);

                        // for remove op, we need to patch the contentItems AFTER we create the record!
                        contentItemsPatched = patch(contentItemsPatched, Immutable.fromJS([rec]));
                    }

                    if (rec.op === 'add') {
                        // we only expect adding an element will throw an error otherwise
                        let indexMatch = rec.path.match(/^\/(\d+)$/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${updatedRevision.id}: ${JSON.stringify(rec)}`);
                        }

                        // indexMatch[1] includes just the index added
                        let index = parseInt(indexMatch[1]);

                        // for add op, we need to patch the contentItems BEFORE we create the record!
                        contentItemsPatched = patch(contentItemsPatched, Immutable.fromJS([rec]));

                        nextRecord = ChangeLogRecord.createNodeInsert(contentItemsPatched.toJS(), index, path);
                    }

                    if (rec.op === 'replace') {
                        // for now we expect only 'kind', 'ref/id', or 'ref/revision' paths
                        let indexMatch = rec.path.match(/^\/(\d+)\/(kind|ref\/(?:id|revision))$/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${updatedRevision.id}: ${JSON.stringify(rec)}`);
                        }

                        // indexMatch[1] includes just the index added
                        let index = parseInt(indexMatch[1]);

                        // replace ops may include one or more types in sequence for the same index
                        // we would like to merge them into one record
                        if (replaceOpsGroup.length) {
                            if (lastReplaceIndex !== index) {
                                // starts another group
                                // create the record from the current group
                                let patchList = Immutable.fromJS(replaceOpsGroup);
                                nextRecord = ChangeLogRecord.createNodeReplace(contentItemsPatched, patchList, lastReplaceIndex, path);

                                // patch the contentItems!
                                contentItemsPatched = patch(contentItemsPatched, patchList);

                                // clear the group
                                replaceOpsGroup.length = 0;
                                // reset the replace index
                                lastReplaceIndex = index;
                            } // either way add current rec and move on
                            replaceOpsGroup.push(rec);
                        } else {
                            // set the replace index
                            lastReplaceIndex = index;
                            // add it to the group
                            replaceOpsGroup.push(rec);
                        }

                    }

                    if (nextRecord) acc.push(nextRecord);

                    return acc;

                }, []);

                return result;
            },

            // should be called right after all changes are made, and before saving the deck object
            // `updatedDeck` is optional, for code that applies changes on a new deck object
            applyChangeLog: function(updatedDeck) {
                if (!updatedDeck) {
                    updatedDeck = deck;
                }

                // latest is the only editable revision!!
                let [updatedRevision] = updatedDeck.revisions.slice(-1);
                let updatedDeckId = util.toIdentifier({ id: deck._id, revision: updatedRevision.id });

                // it could be that the updated deck is the root deck, so we check the rootDeckId again
                let rootDeck = util.parseIdentifier(rootDeckId);
                if (rootDeck.id === deck._id) {
                    rootDeckId = updatedDeckId;
                }

                // TODO avoid this circular reference
                let deckDB = require('../database/deckDatabase');
                // wait for path promise then generate the log
                return deckDB.findPath(rootDeckId, updatedDeckId)
                .then((path) => {
                    // keep the parent ops list handy
                    let parentOpIds = parentOperations.map((op) => op._id);

                    // first the deck changes
                    let deckUpdates = _.compact(this.deckUpdateRecords(path, updatedDeck));

                    let saveFirstBatch = Promise.resolve([]);
                    if (deckUpdates.length) {
                        if (parentOpIds.length) {
                            // add parent operations for deck updates
                            deckUpdates.forEach((c) => { c.parents = parentOpIds; });
                        }

                        saveFirstBatch = saveDeckChanges(deckUpdates, user, editAction);
                    }

                    return saveFirstBatch.then(() => {

                        // then the children changes
                        let childrenUpdates = _.compact(this.contentItemsRecords(path, updatedDeck));
                        if (_.isEmpty(childrenUpdates)) {
                            // if (_.isEmpty(deckUpdates)) console.warn('WARNING: no deck changes detected as was expected');
                            return deckUpdates;
                        }

                        // when we have both deck updates and children updates
                        // we would like the children to be linked to the deck updates
                        parentOpIds = parentOpIds.concat(deckUpdates.map((op) => op._id));
                        if (parentOpIds.length) {
                            // add parent operations for children updates
                            childrenUpdates.forEach((c) => { c.parents = parentOpIds; });
                        }

                        return saveDeckChanges(childrenUpdates, user, editAction).then(() => {
                            // return all changes
                            return [...deckUpdates, ...childrenUpdates];
                        });

                    });

                }).catch((err) => {
                    console.warn(err);
                    return [];
                });

            },

        };

    },

    // we create a change log record for deck creation as well
    trackDeckCreated: function(deckId, userId, rootDeckId, parentOperations=[], createAction) {
        userId = parseInt(userId);

        let deckNode = {
            kind: 'deck',
            ref: { id: parseInt(deckId), revision: 1 },
        };

        // TODO avoid this circular reference
        let deckDB = require('../database/deckDatabase');
        return deckDB.findPath(rootDeckId, util.toIdentifier(deckNode.ref)).then((path) => {
            // path could be empty (?)
            if (rootDeckId && _.isEmpty(path)) {
                // this means we couldn't find the deck in the path
                // it's probably a bug, but let's ignore it here
                console.warn(`tried to track add new deck ${deckId} but root deck ${rootDeckId} was invalid`);
                return;
            }

            let logRecord;
            if (_.isEmpty(path) || path.length === 1) {
                // means the deck is added as root, so no path, no index
                logRecord = ChangeLogRecord.createNodeInsert([deckNode]);
            } else {
                // means the deck is created and inserted to a parent

                // we need to remove the last part of the path for the record
                let [leaf] = path.splice(-1);
                // the index where we inserted it is in the last path part, which should be same as deckId
                let after = []; // sparse array to accomodate createNodeInsert API
                after[leaf.index] = { kind: 'deck', ref: _.pick(leaf, 'id', 'revision') };

                logRecord = ChangeLogRecord.createNodeInsert(after, leaf.index, path);
            }

            // add the parent ops!
            let parentOpIds = parentOperations.map((op) => op._id);
            if (parentOpIds.length) {
                logRecord.parents = parentOpIds;
            }

            return saveDeckChanges([logRecord], userId, createAction);

        }).catch((err) => {
            console.warn(err);
            return [];
        });

    },

    // we create a change log record for deck creation as well
    trackDeckForked: function(deckId, userId, rootDeckId, parentOperations, forAttach) {
        return self.trackDeckCreated(deckId, userId, rootDeckId, parentOperations, forAttach ? 'attach' : 'fork')
        .catch((err) => {
            console.warn(err);
            return [];
        });
    },

};



// fills record data with slide/deck/user info before saving it
function saveDeckChanges(deckChanges, userId, userAction) {
    return fillSlideInfo(deckChanges).then(fillDeckInfo).then(() => {

        deckChanges.forEach((c) => {
            // add user for all changes
            c.user = userId;

            // check userAction content flag
            if (userAction) {
                c.action = userAction;
            }
        });

        // TODO remove this
        // console.log('deck changed: ' + JSON.stringify(deckChanges));

        // do some validation 
        let errors = _.compact(deckChanges.map((c) => {
            if (changeModel.validate(c)) return;
            return changeModel.validate.errors;
        }));

        // TODO enable validation
        // if (!_.isEmpty(errors)) throw errors;
        if (!_.isEmpty(errors)) {
            console.warn(errors);
        }

        return helper.connectToDatabase()
        .then((db) => db.collection('deckchanges'))
        .then((col) => col.insert(deckChanges))
        .then(() => deckChanges);
    });
}

function fillSlideInfo(deckChanges) {
    // TODO avoid this circular reference
    const slideDB = require('../database/slideDatabase');

    // we check to see if we need to also read some data for slide updates
    let slideUpdates = deckChanges.filter((c) => (c.value && c.value.kind === 'slide'));
    return new Promise((resolve, reject) => {
        async.eachSeries(slideUpdates, (rec, done) => {
            // we want to add title and old title of slide
            slideDB.get(rec.value.ref.id).then((slide) => {
                if (!slide) return; // ignore errors ?

                let after = slide.revisions.find((r) => r.id === rec.value.ref.revision);
                rec.value.ref.title = after.title;

                // check for copy information in add ops
                let origin = ['copy', 'attach'].includes(rec.action) && after.parent;
                if (origin) {
                    // it's slides, and the parent's title hasn't changed
                    origin.title = after.title;
                    rec.value.origin = origin;
                }

                if (rec.oldValue) {
                    let before = slide.revisions.find((r) => r.id === rec.oldValue.ref.revision);
                    rec.oldValue.ref.title = before.title;
                }

                done();
            }).catch(done);

        }, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(deckChanges);
            }
        });

    });

}


function fillDeckInfo(deckChanges) {
    // TODO handle circular dependency
    let deckDB = require('../database/deckDatabase');

    // we need a deck title if we are doing a deck data update, or a deck node update
    let deckUpdates = deckChanges.filter((c) => (c.op === 'update' || (c.value && c.value.kind === 'deck') ));
    return new Promise((resolve, reject) => {
        async.eachSeries(deckUpdates, (rec, done) => {
            if (rec.op === 'update') {
                // deck data update, last path needs title
                let [deckValue] = rec.path.slice(-1);
                deckDB.getRevision(util.toIdentifier(deckValue)).then((deckRevision) => {
                    deckValue.title = deckRevision.title;
                    done();
                }).catch(done);
            } else {
                // we want to add title and originRevision for old and new deck
                deckDB.get(rec.value.ref.id).then((deck) => {
                    if (!deck) return; // ignore errors ?

                    let after = deck.revisions.find((r) => r.id === rec.value.ref.revision);
                    if (after.originRevision)
                        rec.value.ref.originRevision = after.originRevision;
                    rec.value.ref.title = after.title;

                    // check for fork information in add ops
                    let origin = ['fork', 'attach'].includes(rec.action) && deck.origin;
                    if (origin) {
                        rec.value.origin = origin;
                    }

                    if (rec.oldValue) {
                        let before = deck.revisions.find((r) => r.id === rec.oldValue.ref.revision);
                        if (before.originRevision)
                            rec.oldValue.ref.originRevision = before.originRevision;
                        rec.oldValue.ref.title = before.title;

                        if (origin) {
                            rec.oldValue.origin = origin;
                        }
                    }

                    done();
                }).catch(done);
            }

        }, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(deckChanges);
            }
        });

    });

}
