'use strict';

const _ = require('lodash');
const boom = require('boom');

const util = require('../lib/util');

const helper = require('./helper');
const deckDB = require('./deckDatabase');
const slideDB = require('./slideDatabase');

const fileService = require('../services/file');

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

    // we guard the copy deck revision tree method against abuse, by checking for change logs of one
    copyDeckTree: async function(deckId, user, forAttach) {
        let deck = util.parseIdentifier(deckId);
        let existingDeck = await deckDB.get(deck.id);

        let [latestRevision] = existingDeck.revisions.slice(-1);
        if (deck.revision && latestRevision.id !== deck.revision) {
            // we want to fork a read-only revision, all's well
            return self._copyDeckTree(deckId, user, forAttach);
        } else {
            // make the deck id canonical just in case
            deck.revision = latestRevision.id;
        }

        // before we fork it, let's check if it's a fresh revision
        let counts = await deckDB.getChangesCounts(deck.id);
        if (counts[deck.revision] === 1) {
            // we want to fork a fresh revision, let's fork the one before it
            console.log(`forking ${deck.revision -1} instead of ${deck.revision} for deck ${deck.id}`);
            return self._copyDeckTree(util.toIdentifier({ id: deck.id, revision: deck.revision - 1 }), user, forAttach);
        } else {
            // unknown revision, old deck without changelog, or a revision with changes, just fork it!
            return self._copyDeckTree(deckId, user, forAttach);
        }

    },

    // copies a given deck revision tree by copying all of its sub-decks into new decks
    // forAttach is true when forking is done during deck attach process
    _copyDeckTree: async function(deckId, user, forAttach) {
        let res = await deckDB.getFlatDecks(deckId);

        // we have a flat sub-deck structure
        // push root deck into array
        let flatDeckArray = [res.id];
        for(let child of res.children){
            flatDeckArray.push(child.id); // push next sub-deck into array
        }
        //init maps for new ids
        let id_map = {}, id_noRev_map = {}, slide_id_map = {};
        //reverse in order to iterate from bottom to top
        flatDeckArray.reverse();

        let new_decks = [];
        // first we generate all the new ids for the copied decks, and hold them in a map for future reference
        for (let next_deck of flatDeckArray) {
            await helper.connectToDatabase()
            .then((db) => helper.getNextIncrementationValueForCollection(db, 'decks'))
            .then((newId) => {
                id_map[next_deck] = newId+'-'+1;
                id_noRev_map[next_deck.split('-')[0]] = newId;
            });
        }

        // iterate the flat decktree and copy each deck, referring to the new ids in its content items and usage
        for (let next_deck of flatDeckArray) {
            let {id: nextId, revision: nextRevision} = util.parseIdentifier(next_deck);

            let col = await helper.getCollection('decks');
            let found = await col.findOne({_id: nextId});

            let ind = _.findIndex(found.revisions, { id: nextRevision });
            let contributorsArray = found.contributors;
            //contributorsArray.push({'user': parseInt(user), 'count': 1});
            let existingUserContributor = _.find(contributorsArray, { user: parseInt(user) });
            if (existingUserContributor > -1)
                existingUserContributor.count++;
            else{
                contributorsArray.push({user: parseInt(user), count: 1});
            }

            let copiedDeck = {
                _id: id_noRev_map[found._id],
                origin: {
                    id: found._id,
                    revision: found.revisions[ind].id,
                    title: found.revisions[ind].title,
                    user: found.user,
                },
                description: found.description,
                language: found.revisions[ind].language,
                license: found.license,
                user: parseInt(user),
                translated_from: found.translated_from,
                contributors: contributorsArray,
                active: 1,
                // TODO revisit how we maintain this attribute
                translations: found.translations || [],
                // forked decks are created as hidden like they were new ones
                hidden: true,
            };
            if (found.slideDimensions) {
                copiedDeck.slideDimensions = found.slideDimensions;
            }

            let now = new Date();
            let timestamp = now.toISOString();
            copiedDeck.timestamp = timestamp;
            copiedDeck.lastUpdate = timestamp;
            if(found.hasOwnProperty('datasource')){
                copiedDeck.datasource = found.datasource;
            }
            else{
                copiedDeck.datasource = null;
            }
            //copiedDeck.parent = next_deck.split('-')[0]+'-'+next_deck.split('-')[1];
            copiedDeck.revisions = [found.revisions[ind]];
            copiedDeck.revisions[0].id = 1;
            // own the revision as well!
            copiedDeck.revisions[0].user = copiedDeck.user;

            // renew creation date for fresh revision
            copiedDeck.revisions[0].timestamp = timestamp;
            copiedDeck.revisions[0].lastUpdate = timestamp;

            // this points to the same deck, needs to be removed in forked decks
            delete copiedDeck.revisions[0].originRevision;

            // isFeatured needs to be removed in forked decks
            delete copiedDeck.revisions[0].isFeatured;

            let contentItemsMap = {};
            let contentItemsToCopy = []; // TODO for now disable copying slides as well // copiedDeck.revisions[0].contentItems;
            let copiedDeckId = util.toIdentifier({id: copiedDeck._id, revision: 1});

            let slides = await helper.getCollection('slides');
            for (let nextSlide of contentItemsToCopy) {
                if (nextSlide.kind !== 'slide') continue;

                // let's copy the slide
                let slide = await slides.findOne({_id: nextSlide.ref.id});
                let oldSlideId = slide._id;
                let sourceRevision = _.find(slide.revisions, { id: nextSlide.ref.revision });
                let newSlide = Object.assign({}, slide, sourceRevision, { id: slide._id, revision: sourceRevision.id });
                let inserted = await slideDB.copy(newSlide, copiedDeckId, parseInt(user));
                inserted = inserted.ops[0];

                let newSlideId = inserted._id;
                contentItemsMap[oldSlideId] = newSlideId;
                slide_id_map[oldSlideId] = newSlideId;

                // create the thumbnail
                let copiedSlideId = `${newSlideId}-1`;
                fileService.createThumbnail(inserted.revisions[0].content, copiedSlideId, copiedDeck.revisions[0].theme).catch((err) => {
                    console.warn(`could not create thumbnail for translation ${copiedSlideId}, error was: ${err.message}`);
                });

                //console.log('contentItemsMap', contentItemsMap);
                //console.log('copiedDeck', copiedDeck);
                for(let i = 0; i < contentItemsToCopy.length; i++){
                    if(contentItemsToCopy[i].ref.id === oldSlideId){
                        contentItemsToCopy[i].ref.id = newSlideId;
                        contentItemsToCopy[i].ref.revision = 1;
                    }
                }
            }

            // these should be run with or without a translation operation
            for(let i = 0; i < copiedDeck.revisions[0].contentItems.length; i++){
                for(let j in id_map){
                    if(id_map.hasOwnProperty(j) && copiedDeck.revisions[0].contentItems[i].ref.id === parseInt(j.split('-')[0])){
                        copiedDeck.revisions[0].contentItems[i].ref.id = parseInt(id_map[j].split('-')[0]);
                        copiedDeck.revisions[0].contentItems[i].ref.revision = parseInt(id_map[j].split('-')[1]);
                    }
                }
            }
            for(let i = 0; i < copiedDeck.revisions[0].usage.length; i++){
                for(let j in id_map){
                    if(id_map.hasOwnProperty(j) && copiedDeck.revisions[0].usage[i].id === parseInt(j.split('-')[0])){
                        copiedDeck.revisions[0].usage[i].id = parseInt(id_map[j].split('-')[0]);
                        copiedDeck.revisions[0].usage[i].revision = parseInt(id_map[j].split('-')[1]);
                    }
                }
            }
            for(let i = 0; i < copiedDeck.revisions[0].contentItems.length; i++){
                let nextSlide = copiedDeck.revisions[0].contentItems[i];
                //console.log('nextSlide', nextSlide);
                if(nextSlide.kind === 'slide'){
                    let root_deck_path = [copiedDeck._id, '1'];
                    //console.log('outside root_deck_path', root_deck_path);
                    //console.log('contentItemsMap', contentItemsMap);

                    // TODO wait for it ???
                    deckDB.addToUsage(nextSlide, root_deck_path);
                }
                else{
                    continue;
                }
            }

            new_decks.push(copiedDeck);
            await col.insertOne(copiedDeck);
        }

        if (!forAttach) {
            // if not attaching, we need to track stuff here
            let rootDeckId = id_map[res.id];
            // TODO wait for it ?
            deckDB._trackDecksForked(rootDeckId, id_map, user, 'fork');
        }

        let forkResult = {'root_deck': id_map[res.id], 'id_map': id_map};

        // after forking the deck and if the revision we forked is the latest,
        // we create a new revision for the original deck;
        // this way the fork points to a read-only revision
        let deck = util.parseIdentifier(deckId);
        let existingDeck = await deckDB.get(deck.id);

        let [latestRevision] = existingDeck.revisions.slice(-1);
        if (deck.revision && latestRevision.id !== deck.revision) {
            // we forked a read-only revision, nothing to do here
            return forkResult;
        } else {
            // make the deck id canonical just in case
            deck.revision = latestRevision.id;
        }

        // this is an automatic revision, the user should be 'system'
        // deck autorevision is created with same deck as root
        let updatedDeck = await deckDB.createDeckRevision(deck.id, -1, deck.id);

        // we need to update all parents of the deck to keep them updated
        // with the latest revision we have just created now
        let usage = await deckDB.getUsage(util.toIdentifier(deck));
        // if a deck has no roots, itself is the root
        console.log(`updating deck revision used for ${deck.id} in ${usage.length} parent decks`);

        for (let parentDeck of usage) {
            // citem, revertedRevId, root_deck, ckind, user, top_root_deck, parentOperations
            let parentDeckId = util.toIdentifier(parentDeck);
            await deckDB.updateContentItem(updatedDeck, '', parentDeckId, 'deck', -1, parentDeckId);
        }

        // return the same result
        return forkResult;
    },

};
