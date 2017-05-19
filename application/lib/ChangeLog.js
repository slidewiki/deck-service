'use strict';

const _ = require('lodash');
const async = require('async');

const Immutable = require('immutable');
const diff = require('immutablediff');

const util = require('../lib/util');

const deckModel = require('../models/deck');
const changeModel = require('../models/deckChange');

const helper = require('../database/helper');
const slideDB = require('../database/slideDatabase');

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
        // we keep the added value and its index
        return {
            op: 'add',

            path: path.concat({ index }),
            value: after[index],

            timestamp: (new Date()).toISOString(),
        };

    },

    createNodeUpdate: function(before, after, index, path) {
        if (path && _.isNumber(index)) path = path.concat({ index });

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
            // `newDeck` is optional, for code that applies changes on a new deck object
            deckUpdateRecords: function(path, newDeck) {
                if (typeof newDeck === 'undefined') {
                    newDeck = deck;
                }

                // we may have two records here: one for updating the values
                // the other for updating the revision (but only when not a subdeck)
                let records = [];

                let deckAfter = _.cloneDeep(_.pick(newDeck, _.keys(deckModel.trackedDeckProperties)));

                // check if we are applying update to deck across revisions
                // in that case newDeck would be not the same object as deck (the one we initialized with)
                let newRevision = revision;
                if (newDeck !== deck) {
                    // latest is the only editable revision!!
                    [newRevision] = newDeck.revisions.slice(-1);

                    // check for the case where we're doing a deck revision for a ROOT deck
                    // we double check that old revision and new are different!
                    // if it's a root deck revision, the path will be of length 1
                    if (revision.id !== newRevision.id && path.length === 1) {

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
                                revision: newRevision.id,
                            },
                        };

                        // no index or path in this case
                        records.push(ChangeLogRecord.createNodeUpdate(before, after));
                    }

                }

                // in order to do the comparison, we merge revision into deck and only keep trackable stuff
                _.merge(deckAfter, _.cloneDeep(_.pick(
                    newRevision,
                    _.keys(deckModel.trackedDeckRevisionProperties))
                ));

                // this may include empty slots nothing, which is ok
                records.push(ChangeLogRecord.createUpdate(deckBefore, deckAfter, path));

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
            // `newDeck` is optional, for code that applies changes on a new deck object
            applyChangeLog: function(updatedDeck) {
                this.getChangeLog(updatedDeck).then((deckChanges) => {
                    if (_.isEmpty(deckChanges)) {
                        // console.warn('WARNING: no deck changes detected as was expected');
                        return;
                    }

                    // add user for all changes
                    deckChanges.forEach((c) => { c.user = user; });

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

                }).catch((err) => {
                    console.warn(err);
                });

            },

        };

    },

};

function fillSlideInfo(deckChanges) {

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

                    if (rec.oldValue) {
                        let before = deck.revisions.find((r) => r.id === rec.oldValue.ref.revision);
                        if (before.originRevision)
                            rec.oldValue.ref.originRevision = before.originRevision;
                        rec.oldValue.ref.title = before.title;
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
