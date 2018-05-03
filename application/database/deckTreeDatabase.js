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
            allowMarkdown: deck.allowMarkdown,
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
                    allowMarkdown: deck.allowMarkdown,
                });

            } else {
                // it's a deck
                let innerTree = await self.getDeckTree(itemId, variantFilter);
                deckTree.children.push(innerTree);
            }
        }

        return deckTree;
    },

    // returns a flattened structure of a deck's slides, and optionally its sub-decks
    // NEW implementation, old should be deprecated
    getFlatSlides: async function(deckId, variantFilter, deckTree) {
        let deck = await deckDB.getDeck(deckId, variantFilter);
        if (!deck) return; // not found

        // make it canonical
        deckId = util.toIdentifier(deck);
        if (!deckTree) {
            // info of root deck
            deckTree = {
                type: 'deck',
                id: deckId,
                title: deck.title,
                lanugage: deck.language,
                theme: deck.theme,
                allowMarkdown: deck.allowMarkdown,
                user: String(deck.user),
                children: [],
            };
        }

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
                    content: slide.content,
                    speakernotes: slide.speakernotes,
                    markdown: slide.markdown,
                    language: slide.language,
                    theme: deck.theme,
                    allowMarkdown: deck.allowMarkdown,
                    user: String(slide.user),
                });

            } else {
                // it's a deck
                // call recursively for subdecks
                await self.getFlatSlides(itemId, variantFilter, deckTree);
                // deckTree will receive the rest of the slides
            }
        }

        return deckTree;
    },

};
