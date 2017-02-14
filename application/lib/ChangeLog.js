'use strict';

const _ = require('lodash');
const Immutable = require('immutable');
const diff = require('immutablediff');

const deckModel = require('../models/deck');

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

            remove: before[index],
            index: index,
        };

    },

    createNodeInsert: function(after, index) {
        // we keep the added value and its index
        return {
            operation: 'insert',
            timestamp: (new Date()).toISOString(),

            insert: after[index],
            index: index,
        };

    },

    createNodeUpdate: function(before, after, index) {
        // before and after are content item objects and could have the same values,
        // we only want to keep in both the attributes that are different in any way
        let beforeDiff = _.omitBy(before, (value, key) => _.isEqual(value, after[key]));
        let afterDiff = _.omitBy(after, (value, key) => _.isEqual(value, before[key]));

        if (_.isEmpty(beforeDiff) && _.isEmpty(afterDiff)) return;

        return {
            operation: 'update',
            timestamp: (new Date()).toISOString(),

            update: {
                before: beforeDiff,
                after: afterDiff,
            },

            index: index,
        };

    },

};

// returns a new object without `order` property
const omitOrder = (item) => _.omit(item, 'order');

module.exports = {

    deckTracker: function(deck, revisionIndex) {
        if (typeof revisionIndex === 'undefined') {
            // latest if none specified
            revisionIndex = deck.revisions.length - 1;
        }

        const revision = deck.revisions[revisionIndex];

        // we only keep the properties we'd like to track for changes
        // we cloneDeep to make sure we don't share any references between deck/trackableDeck etc
        const deckBefore = _.cloneDeep(_.pick(
            deck,
            _.keys(deckModel.trackedDeckProperties)));
        const deckRevisionBefore = _.cloneDeep(_.pick(
            revision,
            _.keys(deckModel.trackedDeckRevisionProperties)));


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
                return ChangeLogRecord.createUpdate(deckBefore, deckAfter);
            },

            revisionUpdateRecord: function() {
                const deckRevisionAfter = _.cloneDeep(_.pick(revision, _.keys(deckModel.trackedDeckRevisionProperties)));
                return ChangeLogRecord.createUpdate(deckRevisionBefore, deckRevisionAfter);
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
                        let oldRevision = contentItemsBefore.getIn([index, 'ref', 'revision']);
                        let newRevision = rec.value;

                        return ChangeLogRecord.createNodeUpdate({ ref: { revision: oldRevision } }, { ref: { revision: newRevision } }, index);
                    }

                });

                return _.compact(result);
            },

            debugChangeLog: function(newDeck) {
                let deckLog = _.compact([this.deckUpdateRecord(newDeck)]);
                let revisionLog = _.compact([this.revisionUpdateRecord()]);

                console.log('deck changed: ' + JSON.stringify(deckLog));
                console.log('revision changed: ' + JSON.stringify(revisionLog));

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
                if (!_.isEmpty(deckChanges)) {
                    newDeck.changeLog = newDeck.changeLog || [];
                    newDeck.changeLog = newDeck.changeLog.concat(deckChanges);
                }

                // then the revision changes
                let revisionChanges = _.compact([this.revisionUpdateRecord()]);
                revisionChanges = _.concat(revisionChanges, this.contentItemsRecords());

                if (!_.isEmpty(revisionChanges)) {
                    revision.changeLog = revision.changeLog || [];
                    revision.changeLog = revision.changeLog.concat(revisionChanges);
                }
// console.log('deck changed: ' + JSON.stringify(deckChanges));
// console.log('revision changed: ' + JSON.stringify(revisionChanges));
            },

        };

    },

};
