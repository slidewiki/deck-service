'use strict';

const _ = require('lodash');

const deckchange = require('../models/deckchange');

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

};

module.exports = {

    deckTracker: function(deck, revisionIndex) {
        const revision = deck.revisions[revisionIndex];

        // we only keep the properties we'd like to track for changes
        // we cloneDeep to make sure we don't share any references between deck/trackableDeck etc
        const deckBefore = _.cloneDeep(_.pick(
            deck,
            _.keys(deckchange.trackedDeckProperties)));
        const deckRevisionBefore = _.cloneDeep(_.pick(
            revision,
            _.keys(deckchange.trackedDeckRevisionProperties)));

        return {
            // returns the change log record that should be appended to the database
            // should be called right after all changes are made, and before saving the deck object
            deckUpdateRecord: function() {
                const deckAfter = _.cloneDeep(_.pick(deck, _.keys(deckchange.trackedDeckProperties)));
                return ChangeLogRecord.createUpdate(deckBefore, deckAfter);
            },

            revisionUpdateRecord: function() {
                const deckRevisionAfter = _.cloneDeep(_.pick(revision, _.keys(deckchange.trackedDeckRevisionProperties)));
                return ChangeLogRecord.createUpdate(deckRevisionBefore, deckRevisionAfter);
            },

            debugChangeLog: function() {
                let deckLog = _.compact([this.deckUpdateRecord()]);
                let revisionLog = _.compact([this.revisionUpdateRecord()]);

                console.log('deck changed: ' + JSON.stringify(deckLog));
                console.log('revision changed: ' + JSON.stringify(revisionLog));
            },

            // should be called right after all changes are made, and before saving the deck object
            applyChangeLog: function() {
                // first the deck changes
                let deckChanges = _.compact([this.deckUpdateRecord()]);
                if (!_.isEmpty(deckChanges)) {
                    deck.changeLog = deck.changeLog || [];
                    deck.changeLog = deck.changeLog.concat(deckChanges);
                }
                
                // then the revision changes
                let revisionChanges = _.compact([this.revisionUpdateRecord()]);
                if (!_.isEmpty(revisionChanges)) {
                    revision.changeLog = revision.changeLog || [];
                    revision.changeLog = revision.changeLog.concat(revisionChanges);
                }

                console.log('deck changed: ' + JSON.stringify(deckChanges));
                console.log('revision changed: ' + JSON.stringify(revisionChanges));
            },

        };

    },

};
