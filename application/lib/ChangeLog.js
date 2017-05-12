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

        return {
            op: 'replace',

            path: path.concat({ index }),

            value: after,
            oldValue: before,

            timestamp: (new Date()).toISOString(),
        };

    },

};

// returns a new object without `order` property
const omitOrder = (item) => _.omit(item, 'order');

module.exports = {

    deckTracker: function(deck, rootDeckId) {
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
            deckUpdateRecord: function(path, newDeck) {
                if (typeof newDeck === 'undefined') {
                    newDeck = deck;
                }

                const deckAfter = _.cloneDeep(_.pick(newDeck, _.keys(deckModel.trackedDeckProperties)));

                // in order to do the comparison, we merge revision into deck and only keep trackable stuff
                _.merge(deckAfter, _.cloneDeep(_.pick(
                    revision,
                    _.keys(deckModel.trackedDeckRevisionProperties))
                ));

                // this may return nothing, which is ok
                return ChangeLogRecord.createUpdate(deckBefore, deckAfter, path);
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
                        let cItem = contentItemsBefore.get(index).toJS();
                        let newRevision = rec.value;

                        return ChangeLogRecord.createNodeUpdate(contentItemsBefore.get(index).toJS(), contentItemsAfter.get(index).toJS(), index, path);
                    }

                });

                return result;
            },

            // should be called right after all changes are made, and before saving the deck object
            // `newDeck` is optional, for code that applies changes on a new deck object
            applyChangeLog: function(newDeck) {
                if (typeof newDeck === 'undefined') {
                    newDeck = deck;
                }

                // wait for path promise then format, fill in stuff
                pathPromise.then((path) => {
                    let deckChanges = _.compact([
                        // first the deck changes
                        this.deckUpdateRecord(path, newDeck),
                        // then the children changes
                        ...this.contentItemsRecords(path)]);


                    if (_.isEmpty(deckChanges)) {
                        console.warn('WARNING: no deck changes detected as was expected');
                        return;
                    }

                    return fillSlideTitles(deckChanges).then(fillDeckTitles).then(() => {
                        // TODO remove this
                        // console.log('deck changed: ' + JSON.stringify(deckChanges));

                        // do some validation 
                        var errors = _.compact(deckChanges.map((c) => {
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

function fillSlideTitles(deckChanges) {

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


function fillDeckTitles(deckChanges) {
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
                // we want to add title and old title of deck
                deckDB.get(rec.value.ref.id).then((deck) => {
                    if (!deck) return; // ignore errors ?

                    let after = deck.revisions.find((r) => r.id === rec.value.ref.revision);
                    rec.value.ref.title = after.title;

                    if (rec.oldValue) {
                        let before = deck.revisions.find((r) => r.id === rec.oldValue.ref.revision);
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
