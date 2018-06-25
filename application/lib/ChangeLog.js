'use strict';

const _ = require('lodash');

const Immutable = require('immutable');
const diff = require('immutablediff');

const util = require('../lib/util');

const deckModel = require('../models/deck');
const changeModel = require('../models/deckChange');

const helper = require('../database/helper');

const variantDeckProperties = ['title', 'description'];

const ChangeLogRecord = {

    createUpdate: function(before, after, path) {
        // before and after are objects and could have the same values,
        // we only want to keep in both the attributes that are different in any way
        let beforeDiff = _.omitBy(before, (value, key) => _.isEqual(value, after[key]));
        let afterDiff = _.omitBy(after, (value, key) => _.isEqual(value, before[key]));

        // special handling of variants
        let variant;
        // first compute the diff between them 
        let theDiff = diff(Immutable.fromJS(beforeDiff), Immutable.fromJS(afterDiff));
        theDiff.toJS().forEach((rec) => {
            // find variants changes
            let indexMatch = rec.path.match(/^\/variants\/(\d+)(?:\/([^/]+))?/);
            if (!indexMatch) return;

            // pick each variant change one by one, and add appropriate values in the diffs

            // indexMatch[1] includes the variant index changed (or added/removed)
            let variantIndex = parseInt(indexMatch[1]);
            // indexMatch[2] includes the variant property changed (if any)
            let variantProperty = indexMatch[2];
            if (rec.op === 'replace') {
                // set the variant info
                variant = _.omit(beforeDiff.variants[variantIndex], variantDeckProperties);

                Object.assign(beforeDiff, _.pick(beforeDiff.variants[variantIndex], variantProperty));
                Object.assign(afterDiff, _.pick(afterDiff.variants[variantIndex], variantProperty));
            } else if (rec.op === 'remove') {
                variant = _.omit(beforeDiff.variants[variantIndex], variantDeckProperties);

                Object.assign(beforeDiff, _.pick(beforeDiff.variants[variantIndex], variantProperty));
            } else if (rec.op === 'add') {
                variant = _.omit(afterDiff.variants[variantIndex], variantDeckProperties);
                if (variantProperty) {
                    Object.assign(afterDiff, _.pick(afterDiff.variants[variantIndex], variantProperty));
                } else {
                    // the variant was newly added, add the non variant properties from rec.value
                    Object.assign(afterDiff, _.pick(rec.value, variantDeckProperties));
                }

            } else {
                // TODO throw ?
                console.warn(`unexpected variants diff op: ${JSON.stringify(rec)} for path`, path);
            }

        });

        // remove all variants info
        delete beforeDiff.variants;
        delete afterDiff.variants;

        // diffs may be empty, but a variant may have been added
        if (_.isEmpty(beforeDiff) && _.isEmpty(afterDiff) && !variant) return;

        let result = {
            op: 'update',

            path: path,

            values: afterDiff,
            oldValues: beforeDiff,

            timestamp: (new Date()).toISOString(),
        };

        if (variant) {
            result.variant = variant;
        }

        return result;
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

    // if primaryRef is set, means the value is a newly created variant to it
    createNodeInsert: function(value, index, path, primaryRef) {
        if (!_.isEmpty(path) && _.isNumber(index)) path = path.concat({ index });

        if (primaryRef) {
            // split variant and ref
            let variant = _.omit(value, 'id', 'revision');
            let ref = _.pick(value, 'id', 'revision');
            value = { kind: 'slide', ref, variant };
        }

        // we keep the added value and its index
        let result = {
            op: 'add',

            path: path,
            value: value,

            timestamp: (new Date()).toISOString(),
        };

        if (primaryRef) {
            result.oldValue = {
                kind: 'slide',
                ref: primaryRef,
            };
        }

        return result;
    },

    createNodeUpdate: function(before, after, index, path, isVariant) {
        if (!_.isEmpty(path) && _.isNumber(index)) path = path.concat({ index });

        if (isVariant) {
            // split variant and ref
            [before, after] = [before, after].map((value) => {
                let variant = _.omit(value, 'id', 'revision');
                let ref = _.pick(value, 'id', 'revision');
                return { kind: 'slide', ref, variant };
            });
        }

        return {
            op: 'replace',

            path: path,

            value: after,
            oldValue: before,

            timestamp: (new Date()).toISOString(),
        };

    },

};

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

        const deckId = `${deck._id}-${revision.id}`;

        // TODO avoid this circular reference
        const deckDB = require('../database/deckDatabase');

        const pathPromise = deckDB.findPath(rootDeckId, deckId);

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
            // `updatedDeck` is optional, for code that applies changes on a new deck object
            deckUpdateRecords: function(path, updatedDeck) {
                if (!updatedDeck) {
                    updatedDeck = deck;
                }

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
                if (!updatedDeck) {
                    updatedDeck = deck;
                }

                // we can only ever update the latest revision, let's compare to that ???
                let [updatedRevision] = updatedDeck.revisions.slice(-1);

                const contentItemsAfter = Immutable.fromJS(updatedRevision.contentItems.map(omitOrder));
                const contentItemOps = diff(contentItemsBefore, contentItemsAfter);

                if (!contentItemOps.isEmpty() && updatedRevision.id !== revision.id) {
                    console.warn(`trying to apply content item change log across different revisions: ${revision.id} -> ${updatedRevision.id}`);
                }

                // we have a list of JSON patch-style operations, which we would like to save in the log
                // in a reversible way as to provide full log capabilities without need for current state
                let result = contentItemOps.toJS().map((rec) => {

                    if (rec.op === 'remove') {
                        // we only expect removal of an index, will throw an error otherwise
                        let indexMatch = rec.path.match(/^\/(\d+)$/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${revision.id}: ${JSON.stringify(rec)}`);
                        }

                        // indexMatch[1] includes just the index removed
                        let index = parseInt(indexMatch[1]);
                        return ChangeLogRecord.createNodeRemove(contentItemsBefore.toJS(), index, path);
                    }

                    if (rec.op === 'add') {
                        // we expect adding an element or a variant to an element, will throw an error otherwise
                        let indexMatch = rec.path.match(/^\/(\d+)(\/variants(?:\/(\d+))?)?$/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${revision.id}: ${JSON.stringify(rec)}`);
                        }

                        // indexMatch[1] includes just the index added, or the index where the variant was added
                        let index = parseInt(indexMatch[1]);
                        // indexMatch[2] includes includes the string /variants with the optional the index of the variant added (if any)
                        let isVariant = !!indexMatch[2];
                        if (isVariant) {
                            let variant;

                            // indexMatch[3] includes the index of the variant, if it wasn't the first added
                            let variantIndex = parseInt(indexMatch[3]);
                            if (Number.isFinite(variantIndex)) {
                                variant = contentItemsAfter.getIn([index, 'variants', variantIndex]).toJS();
                            } else {
                                // just take it from the record value, which is always an array;
                                // we only ever expect a single item there
                                [variant] = rec.value;
                            }

                            // we also need to record the primary slide version, we use the index for that
                            let primary = contentItemsAfter.getIn([index, 'ref']).toJS();

                            return ChangeLogRecord.createNodeInsert(variant, index, path, primary);
                        } else {
                            return ChangeLogRecord.createNodeInsert(contentItemsAfter.get(index).toJS(), index, path);
                        }

                    }

                    if (rec.op === 'replace') {
                        // we expect revision changes to contentItems, or to variants so let's throw an Error otherwise
                        let indexMatch = rec.path.match(/^\/(\d+)\/(?:ref\/revision|variants\/(\d+)\/revision)/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${revision.id}: ${JSON.stringify(rec)}`);
                        }

                        // indexMatch[1] includes just the index replaced
                        let index = parseInt(indexMatch[1]);
                        // indexMatch[2] includes the index of the variant replaced (optionally)
                        let variantIndex = parseInt(indexMatch[2]);

                        let before, after, isVariant = Number.isFinite(variantIndex);
                        if (isVariant) {
                            before = contentItemsBefore.getIn([index, 'variants', variantIndex]);
                            after = contentItemsAfter.getIn([index, 'variants', variantIndex]);
                        } else {
                            before = contentItemsBefore.get(index).remove('variants');
                            after = contentItemsAfter.get(index).remove('variants');
                        }

                        return ChangeLogRecord.createNodeUpdate(before.toJS(), after.toJS(), index, path, isVariant);
                    }

                });

                return result;
            },

            getChangeLog: function(updatedDeck) {
                if (!updatedDeck) {
                    updatedDeck = deck;
                }

                // wait for path promise then generate the log
                return pathPromise.then((path) => _.compact([
                    // first the deck changes
                    ...this.deckUpdateRecords(path, updatedDeck),
                    // then the children changes
                    ...this.contentItemsRecords(path, updatedDeck)])
                );
            },

            // should be called right after all changes are made, and before saving the deck object
            // `updatedDeck` is optional, for code that applies changes on a new deck object
            applyChangeLog: function(updatedDeck) {
                return this.getChangeLog(updatedDeck).then((deckChanges) => {
                    if (_.isEmpty(deckChanges)) {
                        // console.warn('WARNING: no deck changes detected as was expected');
                        return deckChanges;
                    }

                    let parentOpIds = parentOperations.map((op) => op._id);
                    deckChanges.forEach((c) => {
                        // add user for all changes
                        c.user = user;
                        // add parent operations for all changes
                        if (parentOpIds.length) {
                            c.parents = parentOpIds;
                        }
                        // check editAction content flag
                        if (editAction) {
                            c.action = editAction;
                        }

                    });

                    return saveDeckChanges(deckChanges);

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
        const deckDB = require('../database/deckDatabase');
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
                logRecord = ChangeLogRecord.createNodeInsert(deckNode);
            } else {
                // means the deck is created and inserted to a parent

                // we need to remove the last part of the path for the record
                let [leaf] = path.splice(-1);
                // the index where we inserted it is in the last path part, which should be same as deckId
                logRecord = ChangeLogRecord.createNodeInsert({ kind: 'deck', ref: _.pick(leaf, 'id', 'revision') }, leaf.index, path);
            }
            // add the user!
            logRecord.user = userId;

            // add the parent ops!
            let parentOpIds = parentOperations.map((op) => op._id);
            if (parentOpIds.length) {
                logRecord.parents = parentOpIds;
            }

            // add the action!
            if (createAction) logRecord.action = createAction;

            return saveDeckChanges([logRecord]);

        }).catch((err) => {
            console.warn(err);
            return [];
        });

    },

    // we create a change log record for deck creation as well
    trackDeckForked: function(deckId, userId, rootDeckId, parentOperations, forkType='fork') {
        return self.trackDeckCreated(deckId, userId, rootDeckId, parentOperations, forkType)
        .catch((err) => {
            console.warn(err);
            return [];
        });
    },

};



// should be called right after all changes are made, and before saving the deck object
// `updatedDeck` is optional, for code that applies changes on a new deck object
function saveDeckChanges(deckChanges, userId) {
    return fillSlideInfo(deckChanges).then(fillDeckInfo).then(() => {
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

async function fillSlideInfo(deckChanges) {
    // TODO avoid this circular reference
    const slideDB = require('../database/slideDatabase');

    // we check to see if we need to also read some data for slide updates
    let slideUpdates = deckChanges.filter((c) => (c.value && c.value.kind === 'slide'));
    for (let rec of slideUpdates) {
        // check for copy information
        let checkParent = ['copy', 'attach'].includes(rec.action);

        // we want to add title and old title of slide
        let after = await slideDB.getSlideRevision(util.toIdentifier(rec.value.ref));
        if (!after) continue; // ignore errors ?

        rec.value.ref.title = after.title;

        // check for copy information in add ops
        let origin = checkParent && after.parent;
        if (origin) {
            // it's slides, and the parent's title hasn't changed
            origin.title = after.title;
            rec.value.origin = origin;
        }

        if (rec.oldValue) {
            let before = await slideDB.getSlideRevision(util.toIdentifier(rec.oldValue.ref));
            if (before) {
                rec.oldValue.ref.title = before.title;
            }
        }
    }

    return deckChanges;
}

async function fillDeckInfo(deckChanges) {
    // TODO avoid this circular reference
    let deckDB = require('../database/deckDatabase');

    // we need a deck title if we are doing a deck data update, or a deck node update
    let deckUpdates = deckChanges.filter((c) => (c.op === 'update' || (c.value && c.value.kind === 'deck') ));
    for (let rec of deckUpdates) {
        if (rec.op === 'update') {
            // deck data update, last path needs title
            let [deckValue] = rec.path.slice(-1);
            let deckRevision = await deckDB.getRevision(util.toIdentifier(deckValue));

            deckValue.title = deckRevision.title;
        } else {
            // we want to add title and originRevision for old and new deck
            let deck = await deckDB.get(rec.value.ref.id);
            if (!deck) continue; // ignore errors ?

            let after = deck.revisions.find((r) => r.id === rec.value.ref.revision);
            if (after.originRevision) {
                rec.value.ref.originRevision = after.originRevision;
            }
            rec.value.ref.title = after.title;

            // check for fork information in add ops
            let origin = ['fork', 'attach'].includes(rec.action) && deck.origin;
            if (origin) {
                rec.value.origin = origin;
            }

            if (rec.oldValue) {
                let before = deck.revisions.find((r) => r.id === rec.oldValue.ref.revision);
                if (before.originRevision) {
                    rec.oldValue.ref.originRevision = before.originRevision;
                }
                rec.oldValue.ref.title = before.title;

                if (origin) {
                    rec.oldValue.origin = origin;
                }
            }
        }
    }

    return deckChanges;
}
