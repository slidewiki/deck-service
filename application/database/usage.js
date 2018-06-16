'use strict';

const _ = require('lodash');

const util = require('../lib/util');
const helper = require('./helper');

const self = module.exports = {

    // adds parentDeck ({id, revision}) to the content items' usage array
    addToUsage: async function(parentDeck, items) {
        let slides = await helper.getCollection('slides');
        let decks = await helper.getCollection('decks');

        for (let item of items) {
            let col = item.kind === 'slide' ? slides : decks;
            await _addToUsage(parentDeck, item.ref, col);

            if (item.kind === 'slide') {
                // also to the variants!
                for (let variant of item.variants || []) {
                    await _addToUsage(parentDeck, variant, col);
                }
            }
        }
    },

    // removes parentDeck ({id, revision}) from the content items' usage array
    removeFromUsage: async function(parentDeck, items) {
        let slides = await helper.getCollection('slides');
        let decks = await helper.getCollection('decks');

        for (let item of items) {
            let col = item.kind === 'slide' ? slides : decks;
            await _removeFromUsage(parentDeck, item.ref, col);

            if (item.kind === 'slide') {
                // also to the variants!
                for (let variant of item.variants || []) {
                    await _removeFromUsage(parentDeck, variant, col);
                }
            }
        }
    },

    // moves parentDeck ({id, revision}) from the content item's revision to the newRevision
    moveToUsage: async function(parentDeck, item, newRevision) {
        let { ref, kind } = item;
        let db = await helper.connectToDatabase();
        let col = item.kind === 'slide' ? db.collection('slides') : db.collection('slides');

        let found = await col.findOne({ _id: ref.id });

        let oldUsage = _.find(found, { id: ref.revision }).usage;
        let newUsage = _.find(found, { id: newRevision }).usage;

        // make sure we only have id, revision
        parentDeck = _.pick(parentDeck, 'id', 'revision');

        // first remove parentDeck from usage of old item revision
        _.remove(oldUsage, parentDeck);

        // then add it to usage of new item revision (if not there already)
        if (!_.find(newUsage, parentDeck)) {
            newUsage.push(parentDeck);
        }

        // update both in a batch!
        let batch = col.initializeUnorderedBulkOp();
        batch.find({
            _id: ref.id,
            'revisions.id': ref.revision,
        }).updateOne({
            $set: {
                'revisions.$.usage': oldUsage,
            },
        });
        batch.find({
            _id: ref.id,
            'revisions.id': newRevision,
        }).updateOne({
            $set: {
                'revisions.$.usage': newUsage,
            },
        });
        await batch.execute();
    },

};

async function _addToUsage(parentDeck, ref, col) {
    let found = await col.findOne({_id: ref.id});
    let revision = _.find(found.revisions, { id: ref.revision });

    // then add it to usage of new item revision (if not there already)
    if (!_.find(revision.usage, parentDeck)) {
        await col.findOneAndUpdate(
            {
                _id: ref.id,
                'revisions.id': ref.revision,
            },
            { $push: {
                'revisions.$.usage': {
                    id: parentDeck.id,
                    revision: parentDeck.revision,
                },
            } }
        );
    }

}

async function _removeFromUsage(parentDeck, ref, col) {
    let found = await col.findOne({_id: ref.id});
    let revision = _.find(found.revisions, { id: ref.revision });

    _.remove(revision.usage, _.pick(parentDeck, 'id', 'revision'));

    return col.findOneAndUpdate(
        {
            _id: ref.id,
            'revisions.id': ref.revision,
        },
        { $set: {
            'revisions.$.usage': revision.usage,
        } }
    );
}

// returns the usage of a deckId (revision is optional), i.e. the decks that point to it
async function _getDeckUsage(deckId) {
    let deck = util.parseIdentifier(deckId);

    // prepare some objects to be used later for building the pipeline
    let $elemMatch = {
        kind: 'deck',
        'ref.id': deck.id,
    };
    if (deck.revision) {
        $elemMatch['ref.revision'] = deck.revision;
    }

    let cursor = (await helper.getCollection('decks')).aggregate();

    // always match as first stage to be fast because of indexes
    cursor.match({
        'revisions.contentItems': { $elemMatch }
    })
    .unwind('$revisions')
    .project({
        revisions: {
            id: 1,
            contentItems: {
                kind: 1,
                ref: 1,
            },
        },
    })
    // rematch :)
    .match({
        'revisions.contentItems': { $elemMatch }
    })
    .project({
        _id : 0,
        id: '$_id',
        revision: '$revisions.id',
    });

    return (await cursor.toArray()).length;
}
