'use strict';

const _ = require('lodash');
const Immutable = require('immutable');
const diff = require('immutablediff');

const deckModel = require('../models/deck');

const helper = require('../database/helper');

const ChangeLogRecord = {
    createUpdate: function(before, after) {
        // before and after are objects and could have the same values,
        // we only want to keep in both the attributes that are different in any way
        let beforeDiff = _.omitBy(before, (value, key) => _.isEqual(value, after[key]));
        let afterDiff = _.omitBy(after, (value, key) => _.isEqual(value, before[key]));

        if (_.isEmpty(beforeDiff) && _.isEmpty(afterDiff)) return;

        return {
            operation: 'update',
            timestamp: (new Date()).toISOString(),

            before: beforeDiff,
            after: afterDiff,
        };
    },

    createNodeRemove: function(before, index) {
        // we keep the removed value and its index
        return {
            operation: 'remove',
            timestamp: (new Date()).toISOString(),

            value: before[index],
            index: index,
        };

    },

    createNodeInsert: function(after, index) {
        // we keep the added value and its index
        return {
            operation: 'insert',
            timestamp: (new Date()).toISOString(),

            value: after[index],
            index: index,
        };

    },

    createNodeUpdate: function(before, after, index) {
        // before and after are content item objects and could have the same values,
        // we only want to keep in both the attributes that are different in any way
        let beforeDiff = before;// _.omitBy(before, (value, key) => _.isEqual(value, after[key]));
        let afterDiff = after;//_.omitBy(after, (value, key) => _.isEqual(value, before[key]));

        if (_.isEmpty(beforeDiff) && _.isEmpty(afterDiff)) return;

        return {
            operation: 'update',
            timestamp: (new Date()).toISOString(),

            oldValue: beforeDiff,
            value: afterDiff,

            index: index,
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
            deckUpdateRecord: function(newDeck) {
                if (typeof newDeck === 'undefined') {
                    newDeck = deck;
                }

                const deckAfter = _.cloneDeep(_.pick(newDeck, _.keys(deckModel.trackedDeckProperties)));

                // in order to do the comparison, we merge revision into deck and only keep trackable stuff
                _.merge(deckAfter, _.cloneDeep(_.pick(
                    revision,
                    _.keys(deckModel.trackedDeckRevisionProperties))
                ));

                return ChangeLogRecord.createUpdate(deckBefore, deckAfter);
            },

            contentItemsRecords: function() {
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
                        return ChangeLogRecord.createNodeRemove(contentItemsBefore.toJS(), index);
                    }

                    if (rec.op === 'add') {
                        // we only expect adding an element will throw an error otherwise
                        let indexMatch = rec.path.match(/^\/(\d+)$/);

                        if (!indexMatch) {
                            throw new Error(`unexpected content item modification for deck revision ${deck._id}-${revision.id}: ${JSON.strigify(rec)}`);
                        }

                        // indexMatch[1] includes just the index added
                        let index = parseInt(indexMatch[1]);
                        return ChangeLogRecord.createNodeInsert(contentItemsAfter.toJS(), index);
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

                        return ChangeLogRecord.createNodeUpdate(contentItemsBefore.get(index).toJS(), contentItemsAfter.get(index).toJS(), index);
                    }

                });

                return _.compact(result);
            },

            debugChangeLog: function(newDeck) {
                let deckLog = _.compact([this.deckUpdateRecord(newDeck)]);

                console.log('deck changed: ' + JSON.stringify(deckLog));
                console.log('nodes changed: ' + JSON.stringify(this.contentItemsRecords()));
            },

            // should be called right after all changes are made, and before saving the deck object
            // `newDeck` is optional, for code that applies changes on a new deck object
            applyChangeLog: function(newDeck) {
                if (typeof newDeck === 'undefined') {
                    newDeck = deck;
                }

                // first the deck changes
                let deckChanges = _.compact([this.deckUpdateRecord(newDeck)]);
                // then the children changes
                deckChanges.push(...this.contentItemsRecords());

                // wait for path promise then format, fill in stuff
                pathPromise.then((path) => {
                    deckChanges.forEach((c) => {
                        c.path = path;
                    });

                    return helper.connectToDatabase()
                    .then((db) => db.collection('deckChanges'))
                    .then((col) => col.insert(deckChanges))
                    .then((res) => {
                        console.log('deck changed: ' + JSON.stringify(deckChanges));
                    });

                }).catch((err) => {
                    console.warn(err);
                });

            },

        };

    },

};
