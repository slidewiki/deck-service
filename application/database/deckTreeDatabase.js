'use strict';

const _ = require('lodash');
const boom = require('boom');

const util = require('../lib/util');

const helper = require('./helper');
const deckDB = require('./deckDatabase');
const slideDB = require('./slideDatabase');
const usageDB = require('./usage');
const contributorsDB = require('./contributors');

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
            variants: deck.variants,
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

    // new implementation for decktree API with enrich flag
    exportDeckTree: async function(deckId, path=[]) {
        let deck = await deckDB.getDeck(deckId);
        if (!deck) return; // not found

        // make it canonical
        deckId = util.toIdentifier(deck);

        // build the path
        path.push(_.pick(deck, 'id', 'revision', 'hidden'));

        let deckTree = {
            type: 'deck',
            id: deck.id,
            revision: deck.revision,
            latestRevision: deck.latestRevision,
            hidden: deck.hidden,
            title: deck.title,
            description: deck.description, 
            variants: deck.variants,
            timestamp: deck.timestamp, 
            lastUpdate: deck.lastUpdate, 
            language: deck.language,
            owner: deck.user, 
            tags: _.map(deck.tags, 'tagName'),
            contributors: _.map(deck.contributors, 'user'),
            path: path,
            contents: [],
        };

        for (let item of deck.contentItems) {
            let itemId = util.toIdentifier(item.ref);
            if (item.kind === 'slide') {
                let slide = await exportSlide(itemId);
                slide.path = path;

                // also add the variants
                slide.variants = [];
                for (let slideVariant of (item.variants || [])) {
                    let variantInfo = await exportSlide(util.toIdentifier(slideVariant));
                    // also add any other variant data (language currently)
                    Object.assign(variantInfo, slideVariant);
                    slide.variants.push(variantInfo);
                }

                deckTree.contents.push(slide);

            } else {
                // it's a deck
                let innerTree = await self.exportDeckTree(itemId, _.cloneDeep(path));
                deckTree.contents.push(innerTree);
            }
        }

        return deckTree;
    },

    // finds canonical node data for itemId of itemKind under the rootId deck tree 
    // result is object {kind, ref, variants, parentId, position}
    // rootId should NEVER be the same as itemId
    findDeckTreeNode: async function(rootId, itemId, itemKind) {
        if (itemKind === 'deck') {
            // find the path to it
            let path = await deckDB.findPath(rootId, itemId);
            if (!path || !path.length) return; // not found

            // last part of the path is the deck node
            let [pathLeaf] = path.slice(-1);
            // node can never be the rootId, so path has at least length 2
            let [pathParent] = path.slice(-2, -1);

            // uniform object schema
            return {
                kind: itemKind,
                ref: _.pick(pathLeaf, 'id', 'revision'),
                parentId: util.toIdentifier(pathParent),
                position: pathLeaf.index + 1,
            };
        }

        // else it's a slide, find the slide node
        let slideNode = await slideDB.findSlideNode(rootId, itemId);
        if (!slideNode) return; // not found

        // uniform object schema
        return {
            kind: itemKind,
            ref: _.pick(slideNode.slide, 'id', 'revision'),
            variants: slideNode.variants,
            parentId: util.toIdentifier(slideNode.parent),
            position: slideNode.index + 1,
            // TODO maybe remove this
            theme: slideNode.parent.theme,
        };
    },

    // we guard the copy deck revision tree method against abuse, by checking for change logs of one
    // DEPRECATED
    copyDeckTreeOld: async function(deckId, user, forAttach) {
        let deck = util.parseIdentifier(deckId);
        let existingDeck = await deckDB.get(deck.id);

        let [latestRevision] = existingDeck.revisions.slice(-1);
        if (deck.revision && latestRevision.id !== deck.revision) {
            // we want to fork a read-only revision, all's well
            return self._copyDeckTreeOld(deckId, user, forAttach);
        } else {
            // make the deck id canonical just in case
            deck.revision = latestRevision.id;
        }

        // before we fork it, let's check if it's a fresh revision
        let counts = await deckDB.getChangesCounts(deck.id);
        if (counts[deck.revision] === 1) {
            // we want to fork a fresh revision, let's fork the one before it
            console.log(`forking ${deck.revision -1} instead of ${deck.revision} for deck ${deck.id}`);
            return self._copyDeckTreeOld(util.toIdentifier({ id: deck.id, revision: deck.revision - 1 }), user, forAttach);
        } else {
            // unknown revision, old deck without changelog, or a revision with changes, just fork it!
            return self._copyDeckTreeOld(deckId, user, forAttach);
        }

    },

    // copies a given deck revision tree by copying all of its sub-decks into new decks
    // forAttach is true when forking is done during deck attach process
    // DEPRECATED
    _copyDeckTreeOld: async function(deckId, user, forAttach) {
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

    // rootId is the id of the deck tree: its root deck id
    // node is an object {id, kind, parentId, position}
    removeDeckTreeNode: async function(rootId, node, userId) {
        let { id: itemId, kind: itemKind, parentId, position } = node;

        // check if node exists!
        let found = await self.findDeckTreeNode(rootId, itemId, itemKind);
        if (!found) {
            throw boom.badData(`could not find ${itemKind}: ${itemId} in deck tree: ${rootId}`);
        }

        // TODO remove node position, node id from the API?
        if (!position) {
            position = found.position;
        } else {
            console.warn(`assert ${found.position} should equal ${position}`);
        }

        if (!parentId) {
            parentId = found.parentId;
        } else {
            console.warn(`assert ${found.parentId} should equal ${parentId}`);
        }

        // delete it from parent deck!
        return deckDB.removeContentItem(position, parentId, rootId, userId);
    },

    // rootId is the id of the deck tree: its root deck id
    // source is an object {id, kind, parentId, position}
    // target is an object {deckId, position}
    moveDeckTreeNode: async function(rootId, source, target, userId) {
        let { id: itemId, kind: itemKind, parentId: sourceId, position: sourcePosition } = source;
        let { deckId: targetDeckId, position: targetPosition } = target;

        // check if node exists!
        let found = await self.findDeckTreeNode(rootId, itemId, itemKind);
        if (!found) {
            throw boom.badData(`could not find ${itemKind}: ${itemId} in deck tree: ${rootId}`);
        }

        // TODO remove node position, node id from the API?
        if (!sourcePosition) {
            sourcePosition = found.position;
        } else {
            console.warn(`assert ${found.position} should equal ${sourcePosition}`);
        }

        if (!sourceId) {
            sourceId = found.parentId;
        } else {
            console.warn(`assert ${found.parentId} should equal ${sourceId}`);
        }

        // because of usage maintenance, we need (?) to first remove, then add the item to new position

        // delete it from current parent deck
        await deckDB.removeContentItem(sourcePosition, sourceId, rootId, userId);
        // if moving in same deck and target is on or after source index, decrement the target index
        // TODO make this better (?)
        if (sourceId === targetDeckId && targetPosition >= sourcePosition) {
            targetPosition--;
        }

        // prepare a content item node to attach it to target
        let newContentItem = _.pick(found, 'kind', 'ref', 'variants');
        // add it after the target index
        let updatedDeckRevision = await deckDB.insertContentItem(newContentItem, targetPosition + 1, targetDeckId, userId, rootId);

        // since we moved the slide maybe it's under a deck with a different theme
        if (itemKind === 'slide' && found.theme && found.theme !== updatedDeckRevision.theme) {
            // yep, it is, so let's create the thumbnails as well
            for (let slide of await slideDB.getContentItemSlides(newContentItem)) {
                // generate thumbnails but don't wait for it
                let newSlideId = util.toIdentifier(slide);
                fileService.createThumbnail(slide.content, newSlideId, updatedDeckRevision.theme).catch((err) => {
                    console.warn(`could not create thumbnail for slide ${newSlideId}, error was: ${err.message}`);
                });
            }
        }

        return newContentItem;
    },

    // we guard the copy deck revision tree method against abuse, by checking for change logs of one
    copyDeckTree: async function(deckId, userId, forAttach) {
        let deck = util.parseIdentifier(deckId);
        let latestRevision = await deckDB.getLatestRevision(deck.id);
        if (!latestRevision) return; // deck not found

        // this flag will determine if we need to revise the deck tree after copying is complete
        // we only need to do this if we are copying the latest revision of a deck
        let reviseAfterCopy = false;

        // make the deck id canonical 
        if (!deck.revision) {
            deck.revision = latestRevision;
        }
        // figure out which revision we indeed need to copy
        if (deck.revision === latestRevision) {
            // before we copy it, let's check if it's a fresh revision
            let counts = await deckDB.getChangesCounts(deck.id);
            if (counts[deck.revision] === 1) {
                // we want to copy a fresh revision, let's copy the one before it
                console.warn(`copying ${deck.revision -1} instead of ${deck.revision} for deck ${deck.id}`);
                deck.revision = deck.revision - 1;
            } else {
                // unknown revision, old deck without changelog, or a revision with changes
                // we will copy it as is, but we also need to revise it afterwards
                reviseAfterCopy = true;
            } 
        }

        // rebuild the final deckId
        deckId = util.toIdentifier(deck);

        let {newDeckRef, copiedIdsMap} = await self._copyDeckTree(deckId, userId);
        let rootDeckId = util.toIdentifier(newDeckRef);

        if (!forAttach) {
            // if not attaching, we need to track stuff here
            // TODO wait for it ?
            deckDB._trackDecksForked(rootDeckId, copiedIdsMap, userId, 'fork');
        } // TODO ELSE ????

        if (reviseAfterCopy) {
            // after forking the deck and if the revision we forked is the latest,
            // we create a new revision for the original deck;
            // this way the fork points to a read-only revision

            // this is an automatic revision, the user should be 'system'
            // deck autorevision is created with same deck as root
            let updatedDeck = await deckDB.createDeckRevision(deck.id, -1, deck.id);

            // we need to update all parents of the deck to keep them updated
            // with the latest revision we have just created now
            let usage = await deckDB.getUsage(deckId);
            // if a deck has no roots, itself is the root
            console.warn(`updating deck revision used for ${deck.id} in ${usage.length} parent decks`);

            for (let parentDeck of usage) {
                // citem, revertedRevId, root_deck, ckind, user, top_root_deck, parentOperations
                let parentDeckId = util.toIdentifier(parentDeck);
                await deckDB.updateContentItem(updatedDeck, '', parentDeckId, 'deck', -1, parentDeckId);
            }
        }

        // keep the API intact for now
        return { root_deck: rootDeckId, id_map: copiedIdsMap };
    },

    // recursively copies the deck revision tree
    _copyDeckTree: async function(deckId, userId, parentDeckId) {
        let originDeck = await deckDB.getDeck(deckId);

        // create a copy based on original deck data
        let newDeck = _.pick(originDeck, [
            'title',
            'description',
            'language',
            'license',
            'tags',

            'variants',

            'theme',
            'slideDimensions',
            'allowMarkdown',
        ]);

        // assign metadata
        Object.assign(newDeck, {
            user: userId,
            origin: _.pick(originDeck, [
                'id',
                'revision',
                'title',
                'user',
            ]),
            root_deck: parentDeckId, // could be nothing
        });

        let inserted = await deckDB.insert(newDeck);
        // create the new deck reference
        let newDeckRef = {
            id: inserted._id,
            revision: 1,
        };

        // now that we have the new deck id, we can properly handle attach the content items
        // we will also recursively copy its subdecks and collect the replacements taking place
        let copiedIdsMap = {};
        for (let item of originDeck.contentItems) {
            if (item.kind === 'slide') {
                // TODO copy slides as well ??
                let keepSlides = true;
                if (keepSlides) {
                    // we are keeping the same slide, but need to update its usage to include the new parent deck
                    let slides = await helper.getCollection('slides');
                    // process the item ref and all its variants 
                    for (let ref of [item.ref, ...(item.variants || [])]) {
                        await slides.findOneAndUpdate(
                            { _id: ref.id, 'revisions.id': ref.revision },
                            { $push: { 'revisions.$.usage': newDeckRef } }
                        );
                    }

                } else {
                    // let's copy the slide as well
                    let newDeckId = util.toIdentifier(newDeckRef);

                    let slide = await slideDB.getSlideRevision(util.toIdentifier(item.ref));
                    let inserted = await slideDB.copy(slide, newDeckId, userId);

                    let copiedSlideRef = { id: inserted._id, revision: 1 };

                    // create the thumbnail
                    let copiedSlideId = util.toIdentifier(copiedSlideRef);
                    fileService.createThumbnail(inserted.revisions[0].content, copiedSlideId, newDeck.theme).catch((err) => {
                        console.warn(`could not create thumbnail for slide ${copiedSlideId}, error was: ${err.message}`);
                    });

                    // replace item ref with new slide
                    Object.assign(item.ref, copiedSlideRef);

                    // if we have variants, need to copy them as well
                    for (let variant of (item.variants || [])) {
                        let original = await slideDB.getSlideRevision(util.toIdentifier(variant));
                        let duplicate = await slideDB.copy(original, newDeckId, userId);

                        let copiedVariantRef = { id: duplicate._id, revision: 1 };

                        // create the thumbnail
                        let copiedVariantId = util.toIdentifier(copiedVariantRef);
                        fileService.createThumbnail(duplicate.revisions[0].content, copiedVariantId, newDeck.theme).catch((err) => {
                            console.warn(`could not create thumbnail for slide ${copiedVariantId}, error was: ${err.message}`);
                        });

                        // replace ref values in variant object directly
                        Object.assign(variant, copiedVariantRef);
                    }
                }

            } else {
                // subdecks
                let subdeckId = util.toIdentifier(item.ref);
                let copyResult = await self._copyDeckTree(subdeckId, userId, util.toIdentifier(newDeckRef));
                // also collect the id replacements from inner copy tree process
                Object.assign(copiedIdsMap, copyResult.copiedIdsMap);

                // replace item ref with copied deck tree
                Object.assign(item.ref, copyResult.newDeckRef);
            }

        }

        // finished, now we directly attach the contentItems
        let decks = await helper.getCollection('decks');
        // we need to wait before response
        await decks.findOneAndUpdate(
            { _id: newDeckRef.id },
            { $set: { 'revisions.0.contentItems': originDeck.contentItems } }
        );

        // also add the new reference in the replacements map
        copiedIdsMap[deckId] = util.toIdentifier(newDeckRef);

        // return both the new deck and the replacements
        return {
            newDeckRef,
            copiedIdsMap,
        };

    },

    // copies (forks) deck sourceId and attaches it to deck targetId children at targetPosition
    attachDeckTree: async function(sourceId, targetId, targetPosition, targetRootId, userId) {
        let forkResult = await self.copyDeckTree(sourceId, userId, true);
        if (!forkResult) return; // sourceId not found

        // get the new deck we are going to attach
        let newContentItem = { ref: util.parseIdentifier(forkResult.root_deck), kind: 'deck' };

        // before attaching, we need to merge the parent deck variants into the child deck variants
        // we also need to update the child language to match the parents' (????)
        // because the child deck may have subdecks, this needs to be done recursively
        let targetDeck = await deckDB.getDeck(targetId);
        // normalize the id
        targetId = util.toIdentifier(targetDeck);

        // we need to keep only what we support as variant filter, which is language only
        let targetVariants = (targetDeck.variants || []).map((v) => _.pick(v, 'language'));
        await mergeDeckVariants(newContentItem.ref.id, targetVariants, _.pick(targetDeck, 'language'));

        // omitting the rootDeckId in the call to insertContentItem means this change won't be tracked,
        // as it will be tracked right after this code, we just need to attach now
        // first so that the rest of the tracking will work
        await deckDB.insertContentItem(newContentItem, targetPosition, targetId, userId);

        // track all created forks
        await deckDB._trackDecksForked(targetRootId, forkResult.id_map, userId, 'attach').catch((err) => {
            console.warn(`error tracking attach deck copy ${forkResult.root_node} to ${targetId}`);
        });
        // add to usage
        await usageDB.addToUsage(targetDeck, [newContentItem]).catch((err) => {
            console.warn(`error processing usage while attaching deck copy ${forkResult.root_node} to ${targetId}`);
        });

        // return the deck copy information
        return forkResult;
    },

    createSubdeck: async function(payload, targetId, targetPosition, rootId, userId) {
        let parentDeck = await deckDB.getDeck(targetId);
        if (!parentDeck) return; // targetId not found
        // normalize the id
        targetId = util.toIdentifier(parentDeck);

        // assign data from parent deck
        Object.assign(payload, _.pick(parentDeck, [
            'language',
            'license',
            'theme',
            'allowMarkdown',
            'slideDimensions',
        ]));

        // assign metadata
        Object.assign(payload, {
            'user': userId,
            'root_deck': targetId,
        });

        // add it to database
        let newDeck = await deckDB.insert(payload);
        // get the content item to insert
        let newContentItem = { ref: { id: newDeck._id, revision: 1 }, kind: 'deck' };

        // we also add to the subdeck the same variants as the parent deck
        // for now, only language is variant specifier
        let targetVariants = (parentDeck.variants || []).map((v) => _.pick(v, 'language'));
        if (!_.isEmpty(targetVariants)) {
            newDeck.variants = targetVariants;

            // also save the variants
            let decks = await helper.getCollection('decks');
            await decks.findOneAndUpdate(
                { _id: newContentItem.ref.id, 'revisions.id': newContentItem.ref.revision },
                { $set: {
                    'revisions.$.variants': targetVariants,
                } }
            );
        }

        // omitting the rootDeckId in the call to insertContentItem means this change won't be tracked,
        // as it will be tracked right after this code, we just need to attach now
        // first so that the rest of the tracking will work
        await deckDB.insertContentItem(newContentItem, targetPosition, targetId, userId, rootId);

        // return the new content item
        return newContentItem;
    },

    createSlide: async function(payload, targetId, targetPosition, rootId, userId) {
        let parentDeck = await deckDB.getDeck(targetId);
        if (!parentDeck) return; // targetId not found
        // normalize the id
        targetId = util.toIdentifier(parentDeck);

        // assign data from parent deck
        Object.assign(payload, _.pick(parentDeck, [
            'language',
            'license',
        ]));
        if (parentDeck.slideDimensions) {
            payload.dimensions= parentDeck.slideDimensions;
        }

        // assign metadata
        Object.assign(payload, {
            'user': userId,
            'root_deck': targetId,
        });

        // add it to database
        let newSlide = await slideDB.insert(payload);
        // get the content item to insert
        let newContentItem = { ref: { id: newSlide._id, revision: 1 }, kind: 'slide' };

        // this method also tracks the slide insertion
        await deckDB.insertContentItem(newContentItem, targetPosition, targetId, userId, rootId);

        // return the new content item
        return newContentItem;
    },

};

// adds all the variants to the deck deckId and its subdecks, if missing
// also sets the relevant deck properties to the values specified in defaults
// defaults should never be included in new variants to merge
async function mergeDeckVariants(deckId, variants, defaults) {
    let deck = await deckDB.get(deckId);

    // always work with latest revision
    let [latestRevision] = deck.revisions.slice(-1);
    // ensure variants
    if (!latestRevision.hasOwnProperty('variants')) {
        latestRevision.variants = [];
    }

    // merge variants provided into deck variants
    for (let variant of variants) {
        let existingVariant = _.find(latestRevision.variants, variant);
        if (!existingVariant) {
            latestRevision.variants.push(variant);
        }
    }

    // remove the defaults from the deck variants if there
    // check if defaults is in variants and remove it
    let existingDefaults = _.find(latestRevision.variants, defaults);
    _.remove(latestRevision.variants, defaults);

    // assign the defaults: language is the only one supported for now
    if (defaults.language !== latestRevision.language) {
        // add the current language of the deck to the variants array
        let oldVariantData = _.pick(latestRevision, 'language', 'title', 'description');
        let existingVariant = _.find(latestRevision.variants, _.pick(oldVariantData, 'language'));
        if (existingVariant) {
            // update with values from latestRevision as we are changing the language
            Object.assign(existingVariant, oldVariantData);
        } else {
            // push all variant data into variants array
            latestRevision.variants.push(oldVariantData);
        }

        // if defaults was in variants, update the variant data (title, description)
        if (existingDefaults) {
            Object.assign(latestRevision, existingDefaults);
        }

        // finally, change the language!
        latestRevision.language = defaults.language;
    }

    let decks = await helper.getCollection('decks');
    // put the changed revision object
    await decks.findOneAndUpdate(
        { _id: deck._id, 'revisions.id': latestRevision.id },
        { $set: {
            'revisions.$': latestRevision,
        } }
    );

    // need to apply this recursively as well !!!
    // current deck is synced. let's sync its children as well

    // we need to keep only what we support as variant filter, which is language only
    let newVariants = latestRevision.variants.map((v) => _.pick(v, 'language'));
    for (let subdeck of _.filter(latestRevision.contentItems, { kind: 'deck' }) ) {
        await mergeDeckVariants(subdeck.ref.id, newVariants, defaults);
    }

    // respond with merged variants on success
    return latestRevision.variants;
}

async function exportSlide(slideId) {
    let slide = await slideDB.getSlideRevision(slideId);
    let result = _.pick(slide, 'id', 'revision',
        'title', 'content', 'speakernotes',
        'timestamp', 'lastUpdate',
        'language');

    return Object.assign(result, {
        type: 'slide',
        owner: slide.user,
        contributors: _.map(slide.contributors, 'user'),
    });
}
