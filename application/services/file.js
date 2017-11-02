'use strict';

const rp = require('request-promise-native');
const he = require('he');

const Microservices = require('../configs/microservices');

const self = module.exports = {

    // creates a thumbnail for a given slide
    createThumbnail: function(slideContent, slideId, theme) {
        let encodedContent = he.encode(slideContent, { allowUnsafeSymbols: true });

        return rp.post({
            uri: `${Microservices.file.uri}/slideThumbnail/${slideId}/${theme}`,
            body: encodedContent,
            headers: {
                'Content-Type': 'text/plain'
            },
        });
    },

};
