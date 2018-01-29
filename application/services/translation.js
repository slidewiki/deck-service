'use strict';

const rp = require('request-promise-native');
const Microservices = require('../configs/microservices');

const self = module.exports = {

    translateSlide: function(slideId, languageToTranslate, user, jobId) {
        return rp.post({
            uri: `${Microservices.translation.uri}/slide/${slideId}`,
            json: true,
            body: {
                target: languageToTranslate,
                user: user,
                jobId: jobId,
            },
        });

    },

    translateDeck: function(deckId, languageToTranslate, user, jobId) {
        return rp.post({
            uri: `${Microservices.translation.uri}/deck/${deckId}`,
            json: true,
            body: {
                target: languageToTranslate,
                user: user,
                jobId: jobId,
            },
        });

    },

};
