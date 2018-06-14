'use strict';

const _ = require('lodash');
const boom = require('boom');

const slideDB = require('../database/slideDatabase');
const contributorsDB = require('../database/contributors');

const userService = require('../services/user');

let self = module.exports = {

    getContributors: function(request, reply) {
        let slideId = request.params.id;
        contributorsDB.getSlideContributors(slideId).then((contributors) => {
            if (!contributors) throw boom.notFound();
            return contributors;
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

};
