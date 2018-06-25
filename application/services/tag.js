'use strict';

const rp = require('request-promise-native');
const Microservices = require('../configs/microservices');

const self = module.exports = {
    upload: function(newTags, user){
        if (Microservices.tag.disabled) return Promise.resolve();

        return rp.post({
            uri: `${Microservices.tag.uri}/tag/upload`,
            json: true,
            body: {
                user: parseInt(user),
                tags: newTags
            }
        });
    }
};
