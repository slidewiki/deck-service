'use strict';

const _ = require('lodash');

const util = require('../lib/util');

const helper = require('./helper');
const slideDB = require('./slideDatabase');
const deckDB = require('./deckDatabase');

let self = module.exports = {

    getDeckContributors: async function(deckId, variantFilter) {
        let deck = await deckDB.getDeck(deckId, variantFilter);
        if (!deck) return; // not found

        let treeItems = await getTreeItems(deck, variantFilter);
        // put missing users info for subdecks
        for (let item of _.filter(treeItems, { kind: 'deck' })) {
            let subdeck = await deckDB.getDeck(util.toIdentifier(item.ref));
            Object.assign(item, {
                user: subdeck.user,
            });
        }
        // put missing users info for slides
        for (let item of _.filter(treeItems, { kind: 'slide' })) {
            let slide = await slideDB.getSlideRevision(util.toIdentifier(item.ref));
            Object.assign(item, {
                user: slide.revisionUser,
            });
            // we want to also include the users of the parents of the slide
            if (slide.parent) {
                // parent is a ref
                let parent = await slideDB.getSlideRevision(util.toIdentifier(slide.parent));
                // we can add stuff to treeItems, as the iterator is over a copy (is it ?) (it is, using _.filter)
                parent && treeItems.push(Object.assign({}, item, {
                    user: parent.revisionUser,
                }));
            }
        }

        // unshift the root item
        let rootItem = {
            kind: 'deck',
            ref: _.pick(deck, 'id', 'revision'),
            user: deck.user,
        };
        treeItems.unshift(rootItem);

        // we first group everything by user
        let usersItems = _.groupBy(treeItems, 'user');
        // then for each user we produce separate counts for contribution types
        return Object.entries(usersItems).map(([user, items]) => {
            // keys in groups are strings
            user = Number.parseInt(user);
            // count by type
            let typeCounts = _.countBy(items, (i) => (i.variant ? 'translator' : 'contributor'));
            // two types at most, get them
            return {
                id: user,
                type: (user === deck.user) ? 'creator' : 'contributor',
                count: items.length,
                translations: typeCounts.translator,
            };
        });

    },

    getSlideContributors: async function(slideId) {
        let slide = await slideDB.getSlideRevision(slideId);
        if (!slide) return; // not found

        let slideUsers = [slide.revisionUser];
        // we want to also include the users of the parents of the slide
        if (slide.parent) {
            // parent is a ref
            let parent = await slideDB.getSlideRevision(util.toIdentifier(slide.parent));
            parent && slideUsers.push(parent.revisionUser);
        }

        let usersCounts = _.countBy(slideUsers);
        return Object.entries(usersCounts).map(([user, count]) => {
            user = Number.parseInt(user);
            return {
                id: user,
                type: (user === slide.user) ? 'creator': 'contributor',
                count,
            };
        });
    },

};

async function getTreeItems(deck, variantFilter) {
    if (!deck) return [];

    let result = [];
    for (let item of await getContentItems(deck)) {
        if (item.kind === 'deck') {
            // push the deck
            result.push(item);
            // ...and the items under it
            result.push(...await getTreeItems(item.ref, variantFilter));
        } else { // slide
            // limit the variants we are going to include
            let variants;
            if (_.isEmpty(variantFilter)) {
                // include the slide
                result.push(_.pick(item, 'kind', 'ref'));
                // TODO and all the variants ???
                // variants = item.variants;
            } else {
                // check for matching variant
                let matching = _.find(item.variants, variantFilter);
                if (matching) {
                    // include only the variant if it exists
                    variants = [matching];
                } else {
                    // or only include the slide
                    result.push(_.pick(item, 'kind', 'ref'));
                }
            }
            // push whatever variants are left after filtering
            for (let variant of variants || []) {
                result.push({
                    kind: item.kind,
                    ref: _.pick(variant, 'id', 'revision'),
                    variant: _.omit(variant, 'id', 'revision'),
                });
            }
        }
    }
    return result;
}

async function getContentItems(deck) {
    if (!deck) return [];

    let cursor = (await helper.getCollection('decks')).aggregate();
    // always match as first stage to be fast because of indexes
    cursor.match({ _id: deck.id });
    // project only what we need before going any further (saves memory ???)
    cursor.project({
        revisions: {
            id: 1,
            contentItems: {
                ref: 1,
                kind: 1,
                variants: 1,
            },
        },
    });
    // filter revisions
    cursor.unwind('$revisions');
    if (deck.revision) {
        cursor.match({ 'revisions.id': deck.revision });
    }
    // unwind everything
    cursor.unwind('$revisions.contentItems');
    if (deck.revision) {
        cursor.project({
            _id: 0,

            kind: '$revisions.contentItems.kind',
            ref: '$revisions.contentItems.ref',
            variants: '$revisions.contentItems.variants',
        });

        // we're done!
        return cursor.toArray();
    }

    cursor.project({
        _id: 0,
        revision: '$revisions.id',
        kind: '$revisions.contentItems.kind',
        ref: '$revisions.contentItems.ref',
        variants: '$revisions.contentItems.variants',
    });

    // // we need to group by revision
    // cursor.group({
    //     _id: '$revision',
    //     refs: { $push: { kind: '$kind', ref: '$ref', variants: '$variants' }},
    // }).project({ _id: 0, revision: '$_id', refs: 1 });

    // or by ref ???
    cursor.group({
        _id: { kind: '$kind', ref: '$ref', variants: '$variants' },
        revisions: { $push: '$revision' },
    }).project({ _id: 0, ref: '$_id', revisions: 1 });

    return cursor.toArray();
}
