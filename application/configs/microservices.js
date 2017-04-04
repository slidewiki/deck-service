'use strict';

const co = require('../common');

module.exports = {
    'file': {
        uri: (!co.isEmpty(process.env.SERVICE_URL_FILE)) ? process.env.SERVICE_URL_FILE : 'http://fileservice',
    },
    'user': {
        uri: 'https://userservice.experimental.slidewiki.org'
    },
    'tag': {
        uri: (!co.isEmpty(process.env.SERVICE_URL_TAG)) ? process.env.SERVICE_URL_TAG : 'http://tagservice',
    },
};
