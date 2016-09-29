'use strict';

const co = require('../common');

module.exports = {
    'file': {
        uri: (!co.isEmpty(process.env.SERVICE_URL_FILE)) ? process.env.SERVICE_URL_FILE : 'fileservice.experimental.slidewiki.org',
        shareVolume: '/data/files'
    },
    'image': {
        uri: (!co.isEmpty(process.env.SERVICE_URL_IMAGE)) ? process.env.SERVICE_URL_IMAGE : 'imageservice.experimental.slidewiki.org',
        port: 80
    }
};
