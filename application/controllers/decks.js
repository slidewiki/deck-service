'use strict';

const boom = require('boom');
const deckDB = require('../database/deckDatabase');

let self = module.exports = {

    getDeckOwners: function(request, reply) {
        let query = {};
        if (request.query.user) {
            query.user = { $in: request.query.user.split(',').map((u) => parseInt(u)) };
        }

        deckDB.getDeckOwners(query).then((users) => {
            reply(users);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

};
