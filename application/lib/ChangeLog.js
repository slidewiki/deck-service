'use strict';

const _ = require('lodash');
const async = require('async');

const Immutable = require('immutable');
const diff = require('immutablediff');

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

};

// returns a new object without `order` property
const omitOrder = (item) => _.omit(item, 'order');

let self = module.exports = {

    deckTracker: function(deck, rootDeckId, user) {
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

            contentItemsRecords: function(path) {
                const contentItemsAfter = Immutable.fromJS(revision.contentItems.map(omitOrder));
                const contentItemOps = diff(contentItemsBefore, contentItemsAfter);

// console.log(contentItemsBefore);
// console.log(contentItemsAfter);
// console.log(contentItemOps);

                // we have a list of JSON patch-style operations, which we would like to save in the log
                // in a reversible way as to provide full log capabilities without need for current state
                let result = contentItemOps.toJS().map((rec) => {

                    if (rec.op === 'remove') {
                        // we only expect removal of an index, will throw an error otherwise
                        let indexMatch = rec.path.match(/^\/(\d+)$/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${revision.id}: ${JSON.strigify(rec)}`);
                        }

                        // indexMatch[1] includes just the index added
                        let index = parseInt(indexMatch[1]);
                        return ChangeLogRecord.createNodeRemove(contentItemsBefore.toJS(), index, path);
                    }

                    if (rec.op === 'add') {
                        // we only expect adding an element will throw an error otherwise
                        let indexMatch = rec.path.match(/^\/(\d+)$/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${revision.id}: ${JSON.strigify(rec)}`);
                        }

                        // indexMatch[1] includes just the index added
                        let index = parseInt(indexMatch[1]);
                        return ChangeLogRecord.createNodeInsert(contentItemsAfter.toJS(), index, path);
                    }

                    if (rec.op === 'replace') {
                        // for now we expect only revision changes to contentItems, so let's throw an Error otherwise
                        let indexMatch = rec.path.match(/^\/(\d+)\/ref\/revision/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${revision.id}: ${JSON.strigify(rec)}`);
                        }

                        // indexMatch[1] includes just the index added
                        let index = parseInt(indexMatch[1]);
                        return ChangeLogRecord.createNodeUpdate(contentItemsBefore.get(index).toJS(), contentItemsAfter.get(index).toJS(), index, path);
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
                    ...this.contentItemsRecords(path)])
                );
            },

            // should be called right after all changes are made, and before saving the deck object
            // `updatedDeck` is optional, for code that applies changes on a new deck object
            applyChangeLog: function(updatedDeck) {
                this.getChangeLog(updatedDeck).then((deckChanges) => {
                    if (_.isEmpty(deckChanges)) {
                        // console.warn('WARNING: no deck changes detected as was expected');
                        return;
                    }

                    // add user for all changes
                    deckChanges.forEach((c) => { c.user = user; });

                    return saveDeckChanges(deckChanges);

                }).catch((err) => {
                    console.warn(err);
                });

            },

        };

    },

    // we create a change log record for deck creation as well
    trackDeckCreated: function(newDeck, rootDeckId, action) {
        // userId is the new deck creator
        let userId = newDeck.user;

        // latest should be the only one but let's be defensive
        const [revision] = newDeck.revisions.slice(-1);
        const deckNode = {
            kind: 'deck',
            ref: {
                id: newDeck._id,
                revision: revision.id,
            },
        };

        const deckId = util.toIdentifier(deckNode.ref);

        // TODO avoid this circular reference
        const deckDB = require('../database/deckDatabase');

        return deckDB.findPath(rootDeckId, deckId).then((path) => {
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
            // add the user!
            logRecord.user = userId;

            // add the action!
            if (action) logRecord.action = action;

            return saveDeckChanges([logRecord]);

        }).catch((err) => {
            console.warn(err);
        });

    },

    // we create a change log record for deck creation as well
    trackDeckForked: function(newDeck, rootDeckId) {
        return self.trackDeckCreated(newDeck, rootDeckId, 'fork');
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
        .then((col) => col.insert(deckChanges));
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
                    let origin = rec.action === 'fork' && deck.origin;
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
