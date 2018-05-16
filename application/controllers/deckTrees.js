'use strict';

const _ = require('lodash');
const boom = require('boom');

const util = require('../lib/util');

const deckDB = require('../database/deckDatabase');
const slideDB = require('../database/slideDatabase');
const treeDB = require('../database/deckTreeDatabase');

const fileService = require('../services/file');

function parseMoveSource(selector) {
    let parentId;
    let pathParts = selector.spath.split(';');
    if (pathParts.length > 1) {
        // the path ends with the item, so pick its parent
        // pick the id (first element) of the second to last path part
        [parentId] = pathParts[pathParts.length - 2].split(':');
    } else {
        // the path only has the item, so the parent is the root deck
        parentId = selector.id;
    }

    // always pick the position (second element) of the last path part
    let [,position] = pathParts[pathParts.length - 1].split(':');

    return {
        id: selector.sid,
        kind: selector.stype,
        parentId,
        position: parseInt(position),
    };
}

function parseMoveTarget(selector) {
    let deckId;
    if (selector.stype === 'deck') {
        deckId = selector.sid;
    } else if (selector.spath) {
        // it's a slide, with a path
        let pathParts = selector.spath.split(';');
        if (pathParts.length > 1) {
            // the path ends with the slide, so pick its parent
            // pick the id (first element) of the second to last path part
            [deckId] = pathParts[pathParts.length - 2].split(':');
        } else {
            // the path only has the slide, so the parent is the root deck
            deckId = selector.id;
        }
    } else {
        // if stype is slide and no spath, the target deck is the root of the tree
        deckId = selector.id;
    }

    return deckId;
}

const self = module.exports = {

    // changes position of a deck tree node inside the decktree
    moveDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;
        let rootId = request.payload.sourceSelector.id;

        // determine the source node info
        let source = parseMoveSource(request.payload.sourceSelector);

        // determine the target deck id and node position
        let target = {
            deckId: parseMoveTarget(request.payload.targetSelector),
            position: request.payload.targetIndex,
        };

        return treeDB.moveDeckTreeNode(rootId, source, target, userId).then((contentItem) => {
            // accomodate current API
            if (source.kind === 'deck') {
                // current API returns the deck tree rooted on the deck we just moved for some reason...
                return treeDB.getDeckTree(contentItem.ref.id).then(reply);
            } else {
                // current API returns the slide node we just moved for some reason...
                let itemId = util.toIdentifier(contentItem.ref);
                return slideDB.findSlideNode(rootId, itemId).then((slideNode) => {
                    reply({ title: slideNode.slide.title, id: itemId, type: 'slide' });
                });
            }

        }).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    // renames a decktree node (slide or deck)
    renameDeckTreeNode: function(request, reply) {
        let userId = request.auth.credentials.userid;
        // TODO apply authorization

        // TODO check if node exists
        let {id: rootId, sid: itemId, stype: itemKind} = request.payload.selector;
        let variantFilter = _.pick(request.payload, 'language');
        let newName = request.payload.name;

        // check if it is a deck or a slide
        let renamePromise;
        if (itemKind === 'deck') {
            renamePromise = deckDB.rename(itemId, newName, variantFilter, rootId, userId).then(() => {
                reply({ title: newName });
            });
        } else {
            // it's a slide
            renamePromise = slideDB.updateSlideNode(rootId, itemId, { title: newName }, variantFilter, userId).then((newSlideRef) => {
                // TODO revise this weird API response
                // this is to keep the API intact as much as possible
                return slideDB.get(newSlideRef.id).then((updatedSlide) => {
                    // prepare the updatedSlide response object
                    // updatedSlide.revisions = updatedSlide.revisions.slice(-1);
                    updatedSlide.revisions = [_.find(updatedSlide.revisions, { id: newSlideRef.revision })];

                    // create thumbnail for the new slide revision
                    let content = updatedSlide.revisions[0].content;
                    let newSlideId = util.toIdentifier(newSlideRef);

                    if (!content) {
                        content = '<h2>' + updatedSlide.revisions[0].title + '</h2>';
                    }
                    fileService.createThumbnail(content, newSlideId, newSlideRef.theme).catch((err) => {
                        request.log('warn', `could not create thumbnail for updated slide ${newSlideId}: ${err.message || err}`);
                    });

                    // TODO might also need to create a thumbnail
                    reply(updatedSlide);
                });
            });
        }

        // handle errors with promise
        renamePromise.catch((error) => {
            if (error.isBoom) return reply(error);
            request.log('error', error);
            reply(boom.badImplementation());
        });

    },

};
