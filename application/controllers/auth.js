'use strict';

const _ = require('lodash');
const boom = require('boom');

const util = require('../lib/util');

const deckDB = require('../database/deckDatabase');

// reusable method that authorizes user for editing a deck given the deck tree root deck
module.exports = {

    authorizeUser: async function (userId, deckId, rootId) {
        let uniqueDeckIds = _.uniq(_.compact([deckId, rootId]));

        for (let index in uniqueDeckIds) {
            let deckId = uniqueDeckIds[index];
            let perms = await deckDB.userPermissions(uniqueDeckIds[index], userId);

            // check if it's there
            if (!perms) {
                // if the first unique id is missing it's a 404
                // else it's a 422 (not part of path)
                if (index === 0) {
                    return boom.notFound();
                } else {
                    return boom.badData(`could not authorize user:${userId} for deck:${deckId} under tree:${rootId}`);
                }
            }

            // check edit permission
            if (!perms.edit) return boom.forbidden(`user:${userId} is not authorized to edit deck:${deckId} under tree:${rootId}`);
            // check readOnly status
            if (perms.readOnly) return boom.forbidden(`deck:${deckId} under tree:${rootId} is read-only`);
        }

        // return nothing if all's ok :)
    },

};
