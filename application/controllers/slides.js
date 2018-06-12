'use strict';

const _ = require('lodash');
const boom = require('boom');

const slideDB = require('../database/slideDatabase');
const userService = require('../services/user');

let self = module.exports = {

    getContributors: function(request, reply) {
        let slideId = request.params.id;
        slideDB.get(slideId).then((slide) => {
            if (!slide) throw boom.notFound();

            // TODO implement this properly
            return [{
                id: slide.user,
                type: 'creator',
            }];

        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

};
