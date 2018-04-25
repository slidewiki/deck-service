'use strict';

const _ = require('lodash');
const boom = require('boom');

const util = require('../lib/util');

const deckDB = require('./deckDatabase');
const slideDB = require('./slideDatabase');

const self = module.exports = {

    // recursive function that gets the decktree of a given deck and all of its sub-decks
    // NEW implementation, old should be deprecated
    getDeckTree: async function(deckId, variantFilter) {
        let deck = await deckDB.getDeck(deckId, variantFilter);
        if (!deck) return; // not found

        // make it canonical
        deckId = util.toIdentifier(deck);
        let deckTree = {
            type: 'deck',
            id: deckId,
            revisionId: deck.revision,
            latestRevisionId: deck.latestRevision,
            title: deck.title,
            language: deck.language,
            theme: deck.theme,
            children: [],
        };

        for (let item of deck.contentItems) {
            let itemId = util.toIdentifier(item.ref);
            if (item.kind === 'slide') {
                if (!_.isEmpty(variantFilter)) {
                    // fetch the correct slide reference
                    let slideVariant = _.find(item.variants, variantFilter);
                    if (slideVariant) {
                        // set the correct variant itemId
                        itemId = util.toIdentifier(slideVariant);
                    }
                }
                // if no variantFilter, or no matching variant, item is the original slide

                let slide = await slideDB.getSlideRevision(itemId);
                deckTree.children.push({
                    type: 'slide',
                    id: itemId,
                    title: slide.title,
                    language: slide.language,
                    theme: deck.theme,
                });

            } else {
                // it's a deck
                let innerTree = await self.getDeckTree(itemId, variantFilter);
                deckTree.children.push(innerTree);
            }
        }

        return deckTree;
    },

};
