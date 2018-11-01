'use strict';

const _ = require('lodash');
const boom = require('boom');

const util = require('../lib/util');
const ChangeLog = require('../lib/ChangeLog');

const helper = require('./helper');
const deckDB = require('./deckDatabase');
const slideDB = require('./slideDatabase');
const usageDB = require('./usage');
const contributorsDB = require('./contributors');

const fileService = require('../services/file');

const self = module.exports = {

    // recursive function that gets the decktree of a given deck and all of its sub-decks
    getDeckTree: async function(deckId, variantFilter, visited, rootVariants) {
        let deck = await deckDB.getDeck(deckId, variantFilter);
        if (!deck) return; // not found

        // make it canonical
        deckId = util.toIdentifier(deck);

        // check for cycles!
        if (_.isEmpty(visited)) {
            // info of root deck
            visited = [deckId];
        } else if (visited.includes(deckId)) {
            // TODO for now just pretend it's not there
            return;
        } else {
            visited.push(deckId);
        }

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

        if (!rootVariants) {
            // we are root!
            rootVariants = deck.variants || [];
            Object.assign(deckTree, { variants: rootVariants });
        } else {
            // let's add what we have on the subdeck level to the root variants
            _.each(deck.variants, (child) => {
                // we only need the variant info from children (e.g. language)
                // so no title or description or original (?)
                let deckVariant = _.omit(child, 'title', 'description', 'original');
                // we skip stuff we already have
                if (!_.find(rootVariants, deckVariant) ) {
                    rootVariants.push(deckVariant);
                }
            });
        }

        // we also push the current deck language (may not actually be the primary)
        let selfVariant = _.pick(deckTree, 'language');
        if (!_.find(rootVariants, selfVariant) ) {
            rootVariants.push(selfVariant);
        }

        let primaryVariant = _.find(rootVariants, { original: true });
        // we need to tag as 'original' the primary variant of the deck
        if (!primaryVariant) {
            // means we didn't include a filter or the filter did not match a variant
            // also means the node has the primary version

            // first try and locate that
            primaryVariant = _.find(rootVariants, _.pick(deckTree, 'language'));
            if (primaryVariant) {
                // tag it and also include the title if not already there
                Object.assign(primaryVariant, _.pick(deckTree, 'title'), { original: true });
            } else {
                primaryVariant = Object.assign({ original: true }, _.pick(deckTree, 'language', 'title'));
                rootVariants.push(primaryVariant);
            }

        }

        if (_.isEmpty(variantFilter)) {
            // we request the deck tree in the primary language of its root
            // we need to explicitly include that for subdecks so that it properly propagates
            variantFilter = _.pick(deck, 'language');
        }

        for (let item of deck.contentItems) {
            let itemId = util.toIdentifier(item.ref);
            if (item.kind === 'slide') {
                // variantFilter is never empty here
                // try to locate the correct slide reference
                let slideVariant = _.find(item.variants, variantFilter);
                if (slideVariant) {
                    // set the correct variant itemId
                    itemId = util.toIdentifier(slideVariant);
                }

                // if no matching variant, item could be the original slide
                let slide = await slideDB.getSlideRevision(itemId);
                // skip dangling slide references
                if (!slide) continue;

                // we need to check if the language matches the filter as well
                // and fallback to the deck primary language if not
                if (slide.language !== variantFilter.language && slide.language !== primaryVariant.language) {
                    slideVariant = _.find(item.variants, _.pick(primaryVariant, 'language'));
                    if (slideVariant) {
                        itemId = util.toIdentifier(slideVariant);
                        slide = await slideDB.getSlideRevision(itemId);
                    }
                } // else it matches, or it matches the primary variant, which we use for fallback anyway

                deckTree.children.push({
                    type: 'slide',
                    id: itemId,
                    title: slide.title,
                    language: slide.language,
                    theme: deck.theme,
                    allowMarkdown: deck.allowMarkdown,
                });

                // we collect language from slides as well as subdecks
                let variantSpecs = [_.pick(slide, 'language'), ..._.map(item.variants, (v) => _.pick(v, 'language'))];
                for (let variantSpec of variantSpecs) {
                    if (!_.find(rootVariants, variantSpec) ) {
                        rootVariants.push(variantSpec);
                    }
                }

            } else {
                // it's a deck
                let innerTree = await self.getDeckTree(itemId, variantFilter, visited, rootVariants);
                // skip dangling deck references / cycles
                if (!innerTree) continue;

                deckTree.children.push(innerTree);
            }
        }

        return deckTree;
    },

    // get first slide
    getFirstSlide: async function(deck) {
        // test if there are any content items ata ll
        if (!deck.contentItems.length) return;

        // test if first content item is a slide
        if (deck.contentItems[0].kind === 'slide') {
            let firstSlideItem = deck.contentItems[0];

            // we need to pick the slide in the deck language
            if (!_.isEmpty(firstSlideItem.variants)) {
                let variant = firstSlideItem.variants.find((v) => v.language === deck.language);
                if (variant) {
                    return util.toIdentifier(variant);
                }
            }
            return util.toIdentifier(firstSlideItem.ref);
        }

        // we have to do it properly: get the deck tree
        // we need to pick the slide in the primary deck language if possible
        return self._getFirstSlide(util.toIdentifier(deck), _.pick(deck, 'language'));
    },

    _getFirstSlide: async function(deckId, variantFilter, visited) {
        let deck = await deckDB.getDeck(deckId, variantFilter);
        if (!deck) return; // not found

        let language = deck.language;

        let primaryVariant = _.find(deck.variants, { original: true });
        // we need to tag as 'original' the primary variant of the deck
        if (!primaryVariant) {
            // means we didn't include a filter or the filter did not match a variant
            // also means the node has the primary version
            primaryVariant = { language };
        }

        if (_.isEmpty(variantFilter)) {
            // we request the deck tree in the primary language of its root
            // we need to explicitly include that for subdecks so that it properly propagates
            variantFilter = { language };
        }

        // make it canonical
        deckId = util.toIdentifier(deck);

        // check for cycles!
        if (_.isEmpty(visited)) {
            // info of root deck
            visited = [deckId];
        } else if (visited.includes(deckId)) {
            return;
        } else {
            visited.push(deckId);
        }

        for (let item of deck.contentItems) {
            let itemId = util.toIdentifier(item.ref);
            if (item.kind === 'slide') {
                // variantFilter is never empty here
                // try to locate the correct slide reference
                let slideVariant = _.find(item.variants, variantFilter);
                if (slideVariant) {
                    // set the correct variant itemId
                    itemId = util.toIdentifier(slideVariant);
                }

                // if no matching variant, item could be the original slide
                let slide = await slideDB.getSlideRevision(itemId);
                // we need to check if the language matches the filter as well
                // and fallback to the deck primary language if not
                if (slide.language !== variantFilter.language && slide.language !== primaryVariant.language) {
                    slideVariant = _.find(item.variants, _.pick(primaryVariant, 'language'));
                    if (slideVariant) {
                        itemId = util.toIdentifier(slideVariant);
                    }
                } // else it matches, or it matches the primary variant, which we use for fallback anyway

                // found the slide!
                return itemId;
            } else {
                // it's a deck
                let subdeckSlide = self._getFirstSlide(itemId, variantFilter, visited);
                if (subdeckSlide) return subdeckSlide;
            }
        }
    },

    // returns a flattened structure of a deck's slides
    getFlatSlides: async function(deckId, variantFilter) {
        let result = await self.getFlatItems(deckId, variantFilter);
        if (!result) return;

        // remove the decks
        _.remove(result.children, { type: 'deck' });
        return result;
    },

    // returns a flattened structure of a deck's slides, and optionally its sub-decks
    getFlatItems: async function(deckId, variantFilter, deckTree) {
        let deck = await deckDB.getDeck(deckId, variantFilter);
        if (!deck) return; // not found

        if (_.isEmpty(variantFilter)) {
            // we request the deck tree in the primary language of its root
            // we need to explicitly include that for subdecks so that it properly propagates
            variantFilter = _.pick(deck, 'language');
        }

        // make it canonical
        deckId = util.toIdentifier(deck);

        let deckEntry = {
            type: 'deck',
            id: deckId,
            title: deck.title,
            language: deck.language,
            theme: deck.theme,
            allowMarkdown: deck.allowMarkdown,
            user: String(deck.user),
        };

        if (!deckTree) {
            // info of root deck
            deckTree = Object.assign(deckEntry, {
                children: [],
            });
        } else {
            // check for cycles!
            if (_.find(deckTree.children, { type: 'deck', id: deckId })) {
                // TODO for now just pretend it's not there
                console.warn(`found cycle in deck tree ${deckTree.id}, deck node ${deckId}`);
                return deckTree;
            }

            // else push the deck as well
            deckTree.children.push(deckEntry);
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
                    transition: slide.transition ? slide.transition : 'none'
                });

            } else {
                // it's a deck
                // call recursively for subdecks
                await self.getFlatItems(itemId, variantFilter, deckTree);
                // deckTree will receive the rest of the slides
            }
        }

        return deckTree;
    },

    // fetches specified media-type files that are present inside the deck
    getMedia: function(deckId, mediaType){
        return self.getFlatSlides(deckId).then( (flatSlides) => {
            if(!flatSlides) return;

            // get media uris per slide as arrays
            let media = flatSlides.children.map( (slide) => {
                return util.findMedia(slide.content, mediaType);
            });

            // flatten arrays of media uris
            let flatMedia = [].concat.apply([], media);

            // return unique media uris
            return [...new Set(flatMedia)];
        });
    },

    getDeckTreeVariants: async function(deckId, firstLevel=false, visited, rootVariants) {
        let deck = await deckDB.getDeck(deckId);
        if (!deck) return; // not found

        // make it canonical
        deckId = util.toIdentifier(deck);

        // check for cycles!
        if (_.isEmpty(visited)) {
            // info of root deck
            visited = [deckId];
        } else if (visited.includes(deckId)) {
            // TODO for now just pretend it's not there
            return;
        } else {
            visited.push(deckId);
        }

        let deckTree = {
            type: 'deck',
            id: util.toIdentifier(deck),

            variants: [],
            children: [],
        };

        let selfVariant = _.pick(deck, 'language');
        if (!rootVariants) {
            // we are root!
            rootVariants = _.map(deck.variants, (v) => _.pick(v, 'language'));

            // we also push the current deck language (primary)
            // we guard against bad data: check if it's there already
            let primaryVariant = _.find(rootVariants, selfVariant);
            if (primaryVariant) {
                // tag it as original
                Object.assign(primaryVariant, { original: true });
            } else {
                // add it
                primaryVariant = Object.assign({ original: true }, selfVariant);
                rootVariants.unshift(primaryVariant);
            }

            deckTree.variants = rootVariants;
        } else {
            // let's add what we have on the subdeck level to the root variants
            _.map(deck.variants, (v) => _.pick(v, 'language')).concat(selfVariant).forEach((deckVariant) => {
                // we skip stuff we already have
                if (!_.find(rootVariants, deckVariant) ) {
                    rootVariants.push(deckVariant);
                }
            });
        }

        for (let item of deck.contentItems) {
            let itemId = util.toIdentifier(item.ref);
            if (item.kind === 'slide') {
                let slide = await slideDB.getSlideRevision(itemId);
                // skip dangling slide references
                if (!slide) continue;

                let slideNode = {
                    type: 'slide',
                    // this is the canonical id of the slide, it (as any other variant id) can be used to fetch the slide node
                    id: itemId,
                    variants: _.map(item.variants, (v) => ({ id: util.toIdentifier(v), language: v.language })),
                };

                // add original as well
                slideNode.variants.unshift({
                    id: itemId,
                    language: slide.language,
                });

                deckTree.children.push(slideNode);

                // we collect language from slides as well as subdecks
                let variantSpecs = [_.pick(slide, 'language'), ..._.map(item.variants, (v) => _.pick(v, 'language'))];
                for (let variantSpec of variantSpecs) {
                    if (!_.find(rootVariants, variantSpec) ) {
                        rootVariants.push(variantSpec);
                    }
                }

            } else if (!firstLevel) {
                // it's a deck
                let innerTree = await self.getDeckTreeVariants(itemId, false, visited, rootVariants);
                // skip dangling deck references / cycles
                if (!innerTree) continue;

                deckTree.children.push(innerTree);
            }
        }

        return deckTree;
    },

    // new implementation for decktree API with enrich flag
    exportDeckTree: async function(deckId, firstLevel, path=[], deckTree=[], visited=[]) {
        let treeVariants = await self.getDeckTreeVariants(deckId, true);
        let originalVariant = _.find(treeVariants.variants, { original: true });
        let originalLanguage = originalVariant.language;
        
        for (const variant of treeVariants.variants) {
            let variantFilter = _.pick(variant, 'language');
        
            let deck = await deckDB.getDeck(deckId, variantFilter);
            if (!deck) return; // not found

            // make it canonical
            deckId = util.toIdentifier(deck);
            let identifier = `${deckId}_${variantFilter.language}`;

            if (visited.includes(identifier)) return;
            visited.push(identifier);

            path.push(_.pick(deck, 'id', 'revision', 'hidden'));

            let deckEntry = {
                type: 'deck',
                id: deck.id,
                revision: deck.revision,
                hidden: deck.hidden,
                title: deck.title,
                description: deck.description,
                timestamp: deck.timestamp, 
                lastUpdate: deck.lastUpdate,
                educationLevel: deck.educationLevel,
                tags: _.map(deck.tags, 'tagName'),            
                language: deck.language,
                variants: {
                    original: originalLanguage,
                    current: variantFilter.language,
                    all: _.map(treeVariants.variants, 'language'),
                },
                theme: deck.theme,
                owner: deck.user,
                contributors: _.map(await contributorsDB.getDeckContributors(deckId), 'id'),
                path: _.uniqBy(path, 'id'),
                forkGroup: await deckDB.computeForkGroup(deckId),
                revisionCount: deck.revisionCount,
                firstSlide: await self.getFirstSlide({ 
                    id: deck.id, 
                    revision: deck.revision, 
                    language: variantFilter.language,
                    contentItems: deck.contentItems, 
                }),
                children: [],
            };

            if (_.isEmpty(deckTree)) {

                // info of root deck
                deckTree.push(deckEntry);
            } else {
                // check for cycles!
                if (_.find(deckTree.children, { type: 'deck', id: deckId })) {
                    // TODO for now just pretend it's not there
                    console.warn(`found cycle in deck tree ${deckTree.id}, deck node ${deckId}`);
                    return deckTree;
                }

                // else push the deck as well
                deckTree.push(deckEntry);
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
                    deckEntry.children.push({
                        type: 'slide',
                        id: itemId,
                        title: slide.title,
                        content: slide.content,
                        speakernotes: slide.speakernotes,
                        language: slide.language,
                        user: slide.user,
                    });

                } else if (!firstLevel) {
                    // it's a deck
                    // call recursively for subdecks
                    await self.exportDeckTree(itemId, false, _.cloneDeep(path), deckTree, visited);
                    // deckTree will receive the rest of the slides
                }
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
            await _trackDecksForked(rootDeckId, copiedIdsMap, userId, 'fork');
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
    _copyDeckTree: async function(deckId, userId) {
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
            'educationLevel',
        ]);

        // clean up null / undefined
        newDeck = _.omitBy(newDeck, _.isNil);

        // assign origin metadata
        Object.assign(newDeck, {
            origin: _.pick(originDeck, [
                'id',
                'revision',
                'title',
                'user',
            ]),
        });

        let inserted = await deckDB.insert(newDeck, userId, true);
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

        // normalize the target deck id
        let targetDeck = await deckDB.getDeck(targetId);
        targetId = util.toIdentifier(targetDeck);

        // omitting the rootDeckId in the call to insertContentItem means this change won't be tracked,
        // as it will be tracked right after this code, we just need to attach now
        // first so that the rest of the tracking will work
        await deckDB.insertContentItem(newContentItem, targetPosition, targetId, userId);

        // track all created forks
        await _trackDecksForked(targetRootId, forkResult.id_map, userId, 'attach').catch((err) => {
            console.warn(`error tracking attach deck copy ${forkResult.root_node} to ${targetId}`);
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
        payload = Object.assign(_.pick(parentDeck, [
            'language',
            'license',
            'theme',
            'allowMarkdown',
            'slideDimensions',
            'educationLevel',
        ]), payload);

        // add it to database
        let newDeck = await deckDB.insert(payload, userId, true);
        // get the content item to insert
        let newContentItem = { ref: { id: newDeck._id, revision: 1 }, kind: 'deck' };

        // omitting the rootDeckId in the call to insertContentItem means this change won't be tracked,
        // as it will be tracked right after this code, we just need to attach now
        // first so that the rest of the tracking will work
        await deckDB.insertContentItem(newContentItem, targetPosition, targetId, userId, rootId);

        // return the new content item
        return newContentItem;
    },

    createSlide: async function(payload, targetId, targetPosition, rootId, userId, addAction) {
        let parentDeck = await deckDB.getDeck(targetId);
        if (!parentDeck) return; // targetId not found
        // normalize the id
        targetId = util.toIdentifier(parentDeck);

        // assign missing data from parent deck
        let defaults = _.pick(parentDeck, [
            'language',
            'license',
        ]);
        if (parentDeck.slideDimensions) {
            defaults.dimensions = parentDeck.slideDimensions;
        }
        // but override parent defaults with whatever is in payload
        payload = Object.assign(defaults, payload);

        // add it to database
        let newSlide = await slideDB.insert(payload, userId);
        // get the content item to insert
        let newContentItem = { ref: { id: newSlide._id, revision: 1 }, kind: 'slide' };

        // this method also tracks the slide insertion
        let updatedDeckRevision = await deckDB.insertContentItem(newContentItem, targetPosition, targetId, userId, rootId, addAction);
        // we can now pick the theme of the parent deck and create the thumbnail!
        let newSlideId = util.toIdentifier(newContentItem.ref);
        fileService.createThumbnail(newSlide.revisions[0].content, newSlideId, updatedDeckRevision.theme).catch((err) => {
            console.warn(`could not create thumbnail for slide ${newSlideId}, error was: ${err.message}`);
        });

        // add theme to content item
        newContentItem.theme = updatedDeckRevision.theme;

        // return the new content item
        return newContentItem;
    },

};

async function exportSlide(slideId) {
    let slide = await slideDB.getSlideRevision(slideId);
    if (!slide) return;

    let result = _.pick(slide, 'id', 'revision',
        'title', 'content', 'speakernotes',
        'timestamp', 'lastUpdate',
        'language');

    return Object.assign(result, {
        type: 'slide',
        owner: slide.user,
        contributors: _.map(await contributorsDB.getSlideContributors(slideId), 'id'),
    });
}

function _trackDecksForked(rootDeckId, forkIdsMap, userId, forkType='fork') {
    // we reverse the array to track the root first, then the children in order
    let newDeckIds = Object.keys(forkIdsMap).map((key) => forkIdsMap[key]).reverse();

    let parentOperations = [];
    // taken from https://stackoverflow.com/questions/30823653/is-node-js-native-promise-all-processing-in-parallel-or-sequentially/#30823708
    // this starts with a promise that resolves to empty array,
    // then takes each new deck id and applies the tracking and returns a new promise that resolves
    // to the tracking results, that are picked up by the next iteration, etc...
    return newDeckIds.reduce((p, newDeckId) => {
        return p.then((deckChanges) => {
            // if errored somewhere return nothing, chain will just end without doing the rest
            if (!deckChanges) return;

            // parent operations is only the ops for the forking of the first deck (the root of the fork tree)
            // the first time this runs, deckChanges is empty!
            if (_.isEmpty(parentOperations)) parentOperations.push(...deckChanges);
            // we track everything as rooted to the deck_id
            return ChangeLog.trackDeckForked(newDeckId, userId, rootDeckId, parentOperations, forkType);
        });
    }, Promise.resolve([]));

}
