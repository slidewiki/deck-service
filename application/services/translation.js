'use strict';

const rp = require('request-promise-native');
const Microservices = require('../configs/microservices');

const self = module.exports = {

    translateContent: function(content, language, target) {
        return rp.post({
            uri: `${Microservices.translation.uri}/translate/${target}`,
            json: true,
            body: {
                language,
                content,
                html: true,
            },
        });
    },

    // TODO REMOVE THIS
    translateSlide: function(slideId, languageToTranslate, user) {
        return rp.post({
            uri: `${Microservices.translation.uri}/slide/${slideId}`,
            json: true,
            body: {
                target: languageToTranslate,
                user: user,
            },
        });

    },

    // TODO REMOVE THIS
    translateDeck: function(deckId, languageToTranslate, user) {
        return rp.post({
            uri: `${Microservices.translation.uri}/deck/${deckId}`,
            json: true,
            body: {
                target: languageToTranslate,
                user: user,
            },
        });

    },

};
