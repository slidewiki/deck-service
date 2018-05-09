'use strict';

const _ = require('lodash');
const boom = require('boom');

const util = require('../lib/util');

const deckDB = require('../database/deckDatabase');
const slideDB = require('../database/slideDatabase');
const treeDB = require('../database/deckTreeDatabase');

const fileService = require('../services/file');

const self = module.exports = {

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
